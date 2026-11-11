"""Sanitized historical Olist artifacts and portable numeric model inference.

The public host serves measured offline comparisons, plus small exported linear
models whose inference can run in a visitor's browser without an API key. It
does not train a model in the browser or establish current delivery performance.
"""
from __future__ import annotations

import hashlib
import json
import math
import platform
import time
from pathlib import Path
from zipfile import ZipFile

import numpy as np
import pandas as pd
import sklearn
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import Pipeline

from . import __version__
from .data import profile_frame
from .ml import (_prepare, _preprocessor, run_classification, run_forecast,
                 run_regression, run_segments)
from .olist import SOURCE_URL, load_olist_zip
from .store import fingerprint

PUBLIC_FEATURES = ["order_value", "freight_value", "promised_days", "items_count"]
FORECAST_START = "2017-01-01"
FORECAST_END = "2018-08-21"


def fit_browser_model(frame: pd.DataFrame, task: str) -> tuple[dict, Pipeline]:
    """Train a fixed numeric estimator and export its exact fitted preprocessing.

    The estimator is selected in advance for small, auditable browser inference,
    not selected by the final holdout score. The held-out comparison is reported
    separately by the standard workbench runner.
    """
    if task not in {"classification", "regression"}:
        raise ValueError("Browser inference supports classification or regression.")
    classifier = task == "classification"
    target = "delivery_late" if classifier else "delivery_days"
    _, x, y, labels, features, _, train, test, split = _prepare(
        frame, target, PUBLIC_FEATURES, classifier)
    if features != PUBLIC_FEATURES or any(not pd.api.types.is_numeric_dtype(x[c]) for c in features):
        raise ValueError("The public demonstration requires its four varying numeric order-time inputs.")
    estimator = (LogisticRegression(max_iter=700, class_weight="balanced", random_state=42)
                 if classifier else Ridge(alpha=10.0))
    pipeline = Pipeline([("preprocessor", _preprocessor(x.iloc[train])), ("model", estimator)])
    pipeline.fit(x.iloc[train], y[train])
    numeric = pipeline.named_steps["preprocessor"].named_transformers_["numeric"]
    imputer = numeric.named_steps["imputer"]
    scaler = numeric.named_steps["scaler"]
    model = pipeline.named_steps["model"]
    examples = x.iloc[test[:3]].copy()
    expected = (pipeline.predict_proba(examples)[:, 1] if classifier else pipeline.predict(examples))
    ranges = {}
    for feature in features:
        values = pd.to_numeric(x.iloc[train][feature], errors="coerce").dropna()
        ranges[feature] = {"min": float(values.min()), "max": float(values.max()),
                           "median": float(values.median())}
    payload = {
        "model": "logistic" if classifier else "ridge", "task": task, "target": target,
        "name": "Logistic regression" if classifier else "Ridge regression",
        "features": features, "impute": imputer.statistics_.astype(float).tolist(),
        "mean": scaler.mean_.astype(float).tolist(), "scale": scaler.scale_.astype(float).tolist(),
        "coefficients": np.asarray(model.coef_).reshape(-1).astype(float).tolist(),
        "intercept": float(np.asarray(model.intercept_).reshape(-1)[0]),
        "feature_ranges": ranges, "cutoff": split["cutoff"], "split": split,
        "train_rows": int(len(train)), "test_rows": int(len(test)),
        "selection_method": "Fixed in advance for auditable browser inference; not chosen by final holdout metrics.",
        "input_units": {"order_value": "BRL, item total excluding freight", "freight_value": "BRL",
                        "promised_days": "days from purchase to source estimate", "items_count": "items"},
        "validation_examples": [
            {"input": {str(k): None if pd.isna(v) else float(v) for k, v in row.items()},
             "expected": float(prediction)}
            for (_, row), prediction in zip(examples.iterrows(), expected)
        ],
        "limitations": [
            "Historical delivered-order cohort only; these scores do not establish current performance.",
            "Inputs outside the observed training range are extrapolations and may be unreliable.",
            "Source estimated-delivery fields have no version history; order-time availability is assumed.",
            "The classification score is not a validated calibrated probability, especially with class weighting."
            if classifier else "The ridge estimate is exploratory; the median baseline performs better in the recorded holdout.",
        ],
    }
    if classifier:
        payload.update({"positive_class": labels[1], "threshold": 0.5,
                        "score_label": "Uncalibrated late-delivery score"})
    else:
        payload["output_units"] = "days"
    return payload, pipeline


def predict_exported(payload: dict, values: dict) -> float:
    """Reference implementation of the same four-term formula used in JavaScript."""
    score = float(payload["intercept"])
    for i, feature in enumerate(payload["features"]):
        value = values.get(feature)
        try:
            value = float(value) if value is not None else float("nan")
        except (ValueError, TypeError):
            value = float("nan")
        if not math.isfinite(value):
            value = payload["impute"][i]
        score += (value - payload["mean"][i]) / payload["scale"][i] * payload["coefficients"][i]
    if payload["task"] == "classification":
        # Stable sigmoid, also straightforward to reproduce in a browser.
        return 1.0 / (1.0 + math.exp(-score)) if score >= 0 else math.exp(score) / (1.0 + math.exp(score))
    return score


def all_order_history(path: Path) -> pd.DataFrame:
    """Read raw purchases of every status; never count only delivered labels."""
    with ZipFile(path) as archive:
        with archive.open("olist_orders_dataset.csv") as stream:
            raw = pd.read_csv(stream, usecols=["order_id", "order_purchase_timestamp"])
    raw = raw.drop_duplicates("order_id")
    dates = pd.to_datetime(raw["order_purchase_timestamp"], errors="coerce")
    selected = dates.notna() & dates.ge(pd.Timestamp(FORECAST_START)) & dates.lt(pd.Timestamp(FORECAST_END) + pd.Timedelta(days=1))
    frame = pd.DataFrame({"purchase_date": dates.loc[selected]}).reset_index(drop=True)
    frame.attrs["source"] = {
        "kind": "public", "label": "Olist incoming order records, all statuses",
        "url": SOURCE_URL, "raw_unique_orders": int(len(raw)), "window_orders": int(len(frame)),
        "window_start": FORECAST_START, "window_end": FORECAST_END,
        "description": "All recorded purchase statuses within a declared historical window; no delivery-outcome filtering.",
        "limitation": "The sparse final archive tail after 21 August 2018 is excluded; this window is not proof of complete market demand.",
    }
    return frame


def build_olist_snapshot(zip_path: Path) -> dict:
    started = time.perf_counter()
    frame = load_olist_zip(Path(zip_path))
    results = {"classification": run_classification(frame), "regression": run_regression(frame),
               "segments": run_segments(frame)}
    results["segments"].pop("assignments", None)
    order_history = all_order_history(Path(zip_path))
    results["forecast"] = run_forecast(order_history)
    results["forecast"]["limitations"].append(
        "Counts include all recorded statuses in Jan 2017–21 Aug 2018, excluding the sparse archive tail. They are historical records, not current demand.")
    browser_models = {}
    for task in ("classification", "regression"):
        exported, pipeline = fit_browser_model(frame, task)
        exported["metrics"] = next(row["metrics"] for row in results[task]["models"] if row["name"] == exported["name"])
        for example in exported["validation_examples"]:
            if not np.isclose(predict_exported(exported, example["input"]), example["expected"], rtol=1e-12, atol=1e-12):
                raise AssertionError("Portable inference does not match the sklearn pipeline.")
        browser_models[task] = exported
    # Publish aggregate profiles and a tiny numeric preview, not raw order/seller IDs.
    public_frame = frame.drop(columns=["order_id", "seller_id"])
    profile = profile_frame(public_frame)
    profile["column_details"] = profile["columns"]
    profile["columns"] = len(profile["column_details"])
    profile["preview"] = profile["preview"][:12]
    source = dict(frame.attrs["metadata"])
    source.update({"kind": "public", "label": "Olist historical marketplace",
                   "source_url": SOURCE_URL, "license": "CC BY-NC-SA 4.0",
                   "description": "Historical public Olist orders: delivered-cohort models, all-status order-volume forecasting, no invented observations."})
    data_hash = fingerprint(frame)
    runtime = {"python": platform.python_version(), "numpy": np.__version__,
               "pandas": pd.__version__, "scikit_learn": sklearn.__version__}
    for task, result in results.items():
        result["provenance"] = {"id": hashlib.sha256(f"olist:{task}:{data_hash}".encode()).hexdigest()[:16],
                                "dataset_hash": fingerprint(order_history) if task == "forecast" else data_hash,
                                "task": task, "source": "public Olist archive", "runtime": runtime}
    snapshot = {
        "id": "olist-" + data_hash[:12], "name": "Olist marketplace study", "version": __version__,
        "dataset_hash": data_hash, "source": source, "profile": profile, "results": results,
        "browser_models": browser_models, "documents": [], "knowledge_chunks": [], "examples": [],
        "capabilities": {"uploads": False, "training": False, "llm_enabled": False, "browser_predictions": True},
        "runtime": runtime,
        "manifest": {"classification_and_regression_cohort": source,
                     "forecast_cohort": order_history.attrs["source"],
                     "snapshot_note": "Real historical offline experiments; small linear models support live browser inference. No raw dataset is bundled.",
                     "build_seconds": round(time.perf_counter() - started, 3)},
    }
    # Strict JSON is an authoring invariant before another module adds reviews.
    json.dumps(snapshot, allow_nan=False)
    return snapshot

