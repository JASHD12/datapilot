"""Export a blank human-review packet, or validate an explicitly completed one."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from datapilot.generation_study import (
    human_review_summary, review_template, validate_review, validate_study,
)


def load(path: Path):
    return json.loads(path.read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["export", "import"])
    parser.add_argument("--manifest", type=Path, default=Path("data/evaluation/generation_questions.json"))
    parser.add_argument("--retrieval-artifact", type=Path, default=Path("frontend/retrieval-study.json"))
    parser.add_argument("--study", type=Path, default=Path("frontend/generation-study.json"))
    parser.add_argument("--review", type=Path, help="Manually completed review packet (import only)")
    parser.add_argument("--recorded-review", "--published-review", dest="recorded_review", type=Path, default=Path("data/evaluation/generation_question_review.json"),
                        help="Review record behind the existing study's human-review summary")
    parser.add_argument("--output", type=Path, required=True, help="Local JSON output; use artifacts/ or .datapilot/")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    try:
        manifest = load(args.manifest)
        passages = load(args.retrieval_artifact)["passages"]
        study = load(args.study) if args.study.exists() else None
        if study is not None:
            existing_review = load(args.recorded_review) if args.recorded_review.exists() else None
            validate_study(study, manifest, existing_review)
        runs = [r for q in study["cases"] for r in q["runs"]] if study else []
        if args.action == "export":
            result = review_template(manifest, passages, runs if study else None)
            result["reference_material"] = {"questions": manifest["questions"], "passages": passages,
                                            "runs": runs,
                                            "instructions": "docs/GENERATION_REVIEW.md; template export is not human review."}
        else:
            if args.review is None or study is None:
                parser.error("import requires --review and an existing --study with actual model runs")
            result = load(args.review)
            validate_review(result, manifest, passages, runs)
        if args.output.exists() and not args.overwrite:
            parser.error("Output already exists; choose a new path or explicitly pass --overwrite.")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        summary = (human_review_summary(result, manifest, passages, runs) if args.action == "import"
                   else {"status": "pending_human_review", "metrics": None,
                         "note": "Blank template exported; no reviewer identity, attestation or judgments were supplied."})
        print(json.dumps({"output": str(args.output), "review": summary}, ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(1, f"Review validation failed: {error}\n")


if __name__ == "__main__":
    main()
