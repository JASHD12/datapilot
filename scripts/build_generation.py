"""Package actual hosted LLM runs and fingerprint-bound review into the public study."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from datapilot.generation_study import build_study, validate_study


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=Path, default=Path("artifacts/generation-runs.json"))
    parser.add_argument("--review", type=Path, default=Path("data/evaluation/generation_question_review.json"))
    parser.add_argument("--output", type=Path, default=Path("frontend/generation-study.json"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = json.loads(Path("data/evaluation/generation_questions.json").read_text())
    passages = json.loads(Path("frontend/retrieval-study.json").read_text())["passages"]
    review = json.loads(args.review.read_text()) if args.review.exists() else None
    if args.check:
        study = json.loads(args.output.read_text())
    else:
        recorded = json.loads(args.runs.read_text())
        study = build_study(manifest, recorded["runs"], passages=passages,
                            model=recorded["model"], run_metadata=recorded["run_metadata"], review=review)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(study, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    validate_study(study, manifest, review=review)
    files = study["run_metadata"]["protocol_files"]
    expected = {"frontend/generation-core.js", "frontend/semantic-search.js", "cloudflare/generation-worker.js", "scripts/build_generation_worker.mjs"}
    if set(files) != expected:
        raise ValueError("Unexpected generation protocol files.")
    for name, digest in files.items():
        if hashlib.sha256(Path(name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"Generation protocol differs from recorded model runs: {name}")
    print(json.dumps({"generation_checked": True, "questions": len(study["cases"]),
                      "runs": sum(len(q["runs"]) for q in study["cases"]),
                      "human_review": study["benchmark"]["human_review"],
                      "methods": [{"id": m["id"], "test": m["splits"]["test"]} for m in study["methods"]]}, indent=2))


if __name__ == "__main__":
    main()
