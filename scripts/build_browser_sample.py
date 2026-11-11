"""Export a bounded public Olist sample for genuine browser model training.

The full historical split is fixed first, and training labels unavailable at
that cutoff are purged by the standard workbench preparation code. Sampling
then happens separately within those established train and holdout sets.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from datapilot.ml import _prepare
from datapilot.olist import SOURCE_URL, load_olist_zip

FEATURES = ["order_value", "freight_value", "promised_days", "items_count"]
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "frontend" / "olist-training-sample.json"


def _bounded_indices(frame: pd.DataFrame, indices: np.ndarray, limit: int) -> np.ndarray:
    dates = pd.to_datetime(frame["purchase_date"], errors="raise", utc=True)
    chronological = dates.iloc[indices].sort_values(kind="stable").index.to_numpy(dtype=int)
    if len(chronological) <= limit:
        return chronological
    return chronological[np.linspace(0, len(chronological) - 1, limit, dtype=int)]


def _number(value):
    if pd.isna(value) or not math.isfinite(float(value)):
        return None
    return round(float(value), 6)


def _payload_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False,
                                     separators=(",", ":")).encode()).hexdigest()


def build_browser_sample(frame: pd.DataFrame, train_limit: int = 1600, test_limit: int = 400) -> dict:
    """Return real numeric rows and fixed labels, without identifiers or prose."""
    if isinstance(train_limit, bool) or not isinstance(train_limit, int) or not 20 <= train_limit <= 2000:
        raise ValueError("train_limit must be an integer between 20 and 2000.")
    if isinstance(test_limit, bool) or not isinstance(test_limit, int) or not 5 <= test_limit <= 1000:
        raise ValueError("test_limit must be an integer between 5 and 1000.")
    if "purchase_date" not in frame or "outcome_available_date" not in frame:
        raise ValueError("Purchase and outcome availability timestamps are required for this public training sample.")
    metadata = frame.attrs.get("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}
    source = {
        "dataset": "Brazilian E-Commerce Public Dataset by Olist",
        "source_url": SOURCE_URL,
        "license": "CC BY-NC-SA 4.0",
        "license_url": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "archive_sha256": metadata.get("archive_sha256"),
        "full_cohort_rows": int(len(frame)),
        "sampling": "Deterministic evenly spaced rows within each time-sorted, pre-established train and holdout set.",
        "precision": "Source numeric inputs and duration labels rounded to six decimal places; no measurements synthesized.",
        "timestamps": "Cutoffs use the preparation pipeline's UTC-normalized representation of source-naive timestamps; the source timezone is not established.",
        "scope": "Historical delivered-order cohort. The browser sample is not the complete Olist study or a representative population sample.",
        "input_units": {"order_value": "BRL excluding freight", "freight_value": "BRL",
                        "promised_days": "days", "items_count": "items"},
    }
    tasks = {}
    for task, target in [("classification", "delivery_late"), ("regression", "delivery_days")]:
        prepared, x, y, classes, names, excluded, train, test, full_split = _prepare(
            frame, target, FEATURES, task == "classification")
        if names != FEATURES:
            raise ValueError("The sample requires all four varying numeric order-time features.")
        train_sample = _bounded_indices(prepared, train, train_limit)
        test_sample = _bounded_indices(prepared, test, test_limit)
        dates = pd.to_datetime(prepared["purchase_date"], utc=True)
        available = pd.to_datetime(prepared["outcome_available_date"], utc=True)
        cutoff = pd.Timestamp(full_split["cutoff"])
        if not (available.iloc[train_sample] < cutoff).all():
            raise AssertionError("A sampled training label was not available at the historical cutoff.")
        if not (dates.iloc[train_sample] < cutoff).all() or not (dates.iloc[test_sample] >= cutoff).all():
            raise AssertionError("The sample crosses its fixed temporal boundary.")
        if task == "classification" and set(y[train_sample].tolist()) != {0, 1}:
            raise ValueError("The evenly spaced classification training sample does not contain both labels.")
        def partition(indices):
            return {
                "x": [[_number(value) for value in row] for row in x.iloc[indices].to_numpy()],
                "y": [int(value) if task == "classification" else _number(value) for value in y[indices]],
            }
        split = {
            **full_split,
            "full_train_rows": int(len(train)), "full_test_rows": int(len(test)),
            "sample_train_rows": int(len(train_sample)), "sample_test_rows": int(len(test_sample)),
            "sample_train_start": dates.iloc[train_sample].min().isoformat(),
            "sample_train_end": dates.iloc[train_sample].max().isoformat(),
            "sample_test_start": dates.iloc[test_sample].min().isoformat(),
            "sample_test_end": dates.iloc[test_sample].max().isoformat(),
            "latest_sample_training_label_available": available.iloc[train_sample].max().isoformat(),
            "sampling": source["sampling"],
        }
        payload = {"features": FEATURES.copy(), "target": target,
                   "train": partition(train_sample), "test": partition(test_sample),
                   "split": split, "source": source.copy(),
                   "limitations": [
                       "These are sampled historical orders, not the full-cohort benchmark.",
                       "Model settings are fixed in advance; the holdout is not for tuning.",
                       "Use training rows only to fit imputers, scaling and estimators.",
                       "Selection includes delivered orders only and excludes canceled or undelivered outcomes.",
                   ]}
        if task == "classification":
            payload["classes"] = classes
            payload["positive_class"] = classes[1]
            payload["class_counts"] = {
                part: {str(label): int(np.sum(y[indices] == label)) for label in (0, 1)}
                for part, indices in [("train", train_sample), ("test", test_sample)]
            }
        payload["sample_sha256"] = _payload_hash(payload)
        tasks[task] = payload
    source["cutoff"] = tasks["regression"]["split"]["cutoff"]
    result = {"version": "1", "source": source, "tasks": tasks}
    validate_browser_sample(result)
    return result


def validate_browser_sample(sample: dict) -> None:
    if sample.get("version") != "1" or set(sample.get("tasks", {})) != {"classification", "regression"}:
        raise ValueError("Unrecognized browser training sample format.")
    if sample["source"].get("license") != "CC BY-NC-SA 4.0":
        raise ValueError("The source license must accompany the sample.")
    checksum = sample["source"].get("archive_sha256")
    if not isinstance(checksum, str) or len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
        raise ValueError("The source archive must have a SHA-256 checksum.")
    for task, payload in sample["tasks"].items():
        if payload.get("features") != FEATURES:
            raise ValueError("Only the four declared order-time inputs may be published.")
        if payload.get("target") != ("delivery_late" if task == "classification" else "delivery_days"):
            raise ValueError("Unexpected prediction target.")
        for part, minimum, maximum in [("train", 20, 2000), ("test", 5, 1000)]:
            values = payload[part]
            if not minimum <= len(values["x"]) <= maximum or len(values["x"]) != len(values["y"]):
                raise ValueError("Training partitions have invalid dimensions.")
            for row in values["x"]:
                if len(row) != len(FEATURES) or any(v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)) for v in row):
                    raise ValueError("Only finite numeric inputs or null values are allowed.")
            if any(isinstance(y, bool) or not isinstance(y, (int, float)) or not math.isfinite(y) for y in values["y"]):
                raise ValueError("Targets must be finite numbers.")
            if task == "classification" and not set(values["y"]).issubset({0, 1}):
                raise ValueError("Classification targets must be binary.")
        if task == "classification" and set(payload["train"]["y"]) != {0, 1}:
            raise ValueError("Classification training requires both classes.")
        cutoff = pd.Timestamp(payload["split"]["cutoff"])
        if not pd.Timestamp(payload["split"]["sample_train_end"]) < cutoff <= pd.Timestamp(payload["split"]["sample_test_start"]):
            raise ValueError("The sample does not preserve its temporal cutoff.")
        if not pd.Timestamp(payload["split"]["latest_sample_training_label_available"]) < cutoff:
            raise ValueError("Training labels were unavailable at the sample cutoff.")
        check = {key: value for key, value in payload.items() if key != "sample_sha256"}
        if _payload_hash(check) != payload.get("sample_sha256"):
            raise ValueError("The browser training sample checksum is invalid.")
    json.dumps(sample, allow_nan=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, help="Downloaded official Olist source archive")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="Validate the saved numeric artifact without raw data")
    args = parser.parse_args()
    if args.check:
        sample = json.loads(args.output.read_text())
        validate_browser_sample(sample)
    else:
        if args.zip is None:
            parser.error("--zip is required when building the browser sample")
        sample = build_browser_sample(load_olist_zip(args.zip))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(sample, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    print(json.dumps({"validated": True, "path": str(args.output), "bytes": args.output.stat().st_size,
                      "tasks": {task: {"train": len(data["train"]["y"]), "holdout": len(data["test"]["y"])}
                                for task, data in sample["tasks"].items()}}))


if __name__ == "__main__":
    main()
