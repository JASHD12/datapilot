from pathlib import Path
from zipfile import ZipFile

import pandas as pd
import pytest

from datapilot.olist import load_olist_zip


def write_archive(path: Path, *, conflicting=False):
    orders = pd.DataFrame([
        {"order_id": "a", "order_status": "delivered", "order_purchase_timestamp": "2017-01-01 12:00:00", "order_delivered_customer_date": "2017-01-04 16:00:00", "order_estimated_delivery_date": "2017-01-04 00:00:00"},
        {"order_id": "b", "order_status": "delivered", "order_purchase_timestamp": "2017-02-01 12:00:00", "order_delivered_customer_date": "2017-02-06 16:00:00", "order_estimated_delivery_date": "2017-02-04 00:00:00"},
        {"order_id": "c", "order_status": "canceled", "order_purchase_timestamp": "2017-03-01", "order_delivered_customer_date": None, "order_estimated_delivery_date": "2017-03-04"},
    ])
    if conflicting:
        orders = pd.concat([orders, orders.iloc[[0]].assign(order_status="canceled")])
    items = pd.DataFrame([
        {"order_id": "a", "order_item_id": 1, "product_id": "x", "seller_id": "s1", "price": 10, "freight_value": 2},
        {"order_id": "a", "order_item_id": 2, "product_id": "y", "seller_id": "s2", "price": 20, "freight_value": 3},
        {"order_id": "b", "order_item_id": 1, "product_id": "x", "seller_id": "s1", "price": 7, "freight_value": 1},
    ])
    products = pd.DataFrame([{"product_id": "x", "product_category_name": "books"}, {"product_id": "y", "product_category_name": "home"}])
    reviews = pd.DataFrame([
        {"order_id": "a", "review_score": 5, "review_answer_timestamp": "2017-01-05"},
        {"order_id": "a", "review_score": 1, "review_answer_timestamp": "2017-01-08"},
        {"order_id": "b", "review_score": 2, "review_answer_timestamp": "2017-02-08"},
    ])
    with ZipFile(path, "w") as archive:
        for name, frame in [("olist_orders_dataset.csv", orders), ("olist_order_items_dataset.csv", items), ("olist_products_dataset.csv", products), ("olist_order_reviews_dataset.csv", reviews)]:
            archive.writestr(name, frame.to_csv(index=False))


def test_order_aggregation_and_reviews_never_multiply_rows(tmp_path):
    path = tmp_path / "orders.zip"
    write_archive(path)
    frame = load_olist_zip(path)
    assert len(frame) == 2
    first = frame.iloc[0]
    assert first.order_value == 30
    assert first.freight_value == 5
    assert first.items_count == 2
    assert first.category == "(multiple)"
    assert first.seller_id == "(multiple)"
    assert first.review_rating == 5
    assert "distance_km" not in frame
    assert frame.attrs["source"]["excluded"]["not_delivered"] == 1
    assert frame.attrs["source"]["eligible_orders"] == 2


def test_calendar_date_label_and_actual_availability_are_explicit(tmp_path):
    path = tmp_path / "orders.zip"
    write_archive(path)
    frame = load_olist_zip(path)
    assert frame.delivery_late.tolist() == [0, 1]
    assert frame.outcome_available_date.iloc[0] == pd.Timestamp("2017-01-04 16:00:00")
    assert (frame.outcome_available_date > frame.purchase_date).all()
    assert frame.purchase_date.dt.tz is None


def test_sample_is_documented_and_deterministic(tmp_path):
    path = tmp_path / "orders.zip"
    write_archive(path)
    first = load_olist_zip(path, max_rows=1)
    second = load_olist_zip(path, max_rows=1)
    pd.testing.assert_frame_equal(first, second)
    assert first.attrs["source"]["sampled"]
    assert first.attrs["source"]["eligible_orders"] == 2
    assert first.attrs["source"]["output_rows"] == 1
    assert any("selected sample" in text for text in first.attrs["source"]["limitations"])


def test_conflicting_order_keys_are_rejected(tmp_path):
    path = tmp_path / "orders.zip"
    write_archive(path, conflicting=True)
    with pytest.raises(ValueError, match="conflicting duplicate"):
        load_olist_zip(path)


def test_missing_archive_and_invalid_limits_are_rejected(tmp_path):
    with pytest.raises(ValueError, match="downloaded Olist"):
        load_olist_zip(tmp_path / "missing.zip")
    path = tmp_path / "orders.zip"
    write_archive(path)
    with pytest.raises(ValueError, match="max_rows"):
        load_olist_zip(path, max_rows=0)
