"""Assemble the public Olist workspace. Never read a local uploaded workspace."""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from datapilot import __version__
from datapilot.knowledge import KnowledgeBase
from datapilot.public_demo import build_olist_snapshot, predict_exported
from datapilot.reviews import build_review_analysis

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "frontend" / "olist-snapshot.json"


def validate(snapshot: dict):
    assert snapshot["source"]["kind"] == "public"
    assert snapshot["source"]["license"] == "CC BY-NC-SA 4.0"
    assert snapshot["profile"]["rows"] == snapshot["source"]["eligible_orders"]
    assert not {"order_id", "seller_id"}.intersection(snapshot["profile"]["preview"][0])
    assert set(snapshot["results"]) == {"classification", "regression", "forecast", "segments"}
    assert snapshot["review_analysis"]["test_rows"] > 0
    assert len(snapshot["review_analysis"]["models"]) >= 2
    assert len(snapshot["knowledge_chunks"]) > 4
    assert all(chunk.get("source") and chunk.get("text") for chunk in snapshot["knowledge_chunks"])
    assert snapshot["capabilities"]["llm_enabled"] is False
    for model in snapshot["browser_models"].values():
        for example in model["validation_examples"]:
            assert abs(predict_exported(model, example["input"]) - example["expected"]) < 1e-9
    json.dumps(snapshot, allow_nan=False)


def assemble(zip_path: Path):
    snapshot = build_olist_snapshot(zip_path)
    review_result = build_review_analysis(zip_path)
    snapshot["review_analysis"] = review_result["analysis"]
    # Include actual dataset/method descriptions. The fictional synthetic policy
    # is intentionally absent from the public Olist evidence library.
    knowledge = KnowledgeBase(ROOT / "data" / "documents")
    allowed = {"olist_workspace.md", "ml_method_notes.md"}
    chunks = [dict(chunk, source_url="https://github.com/JASHD12/datapilot/blob/main/data/documents/" + chunk["source"])
              for chunk in knowledge._chunks if chunk["source"] in allowed]
    snapshot["documents"] = [doc for doc in knowledge.documents() if doc["source"] in allowed]
    snapshot["documents"].append({"id": "olist-review-evidence", "title": "Portuguese review evidence",
                                  "source": "Olist public review dataset", "filename": "Bounded source excerpts",
                                  "bytes": sum(len(c["text"].encode()) for c in review_result["review_chunks"]),
                                  "chunks": len(review_result["review_chunks"])})
    snapshot["knowledge_chunks"] = chunks + review_result["review_chunks"]
    snapshot["examples"] = [{"question": question} for question in [
        "How many orders and reviews are in this workspace?",
        "Compare the delivery model results with their baselines.",
        "What does the historical order forecast show?",
        "Which complaints appear in negative reviews?",
        "Generate a combined workspace report.",
    ]]
    snapshot["version"] = __version__
    snapshot["capabilities"].update({"browser_evidence_reports": True, "review_analysis": True})
    snapshot["attribution"] = {
        "dataset": "Brazilian E-Commerce Public Dataset by Olist",
        "publisher": "Olist", "url": "https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce",
        "license": "CC BY-NC-SA 4.0", "license_url": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "modifications": "Filtered/aggregated records; trained models; bounded redacted Portuguese review excerpts; offline evaluation.",
        "notice": "Educational noncommercial demonstration. No current Olist service connection or endorsement.",
    }
    validate(snapshot)
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, help="Downloaded official Olist ZIP")
    parser.add_argument("--check", action="store_true", help="Validate the saved public artifact without raw data")
    parser.add_argument("--package-only", action="store_true", help="Copy existing frontend assets to dist")
    args = parser.parse_args()
    if args.check or args.package_only:
        snapshot = json.loads(SNAPSHOT.read_text())
        validate(snapshot)
    else:
        if args.zip is None:
            parser.error("--zip is required to rebuild the public workspace")
        snapshot = assemble(args.zip)
        SNAPSHOT.write_text(json.dumps(snapshot, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    if not args.check:
        target = ROOT / "dist"
        target.mkdir(exist_ok=True)
        for file in (ROOT / "frontend").iterdir():
            if file.is_file():
                shutil.copyfile(file, target / file.name)
        (target / ".nojekyll").touch()
    print(json.dumps({"checked": True, "version": snapshot["version"], "delivered_orders": snapshot["profile"]["rows"],
                      "review_texts": snapshot["review_analysis"]["labeled_rows"],
                      "public_review_excerpts": snapshot["review_analysis"]["public_excerpt_count"],
                      "model_inference": "browser", "generation": "deterministic evidence reports; no LLM"}))


if __name__ == "__main__":
    main()

