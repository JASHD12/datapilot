import copy
import json
from pathlib import Path

import pytest

from datapilot.generation_study import (
    PENDING, REVIEW_ATTESTATION, VARIANTS, build_study, fingerprint,
    human_review_summary, review_template, summarize_runs, validate_manifest,
    validate_contexts, validate_review, validate_runs, validate_study,
)


@pytest.fixture
def seed():
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "data/evaluation/generation_questions.json").read_text())
    passages = json.loads((root / "frontend/retrieval-study.json").read_text())["passages"]
    return manifest, passages


def runs_for(manifest, passages):
    runs = []
    sources = {p["id"]: p for p in passages}
    for question in manifest["questions"]:
        for variant in VARIANTS:
            grounded = variant != "plain"
            abstained = grounded and not question["answerable"]
            raw = "INSUFFICIENT_EVIDENCE" if abstained else "A bounded source-supported statement [S1]." if grounded else "An ungrounded statement."
            run = {"question_id": question["id"], "variant": variant, "raw_answer": raw, "answer": raw,
                   "status": "abstained" if abstained else "generated", "context_ids": question["relevant_passage_ids"] if grounded else [],
                   "checks": {"accepted": grounded and not abstained, "abstained": abstained,
                              "citations": [] if abstained or not grounded else ["S1"], "invalid_citations": [],
                              "uncited_sentences": [] if grounded else ["An ungrounded statement."], "reasons": []},
                   "timings": {"generation_ms": 10, "total_ms": 12}}
            run["contexts"] = [{"id": pid, "citation": f"S{i + 1}",
                                "text": sources[pid]["text"].strip()[:1000],
                                "title": sources[pid]["title"], "source": sources[pid]["source"],
                                "section": sources[pid].get("section", ""),
                                "source_url": sources[pid].get("source_url", "")}
                               for i, pid in enumerate(run["context_ids"])]
            if variant == "grounded_validated":
                run["reuse_of"] = "grounded"
            runs.append(run)
    return runs


def identified_template(manifest, passages, runs):
    review = review_template(manifest, passages, runs)
    review["reviewer"] = {"name": "Test human reviewer", "role": "human", "attestation": REVIEW_ATTESTATION}
    review["reviewed_at"] = "2026-11-11T20:00:00+01:00"
    return review


def test_seed_provenance_rejects_unknown_sources_and_split_leakage(seed):
    manifest, passages = seed
    validate_manifest(manifest, passages)
    assert len(manifest["questions"]) == 12
    assert manifest["annotation_status"] == PENDING
    assert all(q["review"] is None for q in manifest["questions"])
    invalid = copy.deepcopy(manifest)
    invalid["questions"][0]["relevant_passage_ids"] = ["invented-source"]
    with pytest.raises(ValueError, match="passage"):
        validate_manifest(invalid, passages)
    invalid = copy.deepcopy(manifest)
    invalid["questions"][-1]["category"] = invalid["questions"][0]["category"]
    with pytest.raises(ValueError, match="disjoint"):
        validate_manifest(invalid, passages)
    changed = copy.deepcopy(passages)
    changed[0]["text"] += " changed"
    with pytest.raises(ValueError, match="fingerprint"):
        validate_manifest(manifest, changed)


def test_summaries_distinguish_raw_generation_failures_from_served_refusals(seed):
    manifest, passages = seed
    runs = runs_for(manifest, passages)
    target = manifest["questions"][-1]["id"]
    grounded = next(r for r in runs if r["question_id"] == target and r["variant"] == "grounded")
    grounded.update(raw_answer="Here is an invented contact address [S99].", answer="Here is an invented contact address [S99].", status="generated")
    grounded["checks"].update(accepted=False, abstained=False, citations=["S99"], invalid_citations=["S99"])
    validated = next(r for r in runs if r["question_id"] == target and r["variant"] == "grounded_validated")
    validated.update(raw_answer=grounded["raw_answer"], answer="INSUFFICIENT_EVIDENCE", status="blocked", checks=copy.deepcopy(grounded["checks"]))
    methods = {row["id"]: row for row in summarize_runs(manifest, runs)}
    assert methods["grounded"]["splits"]["test"]["unanswerable_abstain_rate"] == pytest.approx(2 / 3)
    assert methods["grounded_validated"]["splits"]["test"]["unanswerable_abstain_rate"] == 1
    assert methods["grounded_validated"]["splits"]["test"]["invalid_citation_rate"] == pytest.approx(1 / 8)
    assert methods["grounded_validated"]["splits"]["test"]["raw_abstention_rate"] == pytest.approx(2 / 8)
    assert methods["grounded_validated"]["timings"]["generation_ms"]["median"] == 10
    assert "faithfulness" not in methods["grounded_validated"]["overall"]


def test_reused_generation_and_finite_timings_are_enforced(seed):
    manifest, passages = seed
    runs = runs_for(manifest, passages)
    validate_runs(manifest, runs)
    changed = copy.deepcopy(runs)
    changed[2]["raw_answer"] += " modified"
    with pytest.raises(ValueError, match="reuse"):
        validate_runs(manifest, changed)
    changed = copy.deepcopy(runs)
    changed[0]["timings"]["generation_ms"] = float("nan")
    with pytest.raises(ValueError, match="timing"):
        validate_runs(manifest, changed)
    with pytest.raises(ValueError, match="Incomplete"):
        validate_runs(manifest, runs[:-1])


def test_blank_template_is_not_a_human_review_and_partial_question_review_has_no_answer_score(seed):
    manifest, passages = seed
    runs = runs_for(manifest, passages)
    blank = review_template(manifest, passages, runs)
    assert blank["reviewer"]["role"] is None
    assert all(q["decision"] is None for q in blank["question_reviews"])
    with pytest.raises(ValueError, match="name"):
        validate_review(blank, manifest, passages, runs)
    review = identified_template(manifest, passages, runs)
    for item in review["question_reviews"]:
        item["decision"] = "correct"
    summary = human_review_summary(review, manifest, passages, runs)
    assert summary["question_status"] == "human_questions_reviewed"
    assert summary["questions_reviewed"] == 12
    assert summary["answer_status"] == PENDING and summary["answers_reviewed"] == 0
    assert summary["metrics"] is None
    review["reviewer"]["role"] = "ai_agent"
    with pytest.raises(ValueError, match="human role"):
        validate_review(review, manifest, passages, runs)


def test_changed_question_or_generated_output_invalidates_review(seed):
    manifest, passages = seed
    runs = runs_for(manifest, passages)
    review = identified_template(manifest, passages, runs)
    changed = copy.deepcopy(manifest)
    changed["questions"][0]["question"] += " Revised."
    with pytest.raises(ValueError, match="stale"):
        validate_review(review, changed, passages, runs)
    changed_runs = copy.deepcopy(runs)
    changed_runs[0]["answer"] += " Changed."
    with pytest.raises(ValueError, match="changed"):
        validate_review(review, manifest, passages, changed_runs)


def test_question_only_user_reply_never_authorizes_answer_judgments(seed):
    manifest, passages = seed
    runs = runs_for(manifest, passages)
    review = identified_template(manifest, passages, runs)
    review["reviewer"] = {"name": "Project owner (user-reported review)", "role": "human",
                          "attestation": "checked", "attestation_basis": "user_reply_to_explicit_question_review_request",
                          "attestation_context": "Asked to personally check all twelve proposed labels and source excerpts.",
                          "independent": False}
    review.update(reviewed_at="2026-11-11", date_precision="day")
    for item in review["question_reviews"]:
        item["decision"] = "correct"
    summary = human_review_summary(review, manifest, passages, runs)
    assert summary["question_status"] == "human_questions_reviewed"
    assert summary["attestation"] == "checked" and summary["independent"] is False
    assert summary["answer_status"] == PENDING and summary["metrics"] is None
    review["answer_reviews"][0]["judgments"]["factual_correctness"] = "correct"
    with pytest.raises(ValueError, match="question-only"):
        validate_review(review, manifest, passages, runs)


def test_complete_manual_judgments_have_explicit_denominators_and_corrections_block_aggregation(seed):
    manifest, passages = seed
    runs = runs_for(manifest, passages)
    review = identified_template(manifest, passages, runs)
    for item in review["question_reviews"]:
        item["decision"] = "correct"
    for item in review["answer_reviews"]:
        item["judgments"] = {"factual_correctness": "correct", "evidence_support": "supported", "citation_correctness": "correct"}
    review["answer_reviews"][0]["judgments"]["evidence_support"] = "not_applicable"
    summary = human_review_summary(review, manifest, passages, runs)
    assert summary["status"] == "human_review_complete"
    assert summary["metrics"]["evidence_support"]["decisive_judgments"] == 35
    assert summary["metrics"]["evidence_support"]["uncertain_or_not_applicable"] == 1
    item = review["question_reviews"][0]
    item.update(decision="corrected", correction={"answerable": True, "relevant_passage_ids": manifest["questions"][0]["relevant_passage_ids"], "expected_facts": ["A corrected manual rubric."]})
    summary = human_review_summary(review, manifest, passages, runs)
    assert summary["question_status"] == "corrections_required" and summary["metrics"] is None


def test_study_integrity_recomputes_summaries_and_requires_review_provenance(seed):
    manifest, passages = seed
    runs = runs_for(manifest, passages)
    study = build_study(manifest, runs, passages=passages, model={"id": "test-fixture-not-a-real-model"})
    validate_study(study, manifest)
    assert study["benchmark"]["human_review"]["metrics"] is None
    changed = copy.deepcopy(study)
    changed["methods"][0]["timings"]["generation_ms"]["median"] = 999
    with pytest.raises(ValueError, match="summary"):
        validate_study(changed, manifest)
    changed = copy.deepcopy(study)
    changed["benchmark"]["human_review"]["questions_reviewed"] = 12
    with pytest.raises(ValueError, match="Human review claims"):
        validate_study(changed, manifest)
    assert fingerprint({"a": 1, "b": "Não"}) == fingerprint({"b": "Não", "a": 1})


@pytest.mark.parametrize("field,replacement", [
    ("text", "Invented policy that never appeared in the source."),
    ("citation", "S9"),
    ("source_url", "https://example.invalid/fake-source"),
])
def test_source_content_and_citation_metadata_cannot_change_under_a_valid_id(seed, field, replacement):
    manifest, passages = seed
    runs = runs_for(manifest, passages)
    study = build_study(manifest, runs, passages=passages, model={"id": "fixture"})
    validate_study(study, manifest)
    # Mutate both copies so the reuse check alone cannot catch this corruption.
    for run in study["cases"][0]["runs"]:
        if run["variant"] != "plain":
            run["contexts"][0][field] = replacement
    with pytest.raises(ValueError, match="context"):
        validate_study(study, manifest)
    corrupted = [r for case in study["cases"] for r in case["runs"]]
    with pytest.raises(ValueError, match="context"):
        build_study(manifest, corrupted, passages=passages, model={"id": "fixture"})


def test_context_binding_matches_javascript_unicode_bounds_and_rejects_reordering():
    passage = {"id": "unicode", "text": "\ufeff\u00a0" + "a" * 999 + "😀tail\ufeff", "source": "notes.md"}
    # JS slice counts UTF-16 code units, so the emoji straddles this boundary.
    context = {"id": "unicode", "citation": "S1", "text": "a" * 999 + "\ud83d",
               "title": "notes.md", "source": "notes.md", "section": "", "source_url": ""}
    run = {"context_ids": ["unicode"], "contexts": [context]}
    validate_contexts([run], [passage])
    altered = copy.deepcopy(run)
    altered["contexts"][0]["text"] = "a" * 999 + "😀"
    with pytest.raises(ValueError, match="normalized corpus"):
        validate_contexts([altered], [passage])
    altered = copy.deepcopy(run)
    altered["context_ids"] = ["different-id"]
    with pytest.raises(ValueError, match="IDs/order"):
        validate_contexts([altered], [passage])
    with pytest.raises(ValueError, match="required"):
        validate_contexts([{"context_ids": []}], [passage])


def test_infrastructure_failures_are_not_model_refusals_or_quality_measurements(seed):
    manifest, passages = seed
    runs = runs_for(manifest, passages)
    unsupported_test = {q["id"] for q in manifest["questions"] if q["split"] == "test" and not q["answerable"]}
    for run in runs:
        if run["question_id"] in unsupported_test:
            # Even an error UI's refusal marker must not earn a model-quality pass.
            run.update(status="quota_exceeded", raw_answer="", answer="INSUFFICIENT_EVIDENCE",
                       timings={"generation_ms": 0, "total_ms": 1})
    methods = summarize_runs(manifest, runs)
    for method in methods:
        result = method["splits"]["test"]
        assert result["count"] == 8 and result["evaluated_count"] == 5
        assert result["error_count"] == 3 and result["error_rate"] == pytest.approx(3 / 8)
        assert result["metric_denominators"]["unanswerable_responses"] == 0
        assert result["unanswerable_abstain_rate"] is None
        assert result["served_refusal_rate"] == 0
        assert result["timings"]["generation_ms"]["min"] == 10
    for run in runs:
        run.update(status="error", raw_answer="", answer="", timings={"generation_ms": 0, "total_ms": 1})
    for method in summarize_runs(manifest, runs):
        result = method["overall"]
        assert result["error_rate"] == 1 and result["evaluated_count"] == 0
        assert result["served_refusal_rate"] is None and result["answerable_answer_rate"] is None
        assert result["timings"] == {"generation_ms": None, "total_ms": None}


def test_question_review_updates_label_basis_without_approving_model_answers(seed):
    manifest, passages = seed
    runs = runs_for(manifest, passages)
    root = Path(__file__).resolve().parents[1]
    review = json.loads((root / "data/evaluation/generation_question_review.json").read_text())
    study = build_study(manifest, runs, passages=passages, model={"id": "fixture"}, review=review)
    validate_study(study, manifest, review)
    assert study["benchmark"]["annotation_status"] == "human_questions_reviewed"
    assert study["benchmark"]["human_review"]["answer_status"] == PENDING
    assert study["benchmark"]["human_review"]["metrics"] is None
    for method in study["methods"]:
        for metrics in [method["overall"], *method["splits"].values()]:
            assert "recorded human review" in metrics["label_basis"]
            assert "does not establish generated answer correctness" in metrics["label_basis"]
    changed = copy.deepcopy(study)
    changed["benchmark"]["annotation_status"] = "human_review_complete"
    with pytest.raises(ValueError, match="annotation status"):
        validate_study(changed, manifest, review)
    changed = copy.deepcopy(study)
    changed["methods"][0]["overall"]["label_basis"] = "Provisional AI-authored labels."
    with pytest.raises(ValueError, match="summary"):
        validate_study(changed, manifest, review)
