"""Audit real LLM runs without confusing citation syntax with factual support.

Seed labels are provisional. Human review is a separate, fingerprint-bound
artifact; exporting a review template never creates completed human judgments.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from typing import Any

VARIANTS = ("plain", "grounded", "grounded_validated")
TITLES = {"plain": "LLM without evidence", "grounded": "LLM with retrieved evidence",
          "grounded_validated": "Same grounded output with structural validation"}
REVIEW_ATTESTATION = "I am a human reviewer. I personally checked each question or answer judgment marked complete in this file against the cited source material."
PENDING = "pending_human_review"
ERROR_STATUSES = {"error", "provider_error", "infrastructure_error", "timeout", "cancelled", "quota_exceeded", "rate_limited"}
# ECMAScript trim() whitespace and UTF-16 slicing match normalizeContexts in the
# browser protocol, including non-ASCII text at an excerpt boundary.
JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def _js_slice(text: str, length: int) -> str:
    return text.encode("utf-16-le", errors="surrogatepass")[:length * 2].decode("utf-16-le", errors="surrogatepass")


def validate_contexts(runs: list[dict], passages: list[dict]) -> None:
    """Bind the actual excerpts, order and source labels to the frozen corpus.

    Retrieval scores/selection are checked by the JavaScript replay, which has
    the lexical index. This check establishes the identity of supplied evidence.
    """
    known = {p["id"]: p for p in passages}
    for run in runs:
        contexts = run.get("contexts")
        require(isinstance(contexts, list) and len(contexts) <= 3,
                "Recorded normalized contexts are required (at most three).")
        require(all(isinstance(item, dict) for item in contexts)
                and [item.get("id") for item in contexts] == run["context_ids"],
                "Context IDs/order differ from the actual recorded excerpts.")
        for index, item in enumerate(contexts):
            require(item["id"] in known, "Generation contains an unknown context source.")
            passage = known[item["id"]]
            expected = {
                "id": passage["id"], "citation": f"S{index + 1}",
                "text": _js_slice(passage["text"].strip(JS_WHITESPACE), 1000),
                "title": _js_slice(passage.get("title") or passage.get("source") or "Source excerpt", 200),
                "source": _js_slice(passage.get("source") or "Public demonstration corpus", 200),
                "section": _js_slice(passage.get("section") or "", 200),
                "source_url": _js_slice(passage["source_url"], 1000) if isinstance(passage.get("source_url"), str) else "",
            }
            # The runtime may normalize a context returned by retrieval again;
            # only boundary whitespace removed by that same operation may vary.
            require(item.get("text") in {expected["text"], expected["text"].strip(JS_WHITESPACE)},
                    "Recorded context text differs from its normalized corpus excerpt.")
            require(all(item.get(key) == value for key, value in expected.items() if key != "text")
                    and set(item).issubset(set(expected) | {"score", "rank"}),
                    "Recorded context citation/source metadata differs from the corpus.")
            if "score" in item:
                require(isinstance(item["score"], (int, float)) and not isinstance(item["score"], bool)
                        and math.isfinite(item["score"]), "Invalid recorded retrieval score.")
            if "rank" in item:
                require(type(item["rank"]) is int and item["rank"] == index + 1, "Invalid recorded retrieval rank.")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def validate_manifest(manifest: dict, passages: list[dict]) -> None:
    require(isinstance(manifest, dict) and manifest.get("schema_version") == 1, "Invalid generation question schema.")
    require(manifest.get("annotation_status") == PENDING, "Seed manifest must retain its pending-human-review status.")
    require(manifest.get("corpus_fingerprint") == fingerprint(passages), "Generation corpus fingerprint mismatch.")
    ids = {p["id"] for p in passages}
    require(len(ids) == len(passages) and bool(ids), "Corpus IDs must be nonempty and unique.")
    questions = manifest.get("questions")
    require(isinstance(questions, list) and bool(questions), "Generation questions are missing.")
    seen: set[str] = set()
    families = {"dev": set(), "test": set()}
    for q in questions:
        require(isinstance(q, dict) and isinstance(q.get("id"), str) and q["id"] not in seen and bool(q["id"]), "Question IDs must be unique.")
        seen.add(q["id"])
        require(q.get("split") in families, "Questions need development/test splits.")
        require(isinstance(q.get("category"), str) and bool(q["category"]), "Question family is missing.")
        families[q["split"]].add(q["category"])
        require(isinstance(q.get("question"), str) and 2 <= len(q["question"]) <= 2000, "Invalid generation question text.")
        require(type(q.get("answerable")) is bool, "Answerability must be Boolean.")
        relevant = q.get("relevant_passage_ids")
        require(isinstance(relevant, list) and all(isinstance(pid, str) for pid in relevant)
                and len(set(relevant)) == len(relevant) and set(relevant).issubset(ids), "Unknown or repeated relevant passage ID.")
        require(bool(relevant) == q["answerable"], "Answerability and relevant passages disagree.")
        facts = q.get("expected_facts")
        require(isinstance(facts, list) and all(isinstance(f, str) and bool(f.strip()) for f in facts), "Invalid manual expected-fact rubric.")
        require(bool(facts), "Every case needs a manual review rubric, including unsupported cases.")
        require(q.get("annotation_status") == PENDING and q.get("review") is None, "Agent-authored cases cannot claim completed human review.")
    require(all(families.values()) and not families["dev"].intersection(families["test"]), "Question families must be disjoint across development/test.")
    for split in families:
        require({q["answerable"] for q in questions if q["split"] == split} == {True, False}, "Each split must include supported and unsupported questions.")


def _count(value: Any, field: str) -> int:
    if isinstance(value, list):
        return len(value)
    require(type(value) is int and value >= 0, f"Invalid {field} count.")
    return value


def validate_runs(manifest: dict, runs: list[dict], *, complete: bool = True) -> None:
    question_ids = {q["id"] for q in manifest["questions"]}
    seen = set()
    indexed = {}
    require(isinstance(runs, list), "Runs must be a list.")
    for run in runs:
        require(isinstance(run, dict), "Invalid generation run.")
        key = (run.get("question_id"), run.get("variant"))
        require(key[0] in question_ids and key[1] in VARIANTS and key not in seen, "Unknown question/variant or duplicate generation run.")
        seen.add(key)
        indexed[key] = run
        require(all(isinstance(run.get(k), str) for k in ["raw_answer", "answer", "status"]), "Run output/status must be text.")
        require(run["status"] in {"generated", "accepted", "abstained", "blocked", "rejected"} | ERROR_STATUSES
                and len(run["raw_answer"]) <= 20000 and len(run["answer"]) <= 20000, "Invalid or oversized generated output.")
        require(isinstance(run.get("context_ids"), list) and all(isinstance(p, str) for p in run["context_ids"]), "Actual context IDs are required.")
        require(len(set(run["context_ids"])) == len(run["context_ids"]), "Repeated context ID.")
        checks = run.get("checks", {})
        require(type(checks.get("accepted")) is bool and type(checks.get("abstained")) is bool, "Structural check booleans are required.")
        require(isinstance(checks.get("citations"), list) and isinstance(checks.get("reasons"), list), "Citation/reason lists are required.")
        _count(checks.get("invalid_citations"), "invalid-citation")
        _count(checks.get("uncited_sentences"), "uncited-sentence")
        timings = run.get("timings", {})
        require(all(isinstance(timings.get(k), (int, float)) and not isinstance(timings[k], bool)
                    and math.isfinite(timings[k]) and timings[k] >= 0 for k in ["generation_ms", "total_ms"]), "Generation timings must be finite nonnegative milliseconds.")
        require(timings["total_ms"] >= timings["generation_ms"], "Total latency cannot be less than generation latency.")
        if run["variant"] == "plain":
            require(not run["context_ids"], "The no-evidence baseline cannot receive passages.")
        if run["variant"] == "grounded_validated":
            require(run.get("reuse_of") == "grounded", "Validated variant must declare reuse of the grounded generation.")
    if complete:
        require(seen == {(q, variant) for q in question_ids for variant in VARIANTS}, "Incomplete generation run matrix.")
    for (question_id, variant), run in indexed.items():
        if variant == "grounded_validated" and (question_id, "grounded") in indexed:
            original = indexed[(question_id, "grounded")]
            require(run["raw_answer"] == original["raw_answer"] and run["context_ids"] == original["context_ids"], "Validated output does not reuse its grounded raw generation/context.")
            require(run.get("contexts") == original.get("contexts"), "Validated output does not reuse its grounded source excerpts.")
            require(run["timings"]["generation_ms"] == original["timings"]["generation_ms"], "Reused generation must preserve its generation latency.")


def _abstained(text: str) -> bool:
    return text.strip().strip(".!").strip() == "INSUFFICIENT_EVIDENCE"


def _quantiles(values: list[float]) -> dict | None:
    if not values:
        return None
    ordered = sorted(values)
    def at(p):
        position = (len(ordered) - 1) * p
        lower = math.floor(position)
        upper = math.ceil(position)
        return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
    return {"median": at(.5), "p95": at(.95), "min": ordered[0], "max": ordered[-1]}


def _summary(rows: list[tuple[dict, dict]], question_status: str) -> dict:
    completed = [(q, r) for q, r in rows if r["status"] not in ERROR_STATUSES]
    size = len(completed)
    unanswered = [(q, r) for q, r in completed if not q["answerable"]]
    answerable = [(q, r) for q, r in completed if q["answerable"]]
    def refused(run):
        return run["checks"]["abstained"] or _abstained(run["answer"]) or run["status"] in {"blocked", "rejected", "abstained"}
    def rate(count, denominator=size):
        return count / denominator if denominator else None
    label_basis = {
        PENDING: "Provisional AI-authored answerability labels; not human-validated answer correctness.",
        "human_questions_reviewed": "AI-authored answerability labels with recorded human review; question-label review does not establish generated answer correctness.",
        "corrections_required": "AI-authored answerability labels require correction; these metrics use the original labels, not the proposed corrections.",
    }[question_status]
    return {"count": len(rows), "evaluated_count": size, "error_count": len(rows) - size,
            "error_rate": rate(len(rows) - size, len(rows)),
            "metric_denominators": {"responses": size, "answerable_responses": len(answerable), "unanswerable_responses": len(unanswered)},
            "accepted_rate": rate(sum(r["checks"]["accepted"] for _, r in completed)),
            "raw_abstention_rate": rate(sum(_abstained(r["raw_answer"]) for _, r in completed)),
            "served_refusal_rate": rate(sum(refused(r) for _, r in completed)),
            "abstention_rate": rate(sum(refused(r) for _, r in completed)),
            "unanswerable_abstain_rate": rate(sum(refused(r) for _, r in unanswered), len(unanswered)),
            "answerable_answer_rate": rate(sum(bool(r["answer"].strip()) and not refused(r) for _, r in answerable), len(answerable)),
            "invalid_citation_rate": rate(sum(_count(r["checks"]["invalid_citations"], "invalid-citation") > 0 for _, r in completed)),
            "uncited_sentence_response_rate": rate(sum(_count(r["checks"]["uncited_sentences"], "uncited-sentence") > 0 for _, r in completed)),
            "timings": {key: _quantiles([r["timings"][key] for _, r in completed]) for key in ["generation_ms", "total_ms"]},
            "error_policy": "Infrastructure errors are reported separately and excluded from response-quality and latency metrics; they are not model refusals.",
            "label_basis": label_basis,
            "structural_checks_only": True}


def summarize_runs(manifest: dict, runs: list[dict], *, question_status: str = PENDING) -> list[dict]:
    validate_runs(manifest, runs)
    require(question_status in {PENDING, "human_questions_reviewed", "corrections_required"}, "Invalid question-label review status.")
    questions = {q["id"]: q for q in manifest["questions"]}
    methods = []
    for variant in VARIANTS:
        rows = [(questions[r["question_id"]], r) for r in runs if r["variant"] == variant]
        combined = _summary(rows, question_status)
        methods.append({"id": variant, "title": TITLES[variant],
                        "counts": {"runs": len(rows), "dev": sum(q["split"] == "dev" for q, _ in rows), "test": sum(q["split"] == "test" for q, _ in rows)},
                        "splits": {split: _summary([(q, r) for q, r in rows if q["split"] == split], question_status) for split in ["dev", "test"]},
                        "timings": combined["timings"], "overall": combined})
    return methods


def review_template(manifest: dict, passages: list[dict], runs: list[dict] | None = None) -> dict:
    validate_manifest(manifest, passages)
    if runs is not None:
        validate_runs(manifest, runs)
    return {"schema_version": 1, "manifest_fingerprint": fingerprint(manifest),
            "corpus_fingerprint": fingerprint(passages),
            "reviewer": {"name": "", "role": None, "attestation": None}, "reviewed_at": None,
            "question_reviews": [{"question_id": q["id"], "question_fingerprint": fingerprint(q),
                                  "decision": None, "correction": None, "notes": ""} for q in manifest["questions"]],
            "answer_reviews": [{"question_id": r["question_id"], "variant": r["variant"], "run_fingerprint": fingerprint(r),
                                "judgments": {"factual_correctness": None, "evidence_support": None, "citation_correctness": None}, "notes": ""} for r in (runs or [])]}


def validate_review(review: dict, manifest: dict, passages: list[dict], runs: list[dict]) -> None:
    validate_manifest(manifest, passages)
    validate_runs(manifest, runs, complete=bool(runs))
    require(review.get("schema_version") == 1, "Invalid human-review schema.")
    require(review.get("manifest_fingerprint") == fingerprint(manifest) and review.get("corpus_fingerprint") == fingerprint(passages), "Review is stale: question/corpus fingerprint changed.")
    reviewer = review.get("reviewer", {})
    require(isinstance(reviewer.get("name"), str) and bool(reviewer["name"].strip()), "Human reviewer name is required.")
    question_only = reviewer.get("attestation_basis") == "user_reply_to_explicit_question_review_request"
    if question_only:
        require(reviewer.get("role") == "human" and isinstance(reviewer.get("attestation"), str)
                and bool(reviewer["attestation"].strip()) and isinstance(reviewer.get("attestation_context"), str)
                and bool(reviewer["attestation_context"].strip()) and reviewer.get("independent") is False,
                "User-reported question review requires the verbatim reply, its explicit request context and a non-independent label.")
    else:
        require(reviewer.get("role") == "human" and reviewer.get("attestation") == REVIEW_ATTESTATION, "Explicit human role and personal-review attestation are required.")
    try:
        date = datetime.fromisoformat(review["reviewed_at"].replace("Z", "+00:00"))
    except (KeyError, ValueError, TypeError, AttributeError):
        raise ValueError("Review date must be an ISO timestamp with timezone.") from None
    if review.get("date_precision") == "day":
        require(isinstance(review.get("reviewed_at"), str) and len(review["reviewed_at"]) == 10,
                "Day-precision review dates must use YYYY-MM-DD.")
    else:
        require(date.tzinfo is not None, "Review timestamp needs a timezone.")
    questions = {q["id"]: q for q in manifest["questions"]}
    seen = set()
    require(isinstance(review.get("question_reviews"), list), "Question review records are missing.")
    for item in review["question_reviews"]:
        qid = item.get("question_id")
        require(qid in questions and qid not in seen, "Unknown or repeated reviewed question.")
        seen.add(qid)
        require(item.get("question_fingerprint") == fingerprint(questions[qid]), "Reviewed question changed.")
        require(item.get("decision") in {None, "correct", "corrected", "reject"}, "Unknown question review decision.")
        require(isinstance(item.get("notes"), str), "Review notes must be text.")
        if item["decision"] == "corrected":
            correction = item.get("correction")
            require(isinstance(correction, dict) and type(correction.get("answerable")) is bool, "Corrected labels are required.")
            relevant = correction.get("relevant_passage_ids")
            require(isinstance(relevant, list) and all(isinstance(pid, str) for pid in relevant)
                    and set(relevant).issubset({p["id"] for p in passages}) and len(set(relevant)) == len(relevant), "Invalid corrected relevant sources.")
            require(bool(relevant) == correction["answerable"] and isinstance(correction.get("expected_facts"), list) and bool(correction["expected_facts"])
                    and all(isinstance(f, str) and bool(f.strip()) for f in correction["expected_facts"]), "Corrected answerability/rubric is inconsistent.")
        else:
            require(item.get("correction") is None, "Correction supplied without a corrected decision.")
    indexed = {(r["question_id"], r["variant"]): r for r in runs}
    seen_runs = set()
    require(isinstance(review.get("answer_reviews"), list), "Answer review records are missing.")
    for item in review["answer_reviews"]:
        key = (item.get("question_id"), item.get("variant"))
        require(key in indexed and key not in seen_runs, "Unknown or repeated reviewed answer.")
        seen_runs.add(key)
        require(item.get("run_fingerprint") == fingerprint(indexed[key]), "Reviewed answer/context/timing changed; re-review this run.")
        allowed = {"factual_correctness": {None, "correct", "incorrect", "uncertain"},
                   "evidence_support": {None, "supported", "unsupported", "uncertain", "not_applicable"},
                   "citation_correctness": {None, "correct", "incorrect", "uncertain", "not_applicable"}}
        judgments = item.get("judgments", {})
        require(set(judgments) == set(allowed) and all(judgments[k] in values for k, values in allowed.items()), "Invalid manual answer judgment.")
        if question_only:
            require(all(value is None for value in judgments.values()), "A question-only user reply cannot approve generated answers.")
        require(isinstance(item.get("notes"), str), "Answer review notes must be text.")


def human_review_summary(review: dict | None, manifest: dict, passages: list[dict], runs: list[dict]) -> dict:
    result = {"status": PENDING, "questions_reviewed": 0, "questions_required": len(manifest["questions"]),
              "questions_accepted": 0, "question_status": PENDING,
              "answers_reviewed": 0, "answers_required": len(runs), "answer_status": PENDING, "metrics": None}
    if review is None:
        return result
    validate_review(review, manifest, passages, runs)
    result["questions_reviewed"] = sum(x["decision"] is not None for x in review["question_reviews"])
    result["questions_accepted"] = sum(x["decision"] == "correct" for x in review["question_reviews"])
    result["answers_reviewed"] = sum(all(v is not None for v in x["judgments"].values()) for x in review["answer_reviews"])
    result["reviewer"] = review["reviewer"]["name"]
    result["reviewed_at"] = review["reviewed_at"]
    if "date_precision" in review:
        result["date_precision"] = review["date_precision"]
    if review["reviewer"].get("attestation_basis") == "user_reply_to_explicit_question_review_request":
        result.update(verification_basis="User-reported question review in the project conversation; no independent verification of reading or reviewer identity.",
                      attestation=review["reviewer"]["attestation"], independent=False)
    if any(x["decision"] in {"corrected", "reject"} for x in review["question_reviews"]):
        result["question_status"] = "corrections_required"
    elif result["questions_accepted"] == len(manifest["questions"]):
        result["question_status"] = "human_questions_reviewed"
    if runs and result["answers_reviewed"] == len(runs):
        result["answer_status"] = "human_answers_reviewed"
    complete = (result["question_status"] == "human_questions_reviewed"
                and result["answer_status"] == "human_answers_reviewed")
    if not complete:
        result["reason"] = "All questions and answers need completed review. Corrected/rejected seed cases require a revised manifest, rerun and fresh review before aggregate human metrics."
        return result
    metrics = {}
    for key, positive, negative in [("factual_correctness", "correct", "incorrect"), ("evidence_support", "supported", "unsupported"), ("citation_correctness", "correct", "incorrect")]:
        values = [item["judgments"][key] for item in review["answer_reviews"]]
        denominator = sum(v in {positive, negative} for v in values)
        metrics[key] = {"pass_rate": sum(v == positive for v in values) / denominator if denominator else None,
                        "decisive_judgments": denominator, "uncertain_or_not_applicable": len(values) - denominator}
    result.update(status="human_review_complete", metrics=metrics)
    return result


def build_study(manifest: dict, runs: list[dict], *, passages: list[dict], model: dict,
                run_metadata: dict | None = None, review: dict | None = None) -> dict:
    validate_manifest(manifest, passages)
    validate_runs(manifest, runs)
    validate_contexts(runs, passages)
    human = human_review_summary(review, manifest, passages, runs)
    return {"schema_version": 1, "title": "Grounded LLM generation: evidence, refusals and failure cases",
            "scope": "Exploratory real-model experiment on AI-authored seed questions. Structural checks do not establish factual support.",
            "model": model, "run_metadata": run_metadata or {},
            "corpus": {"fingerprint": fingerprint(passages), "chunks": len(passages)},
            "benchmark": {"annotation_status": human["question_status"], "seed_annotation_status": PENDING,
                          "question_fingerprint": fingerprint(manifest),
                          "dev_questions": sum(q["split"] == "dev" for q in manifest["questions"]),
                          "test_questions": sum(q["split"] == "test" for q in manifest["questions"]),
                          "human_review": human, "creation_protocol": manifest["creation_protocol"]},
            "methods": summarize_runs(manifest, runs, question_status=human["question_status"]),
            "cases": [{**q, "runs": [r for r in runs if r["question_id"] == q["id"]]} for q in manifest["questions"]],
            "passages": passages,
            "limitations": [("Questions and expected facts are AI-authored seed judgments, pending independent human review."
                             if human["question_status"] != "human_questions_reviewed" else
                             "AI-authored question labels have a recorded human review; this does not itself verify generated answers or reviewer independence."),
                            "Citation ID validity and sentence coverage are structural checks, not entailment or faithfulness scores.",
                            "The validated variant reuses the exact grounded model output; it is not a third independent generation.",
                            "Refusing every question can improve unsupported-question refusal while eliminating useful answers; inspect answerable coverage too.",
                            "This small, source-specific exploratory suite does not establish general model quality or business impact.",
                            "Latency records the hosted AI binding call and client request separately; one run per question is not a load or reliability benchmark."]}


def validate_study(study: dict, manifest: dict | None = None, review: dict | None = None) -> None:
    require(study.get("schema_version") == 1, "Unknown generation study schema.")
    passages = study["passages"]
    require(study["corpus"] == {"fingerprint": fingerprint(passages), "chunks": len(passages)}, "Generation study corpus changed.")
    cases = study["cases"]
    if manifest is not None:
        validate_manifest(manifest, passages)
        require(study["benchmark"]["question_fingerprint"] == fingerprint(manifest), "Generation question fingerprint mismatch.")
        require([{k: v for k, v in q.items() if k != "runs"} for q in cases] == manifest["questions"], "Recorded generation questions differ from manifest.")
    else:
        manifest = {"questions": [{k: v for k, v in q.items() if k != "runs"} for q in cases]}
    runs = [r for q in cases for r in q["runs"]]
    validate_runs(manifest, runs)
    validate_contexts(runs, passages)
    human = study["benchmark"]["human_review"]
    if review is not None:
        require("schema_version" in manifest and human == human_review_summary(review, manifest, passages, runs), "Human summary differs from its fingerprint-bound review record.")
    else:
        require(human == human_review_summary(None, manifest, passages, runs),
                "Human review claims require their independently validated review artifact.")
    require(study["benchmark"].get("annotation_status") == human["question_status"]
            and study["benchmark"].get("seed_annotation_status") == PENDING,
            "Benchmark annotation status differs from its recorded question review.")
    require(study["methods"] == summarize_runs(manifest, runs, question_status=human["question_status"]),
            "Generation summary disagrees with recorded model outputs/checks/timings/review status.")
    require(study["benchmark"]["dev_questions"] == sum(q["split"] == "dev" for q in cases)
            and study["benchmark"]["test_questions"] == sum(q["split"] == "test" for q in cases), "Generation split counts disagree.")
