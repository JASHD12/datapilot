"""Build the measured semantic retrieval artifact using a pinned local model."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from datapilot.retrieval_study import OnnxEncoder, build_study, download_model


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, default=Path("frontend/olist-snapshot.json"))
    parser.add_argument("--questions", type=Path, default=Path("data/evaluation/retrieval_questions.json"))
    parser.add_argument("--model-dir", type=Path, default=Path(".datapilot/models/multilingual-e5-small"))
    parser.add_argument("--download-model", action="store_true", help="Download immutable public ONNX/tokenizer files (~136 MB). No API key needed.")
    parser.add_argument("--output", type=Path, default=Path("frontend/retrieval-study.json"))
    args = parser.parse_args()
    if args.download_model:
        download_model(args.model_dir)
    study = build_study(json.loads(args.snapshot.read_text()), json.loads(args.questions.read_text()), OnnxEncoder(args.model_dir))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(study, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"output": str(args.output), "corpus_chunks": study["corpus"]["chunks"],
                      "dev_questions": study["benchmark"]["dev_questions"], "test_questions": study["benchmark"]["test_questions"],
                      "methods": [{"id": method["id"], "threshold": method["threshold"], "test": method["test"]} for method in study["methods"]]}, indent=2))


if __name__ == "__main__":
    main()
