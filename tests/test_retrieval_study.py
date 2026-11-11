import copy
import json
import math
from pathlib import Path

import numpy as np
import pytest

from datapilot.retrieval_study import (
    LexicalIndex, corpus_from_snapshot, fingerprint, hybrid_scores,
    ranking_metrics, select_threshold, summarize, validate_questions,
)


def test_ranking_metrics_match_hand_calculated_binary_relevance():
    scores = ranking_metrics(["irrelevant", "first", "second"], ["first", "second", "unretrieved"])
    assert scores["recall_at_3"] == pytest.approx(2 / 3)
    assert scores["mrr_at_3"] == pytest.approx(1 / 2)
    assert scores["ndcg_at_3"] == pytest.approx((1 / math.log2(3) + 1 / math.log2(4)) / (1 + 1 / math.log2(3) + 1 / math.log2(4)))
    assert scores["hit_rate_at_3"] == 1
    with pytest.raises(ValueError):
        ranking_metrics(["a"], [])


def test_zero_overlap_lexical_query_is_zero_and_accents_are_normalized():
    index = LexicalIndex(["Não recebi o produto", "Entrega antes do prazo"])
    assert index.score("nao recebi")[0] > 0.7
    assert index.score("xylophone").tolist() == [0, 0]
    assert np.linalg.norm(index.matrix[0]) == pytest.approx(1)


def test_rrf_ignores_zero_lexical_results_instead_of_inventing_rank_signal():
    lexical = np.array([0.0, 0.0, 0.0])
    dense = np.array([0.1, 0.3, 0.2])
    fused = hybrid_scores(lexical, dense)
    assert fused[1] == pytest.approx(1 / 61)
    assert fused[2] == pytest.approx(1 / 62)
    assert fused[0] == pytest.approx(1 / 63)
    with pytest.raises(ValueError):
        hybrid_scores(np.zeros(2), np.zeros(3))


def test_threshold_only_accepts_development_and_prefers_correct_abstention():
    development = [
        {"split": "dev", "answerable": True, "top_score": 0.8},
        {"split": "dev", "answerable": True, "top_score": 0.7},
        {"split": "dev", "answerable": False, "top_score": 0.2},
        {"split": "dev", "answerable": False, "top_score": 0.3},
    ]
    threshold, selection = select_threshold(development)
    assert threshold == pytest.approx(0.5)
    assert selection["value"] == 1
    with pytest.raises(ValueError, match="development"):
        select_threshold(development + [{"split": "test", "answerable": True, "top_score": 1}])
    with pytest.raises(ValueError, match="both"):
        select_threshold(development[:2])


def test_wording_dedup_preserves_one_original_source():
    snapshot = {"knowledge_chunks": [
        {"id": "a", "text": "Não recebi.", "source": "public"},
        {"id": "b", "text": "nao recebi!", "source": "public"},
        {"id": "c", "text": "Recebi", "source": "public"},
    ]}
    result = corpus_from_snapshot(snapshot)
    assert [row["id"] for row in result] == ["a", "c"]
    assert result[0]["text"] == "Não recebi."


def test_answerability_metrics_count_false_positive_retrieval():
    rows = [
        {"answerable": True, "top_score": 0.9, "metrics": {"hit_rate_at_3": 1.0}},
        {"answerable": True, "top_score": 0.1, "metrics": {"hit_rate_at_3": 0.0}},
        {"answerable": False, "top_score": 0.8, "metrics": None},
        {"answerable": False, "top_score": 0.2, "metrics": None},
    ]
    result = summarize(rows, 0.5)
    assert result["abstention"]["coverage"] == 0.5
    assert result["abstention"]["unanswerable_abstain_rate"] == 0.5
    assert result["abstention"]["accepted_retrieval_success_rate"] == 0.5


def test_checked_in_question_manifest_has_disjoint_intents_and_valid_gold():
    root = Path(__file__).resolve().parents[1]
    snapshot = json.loads((root / "frontend/olist-snapshot.json").read_text())
    manifest = json.loads((root / "data/evaluation/retrieval_questions.json").read_text())
    passages = corpus_from_snapshot(snapshot)
    questions = manifest["questions"]
    validate_questions(questions, passages)
    assert len(questions) == 40
    assert "not independently human-validated" in manifest["annotation_status"]
    invalid = copy.deepcopy(questions)
    invalid[-1]["intent"] = invalid[0]["intent"]
    with pytest.raises(ValueError, match="disjoint"):
        validate_questions(invalid, passages)
    invalid = copy.deepcopy(questions)
    invalid[0]["relevant_ids"] = ["missing-source"]
    with pytest.raises(ValueError, match="reference"):
        validate_questions(invalid, passages)


def test_canonical_fingerprint_ignores_dictionary_insertion_order():
    assert fingerprint({"a": 1, "b": "Não"}) == fingerprint({"b": "Não", "a": 1})
