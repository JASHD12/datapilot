"""Read the public Olist archive into an explicit historical, delivered-order cohort.

No ZIP member is extracted. Prices are source BRL amounts, timestamps retain the
source's naive clock representation, and customer locations are not invented.
This cohort is useful for delivery modeling; its counts are *delivered-cohort*
counts, not all demand, lost sales, or a live view of a business.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from zipfile import BadZipFile, ZipFile

import numpy as np
import pandas as pd

SOURCE_URL = "https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce"
MAX_ROWS = 100_000
MAX_MEMBER_BYTES = 100 * 1024 * 1024


def _read(archive: ZipFile, name: str, required: set[str]) -> pd.DataFrame:
    try:
        info = archive.getinfo(name)
    except KeyError as exc:
        raise ValueError(f"Olist archive is missing {name}.") from exc
    if info.file_size > MAX_MEMBER_BYTES:
        raise ValueError(f"{name} exceeds the 100 MiB input limit.")
    with archive.open(info) as stream:
        frame = pd.read_csv(stream)
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"{name} is missing required columns: {', '.join(sorted(missing))}.")
    return frame


def _unique(frame: pd.DataFrame, keys: list[str], label: str) -> pd.DataFrame:
    frame = frame.drop_duplicates().copy()
    if frame.duplicated(keys).any():
        raise ValueError(f"{label} contains conflicting duplicate keys: {', '.join(keys)}.")
    return frame


def _single_or_multiple(values: pd.Series) -> str:
    distinct = values.dropna().astype(str).unique()
    return str(distinct[0]) if len(distinct) == 1 else ("(multiple)" if len(distinct) > 1 else "(unknown)")


def load_olist_zip(path: Path, max_rows: int | None = None) -> pd.DataFrame:
    """Load one row per eligible order, with provenance and exclusions in attrs.

    max_rows selects evenly spaced records from the time-sorted eligible cohort.
    If specified, its daily counts are sampled-cohort counts and must not be
    presented as the full dataset's order volumes.
    """
    path = Path(path)
    if not path.is_file():
        raise ValueError("Provide the downloaded Olist ZIP file.")
    if max_rows is not None and (isinstance(max_rows, bool) or not isinstance(max_rows, int) or not 1 <= max_rows <= MAX_ROWS):
        raise ValueError("max_rows must be an integer between 1 and 100,000, or None.")
    try:
        with ZipFile(path) as archive:
            orders = _read(archive, "olist_orders_dataset.csv", {
                "order_id", "order_status", "order_purchase_timestamp",
                "order_delivered_customer_date", "order_estimated_delivery_date"})
            items = _read(archive, "olist_order_items_dataset.csv", {
                "order_id", "order_item_id", "product_id", "seller_id", "price", "freight_value"})
            products = _read(archive, "olist_products_dataset.csv", {"product_id", "product_category_name"})
            reviews = None
            if "olist_order_reviews_dataset.csv" in archive.namelist():
                reviews = _read(archive, "olist_order_reviews_dataset.csv", {"order_id", "review_score"})
    except (BadZipFile, pd.errors.ParserError, UnicodeDecodeError) as exc:
        raise ValueError("Unable to read the Olist CSV archive.") from exc

    raw_order_rows = len(orders)
    orders = _unique(orders, ["order_id"], "orders")
    products = _unique(products[["product_id", "product_category_name"]], ["product_id"], "products")
    items = _unique(items, ["order_id", "order_item_id"], "order items")
    if orders["order_id"].isna().any() or items[["order_id", "order_item_id"]].isna().any().any():
        raise ValueError("Order and order-item identifiers must not be missing.")

    order_count = len(orders)
    delivered_mask = orders["order_status"].eq("delivered")
    not_delivered = int((~delivered_mask).sum())
    orders = orders.loc[delivered_mask].copy()
    for column in ["order_purchase_timestamp", "order_delivered_customer_date", "order_estimated_delivery_date"]:
        orders[column] = pd.to_datetime(orders[column], errors="coerce")
    missing_dates = orders[["order_purchase_timestamp", "order_delivered_customer_date", "order_estimated_delivery_date"]].isna().any(axis=1)
    invalid_dates = int(missing_dates.sum())
    orders = orders.loc[~missing_dates].copy()
    valid_timeline = ((orders["order_delivered_customer_date"] > orders["order_purchase_timestamp"])
                      & (orders["order_estimated_delivery_date"] >= orders["order_purchase_timestamp"]))
    invalid_timeline = int((~valid_timeline).sum())
    orders = orders.loc[valid_timeline].copy()

    items["price"] = pd.to_numeric(items["price"], errors="coerce")
    items["freight_value"] = pd.to_numeric(items["freight_value"], errors="coerce")
    item_valid = (items[["price", "freight_value"]].notna().all(axis=1)
                  & np.isfinite(items[["price", "freight_value"]]).all(axis=1)
                  & items["price"].ge(0) & items["freight_value"].ge(0))
    bad_item_orders = set(items.loc[~item_valid, "order_id"])
    # Drop whole affected orders rather than undercount their price or quantity.
    items = items.loc[~items["order_id"].isin(bad_item_orders)].copy()
    joined_items = items.merge(products, on="product_id", how="left", validate="many_to_one")
    aggregated = joined_items.groupby("order_id", sort=False).agg(
        order_value=("price", "sum"), freight_value=("freight_value", "sum"),
        items_count=("order_item_id", "count"), category=("product_category_name", _single_or_multiple),
        seller_id=("seller_id", _single_or_multiple)).reset_index()
    before_item_join = len(orders)
    orders = orders.merge(aggregated, on="order_id", how="inner", validate="one_to_one")
    without_valid_items = before_item_join - len(orders)

    frame = pd.DataFrame({
        "order_id": orders["order_id"],
        "purchase_date": orders["order_purchase_timestamp"],
        "order_value": orders["order_value"],
        "freight_value": orders["freight_value"],
        "promised_days": (orders["order_estimated_delivery_date"] - orders["order_purchase_timestamp"]).dt.total_seconds() / 86400,
        "items_count": orders["items_count"],
        "category": orders["category"],
        "seller_id": orders["seller_id"],
        "delivery_days": (orders["order_delivered_customer_date"] - orders["order_purchase_timestamp"]).dt.total_seconds() / 86400,
        # The promise is a calendar date. Delivery during that date is on time.
        "delivery_late": (orders["order_delivered_customer_date"].dt.normalize()
                          > orders["order_estimated_delivery_date"].dt.normalize()).astype(int),
        "outcome_available_date": orders["order_delivered_customer_date"],
    })
    if reviews is not None:
        reviews["review_score"] = pd.to_numeric(reviews["review_score"], errors="coerce")
        reviews = reviews.loc[reviews["review_score"].between(1, 5)].copy()
        if "review_answer_timestamp" in reviews:
            reviews["review_answer_timestamp"] = pd.to_datetime(reviews["review_answer_timestamp"], errors="coerce")
            reviews = reviews.sort_values("review_answer_timestamp", kind="stable", na_position="last")
        first_review = reviews.drop_duplicates("order_id", keep="first")[["order_id", "review_score"]]
        frame = frame.merge(first_review.rename(columns={"review_score": "review_rating"}),
                            on="order_id", how="left", validate="one_to_one")

    frame = frame.sort_values(["purchase_date", "order_id"], kind="stable").reset_index(drop=True)
    eligible_count = len(frame)
    if not eligible_count:
        raise ValueError("No delivered orders with valid dates and item values remain.")
    if max_rows is None and eligible_count > MAX_ROWS:
        raise ValueError("The cohort exceeds 100,000 rows. Specify max_rows to select a documented sample.")
    sampled = max_rows is not None and eligible_count > max_rows
    if sampled:
        frame = frame.iloc[np.linspace(0, eligible_count - 1, max_rows, dtype=int)].reset_index(drop=True)
    with path.open("rb") as stream:
        archive_sha = hashlib.file_digest(stream, "sha256").hexdigest()
    metadata = {
        "kind": "public", "label": "Olist historical delivered orders", "url": SOURCE_URL,
        "description": "Real historical anonymized Brazilian marketplace orders; delivered-order cohort only.",
        "license": "CC BY-NC-SA 4.0; check the publisher's terms for the downloaded release.",
        "archive_sha256": archive_sha, "raw_order_rows": raw_order_rows,
        "unique_orders": order_count, "eligible_orders": eligible_count, "output_rows": len(frame),
        "sampled": sampled, "sample_method": "Evenly spaced in chronological order" if sampled else "Full eligible delivered cohort",
        "excluded": {"not_delivered": not_delivered, "missing_or_invalid_dates": invalid_dates,
                     "nonpositive_delivery_or_invalid_promise": invalid_timeline, "without_valid_items": without_valid_items},
        "purchase_start": frame["purchase_date"].min().isoformat(), "purchase_end": frame["purchase_date"].max().isoformat(),
        "definitions": {
            "currency": "Source BRL; no currency conversion performed.",
            "order_value": "Sum of item prices, excluding freight; not profit or refund-adjusted revenue.",
            "delivery_late": "Delivered on a later calendar date than the estimated delivery date.",
            "category": "Original Portuguese category; '(multiple)' for orders spanning categories.",
            "seller_id": "Single source seller ID, or '(multiple)' for multi-seller orders.",
            "outcome_available_date": "Recorded actual customer-delivery timestamp; used to purge unavailable training labels.",
            "review_rating": "Earliest answered valid review when an answer timestamp is available; post-outcome, never a prediction feature.",
            "timestamps": "Source-naive timestamps retained; timezone is not established by this adapter.",
        },
        "limitations": [
            "Delivered-only selection excludes canceled and undelivered orders, creating survivorship bias.",
            "Recorded estimated delivery dates have no version history; order-time availability is an assumption.",
            "Daily counts are delivered-cohort purchase counts, not latent demand or complete incoming order volume.",
            "Forecast daily counts refer only to the selected sample." if sampled else "Historical results do not establish current business performance.",
            "No customer location, distance, product photograph or unavailable field is synthesized.",
        ],
    }
    frame.attrs["source"] = metadata
    frame.attrs["metadata"] = metadata
    return frame

