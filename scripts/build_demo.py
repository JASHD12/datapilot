"""Build a sanitized replay from a fresh deterministic fixture, never local uploads."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import tempfile
from pathlib import Path

import numpy
import pandas
import sklearn

from datapilot import __version__
from datapilot.api import normalized_profile
from datapilot.assistant import answer_question
from datapilot.data import demo_frame
from datapilot.knowledge import KnowledgeBase
from datapilot.ml import run_classification, run_forecast, run_regression, run_segments
from datapilot.store import fingerprint

ROOT = Path(__file__).resolve().parents[1]


def build():
    frame = demo_frame()
    results = {"classification": run_classification(frame), "regression": run_regression(frame),
               "forecast": run_forecast(frame), "segments": run_segments(frame)}
    # Row-level cluster assignments are not needed by the public replay.
    results["segments"].pop("assignments", None)
    dataset_hash = fingerprint(frame)
    runtime = {"python": platform.python_version(), "numpy": numpy.__version__,
               "pandas": pandas.__version__, "scikit_learn": sklearn.__version__}
    for task, result in results.items():
        result["provenance"] = {"id": hashlib.sha256(f"{task}:{dataset_hash}".encode()).hexdigest()[:16],
                                "dataset_hash": dataset_hash, "task": task, "seed": 42,
                                "source": "synthetic", "runtime": runtime}
    knowledge = KnowledgeBase(ROOT / "data" / "documents")
    profile = normalized_profile(frame)
    questions = ["How many orders are in this dataset?", "Show the model performance metrics",
                 "What is the recorded forecast?", "How do you prevent data leakage?",
                 "Does the model prove what caused delivery delays?"]
    snapshot = {"id": dataset_hash[:12], "name": "Operations lab", "version": __version__,
                "dataset_hash": dataset_hash, "source": {"kind": "synthetic", "label": "Synthetic order simulation",
                  "description": "1,400 generated demonstration orders, not real customer records.", "seed": 42},
                "profile": profile, "results": results, "documents": knowledge.documents(),
                "knowledge_chunks": knowledge._chunks,
                "examples": [{"question": question,
                              "response": answer_question(question, profile, results, knowledge)} for question in questions],
                "capabilities": {"uploads": False, "training": False, "llm_enabled": False},
                "runtime": runtime}
    return snapshot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Validate the saved snapshot against the current fixture")
    args = parser.parse_args()
    path = ROOT / "frontend" / "demo-snapshot.json"
    if args.check:
        snapshot = json.loads(path.read_text())
        assert snapshot["dataset_hash"] == fingerprint(demo_frame()), "Snapshot fixture is stale; rebuild it."
        assert set(snapshot["results"]) == {"classification", "regression", "forecast", "segments"}
        assert len(snapshot["examples"]) >= 4
        assert snapshot["source"]["kind"] == "synthetic"
        json.dumps(snapshot, allow_nan=False)
        print("Saved replay validated: dataset fingerprint, four experiments, evidence reports and strict JSON.")
        return
    snapshot = build()
    path.write_text(json.dumps(snapshot, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    for file in (ROOT / "frontend").iterdir():
        if file.is_file():
            shutil.copyfile(file, dist / file.name)
    print(f"Built replay: {snapshot['profile']['rows']} synthetic rows, four measured experiments, {len(snapshot['examples'])} evidence reports.")


if __name__ == "__main__":
    main()

