"""Reproduce the fixed-model delivery benchmark on a local Olist archive.

The archive and detailed JSON results stay outside version control. No network
request or provider call is made by this script.
"""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

from datapilot.ml import run_classification, run_regression
from datapilot.olist import load_olist_zip


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True, type=Path, help="Downloaded official Olist ZIP archive")
    parser.add_argument("--output", type=Path, default=Path("artifacts/olist-benchmark.json"))
    args = parser.parse_args()
    load_started = perf_counter()
    frame = load_olist_zip(args.zip)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": frame.attrs["metadata"],
        "environment": {"python": platform.python_version(), "system": platform.system(),
                        "machine": platform.machine(),
                        "packages": {name: importlib.metadata.version(name)
                                     for name in ["numpy", "pandas", "scikit-learn"]}},
        "load_seconds": round(perf_counter() - load_started, 3),
        "rows": len(frame),
        "positive_class_fraction": float(frame.delivery_late.mean()),
        "results": {},
    }
    for task, function in [("classification", run_classification), ("regression", run_regression)]:
        started = perf_counter()
        result = function(frame)
        result["elapsed_seconds"] = round(perf_counter() - started, 3)
        report["results"][task] = result
        print(json.dumps({"task": task, "elapsed_seconds": result["elapsed_seconds"],
                          "train_rows": result["train_rows"], "test_rows": result["test_rows"],
                          "features": result["features"], "split": result["split"],
                          "models": result["models"]}), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(f"Saved benchmark to {args.output}", flush=True)


if __name__ == "__main__":
    main()
