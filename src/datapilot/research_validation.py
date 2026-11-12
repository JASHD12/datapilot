"""Offline integrity checks for the published research artifacts.

Recompute reported scores from aggregate confusion matrices and judged rankings.
These checks catch stale or inconsistent reports; they cannot validate the human
meaning of rating targets or the correctness of seed relevance annotations.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from pathlib import Path


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def close(actual: float, expected: float, context: str) -> None:
    require(isinstance(actual, (int, float)) and math.isfinite(actual)
            and math.isclose(actual, expected, abs_tol=1e-10, rel_tol=1e-9), context)


def _fingerprint(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def validate_review_study(study: dict) -> None:
    require(study["schema_version"] == 1 and study["protocol"]["retrospective"] is True,
            "Review study must declare its retrospective protocol.")
    labels = study["labels"]
    require(len(labels) == 3 and len(set(labels)) == 3, "Expected three distinct rating groups.")
    partitions = [study["split"][name] for name in ["train", "validation", "test"]]
    for partition in partitions:
        require(partition["rows"] == sum(partition["class_counts"].values()), "Review split support mismatch.")
        require(datetime.fromisoformat(partition["start"]) <= datetime.fromisoformat(partition["end"]),
                "Review split dates are reversed.")
    require(all(datetime.fromisoformat(earlier["end"]) < datetime.fromisoformat(later["start"])
                for earlier, later in zip(partitions, partitions[1:])), "Review partitions overlap in time.")
    learned = [candidate for candidate in study["candidates"] if candidate["id"] != "majority"]
    selected = max(learned, key=lambda candidate: candidate["validation"]["macro_f1"])
    require(study["selected_model"]["id"] == selected["id"], "Selected review model disagrees with validation.")
    require(study["evaluations"]["test"]["rows"] == partitions[-1]["rows"], "Review test count mismatch.")
    require(study["evaluations"]["novel_text_test"]["rows"] + study["duplicates"]["test_seen_before_rows"]
            == partitions[-1]["rows"], "Novel/repeated wording counts do not account for the test set.")
    for name, evaluation in study["evaluations"].items():
        matrix = evaluation["confusion_matrix"]
        require(len(matrix) == 3 and all(len(row) == 3 for row in matrix), "Review confusion matrix shape mismatch.")
        require(all(isinstance(cell, int) and not isinstance(cell, bool) and cell >= 0
                    for row in matrix for cell in row), "Review confusion counts must be nonnegative integers.")
        support = [sum(row) for row in matrix]
        require(sum(support) == evaluation["rows"], "Review confusion matrix row count mismatch.")
        if not evaluation["rows"]:
            require(evaluation["metrics"] is None, "Empty review cohort must not have measured scores.")
            continue
        predicted_counts = [sum(row[column] for row in matrix) for column in range(3)]
        f1s = []
        for index, row in enumerate(evaluation["per_class"]):
            require(row["label"] == labels[index] and row["support"] == support[index], "Review class order/support mismatch.")
            true_positive = matrix[index][index]
            precision = true_positive / predicted_counts[index] if predicted_counts[index] else 0.0
            recall = true_positive / support[index] if support[index] else 0.0
            f1 = 2 * true_positive / (support[index] + predicted_counts[index]) if support[index] + predicted_counts[index] else 0.0
            for key, expected in [("precision", precision), ("recall", recall), ("f1", f1)]:
                close(row[key], expected, f"Review {name} {labels[index]} {key} disagrees with confusion counts.")
            f1s.append(f1)
        close(evaluation["metrics"]["accuracy"], sum(matrix[i][i] for i in range(3)) / evaluation["rows"], "Review accuracy mismatch.")
        close(evaluation["metrics"]["macro_f1"], sum(f1s) / 3, "Review macro-F1 mismatch.")
        close(evaluation["metrics"]["weighted_f1"], sum(score * count for score, count in zip(f1s, support)) / evaluation["rows"], "Review weighted-F1 mismatch.")


def validate_retrieval_study(study: dict, questions_manifest: dict | None = None) -> None:
    require(study["schema_version"] == 1, "Unrecognized retrieval study schema.")
    passages = study["passages"]
    ids = {passage["id"] for passage in passages}
    require(len(ids) == len(passages) == study["corpus"]["chunks"], "Retrieval corpus IDs/count mismatch.")
    require(_fingerprint(passages) == study["corpus"]["fingerprint"], "Retrieval corpus fingerprint mismatch.")
    if questions_manifest is not None:
        require(_fingerprint(questions_manifest) == study["benchmark"]["question_fingerprint"], "Retrieval question fingerprint mismatch.")
        require([{key: value for key, value in case.items() if key != "results"} for case in study["cases"]]
                == questions_manifest["questions"], "Recorded retrieval cases differ from the relevance manifest.")
    dimensions = study["model"]["dimensions"]
    parity = study["model"]["runtime_parity"]
    require(math.isfinite(parity["minimum_cosine"]) and 0.99 <= parity["minimum_cosine"] <= 1
            and len(parity["probes"]) == 3, "Invalid encoder compatibility protocol.")
    for probe in parity["probes"]:
        require(len(probe["embedding"]) == dimensions and all(math.isfinite(value) for value in probe["embedding"]),
                "Invalid reference embedding.")
        require(probe["token_ids"] and all(isinstance(value, int) and not isinstance(value, bool) and value >= 0
                                          for value in probe["token_ids"]), "Invalid reference token IDs.")
    require(len(study["passage_embeddings"]) == len(passages), "Embedding count differs from corpus size.")
    for vector in study["passage_embeddings"]:
        require(len(vector) == dimensions and all(isinstance(value, (int, float)) and math.isfinite(value) for value in vector), "Invalid dense embedding dimensions or values.")
        require(abs(sum(value * value for value in vector) - 1) < 1e-4, "Dense embeddings must be L2 normalized.")
    lexical = study["lexical_index"]
    require(len(lexical["vocabulary"]) == len(lexical["idf"]) and len(lexical["vectors"]) == len(passages), "Lexical index dimensions mismatch.")
    require(len(set(lexical["vocabulary"])) == len(lexical["vocabulary"]), "Lexical vocabulary is not unique.")
    require(all(math.isfinite(value) and value >= 1 for value in lexical["idf"]), "Invalid lexical IDF values.")
    cases = study["cases"]
    require(len({case["id"] for case in cases}) == len(cases), "Repeated retrieval question ID.")
    dev_intents = {case["intent"] for case in cases if case["split"] == "dev"}
    test_intents = {case["intent"] for case in cases if case["split"] == "test"}
    require(not dev_intents.intersection(test_intents), "Retrieval development/test intents overlap.")
    k = study["benchmark"]["ranking_k"]
    require(k == 3, "Expected the recorded top-three retrieval protocol.")
    for case in cases:
        relevant = set(case["relevant_ids"])
        require(relevant.issubset(ids) and bool(relevant) == case["answerable"], "Invalid relevance/answerability labels.")
        for method in study["methods"]:
            result = case["results"][method["id"]]
            hits = result["hits"]
            require(len(hits) == k and len({hit["id"] for hit in hits}) == k, "Invalid recorded ranking size or repeated IDs.")
            require(all(hit["id"] in ids and hit["rank"] == rank for rank, hit in enumerate(hits, 1)), "Invalid ranking source or rank position.")
            require(all(math.isfinite(hit["score"]) for hit in hits), "Non-finite retrieval score.")
            require(result["abstained"] == (hits[0]["score"] < method["threshold"]), "Abstention disagrees with the declared threshold.")
            if not case["answerable"]:
                require(result["metrics"] is None, "Unanswerable questions must not have ordinary relevance scores.")
                continue
            gains = [int(hit["id"] in relevant) for hit in hits]
            dcg = sum(gain / math.log2(rank + 2) for rank, gain in enumerate(gains))
            ideal = sum(1 / math.log2(rank + 2) for rank in range(min(k, len(relevant))))
            expected = {"recall_at_3": sum(gains) / len(relevant),
                        "mrr_at_3": next((1 / (rank + 1) for rank, gain in enumerate(gains) if gain), 0.0),
                        "ndcg_at_3": dcg / ideal, "hit_rate_at_3": float(any(gains))}
            for metric, value in expected.items():
                close(result["metrics"][metric], value, f"Retrieval {case['id']} {metric} disagrees with judged ranks.")
    for method in study["methods"]:
        for split in ["dev", "test"]:
            rows = [case for case in cases if case["split"] == split]
            answerable = [case for case in rows if case["answerable"]]
            negative = [case for case in rows if not case["answerable"]]
            summary = method[split]
            require(summary["questions"] == len(rows) == study["benchmark"][split + "_questions"], "Retrieval split count mismatch.")
            require(summary["answerable_questions"] == len(answerable) and summary["unanswerable_questions"] == len(negative), "Retrieval answerability count mismatch.")
            for metric, value in summary["answerable"].items():
                close(value, sum(case["results"][method["id"]]["metrics"][metric] for case in answerable) / len(answerable), "Retrieval aggregate ranking metric mismatch.")
            accepted = [case for case in rows if not case["results"][method["id"]]["abstained"]]
            close(summary["abstention"]["coverage"], len(accepted) / len(rows), "Retrieval coverage mismatch.")
            close(summary["abstention"]["unanswerable_abstain_rate"], sum(case["results"][method["id"]]["abstained"] for case in negative) / len(negative), "Retrieval abstention aggregate mismatch.")


def validate_research_directory(root: Path) -> dict:
    root = Path(root)
    def load(path: Path) -> dict:
        def invalid(value: str):
            raise ValueError(f"Non-finite JSON value in {path.name}: {value}")
        return json.loads(path.read_text(encoding="utf-8"), parse_constant=invalid)
    review = load(root / "frontend/review-study.json")
    retrieval = load(root / "frontend/retrieval-study.json")
    manifest = load(root / "data/evaluation/retrieval_questions.json")
    snapshot = load(root / "frontend/olist-snapshot.json")
    from .retrieval_study import corpus_from_snapshot
    require(_fingerprint(corpus_from_snapshot(snapshot)) == retrieval["corpus"]["fingerprint"],
            "Retrieval study is stale relative to the public Olist source corpus.")
    require(review["source"]["archive_sha256"] == snapshot["source"]["archive_sha256"],
            "Review study and public workspace use different Olist source archives.")
    validate_review_study(review)
    validate_retrieval_study(retrieval, manifest)
    from .generation_study import validate_study as validate_generation_study
    generation = load(root / "frontend/generation-study.json")
    generation_manifest = load(root / "data/evaluation/generation_questions.json")
    generation_review = load(root / "data/evaluation/generation_question_review.json")
    require(generation["corpus"]["fingerprint"] == retrieval["corpus"]["fingerprint"],
            "Generation and retrieval use different source corpora.")
    validate_generation_study(generation, generation_manifest, review=generation_review)
    protocol_files = generation["run_metadata"]["protocol_files"]
    require(set(protocol_files) == {"frontend/generation-core.js", "frontend/semantic-search.js", "cloudflare/generation-worker.js", "scripts/build_generation_worker.mjs"},
            "Unexpected generation protocol files.")
    for file, digest in protocol_files.items():
        require(hashlib.sha256((root / file).read_bytes()).hexdigest() == digest,
                "Generation protocol changed after the recorded experiment.")
    return {"review_test_rows": review["evaluations"]["test"]["rows"],
            "novel_wording_rows": review["evaluations"]["novel_text_test"]["rows"],
            "retrieval_passages": retrieval["corpus"]["chunks"], "retrieval_questions": len(retrieval["cases"]),
            "generation_questions": len(generation["cases"])}
