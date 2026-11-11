import json

import numpy as np
import pandas as pd
import pytest

from datapilot.review_study import (
    LABELS, chronological_split, cluster_bootstrap, fit_candidates, normalize_review_text,
    run_review_study,
)


def frame(rows=150):
    wording = {"negative": "não recebi produto atrasado", "neutral": "produto razoável entrega regular", "positive": "produto excelente entrega rápida"}
    return pd.DataFrame([{
        "available_at": pd.Timestamp("2017-01-01") + pd.Timedelta(days=index),
        "text": wording[LABELS[index % 3]] + f" exemplo grupo{index % 5}",
        "label": LABELS[index % 3], "order_id": f"private-order-{index}",
    } for index in range(rows)])


def test_equal_timestamp_groups_never_cross_partitions():
    source = frame()
    source.loc[88:94, "available_at"] = source.loc[90, "available_at"]
    source.loc[118:124, "available_at"] = source.loc[120, "available_at"]
    train, validation, test = chronological_split(source.sample(frac=1, random_state=7))
    assert train.available_at.max() < validation.available_at.min()
    assert validation.available_at.max() < test.available_at.min()
    assert len(train) + len(validation) + len(test) == len(source)


def test_vocabulary_cannot_learn_validation_or_test_only_terms():
    source = frame()
    source.loc[90:, "text"] += " futureexclusive"
    train, _, _ = chronological_split(source)
    models = fit_candidates(train)
    vocabulary = models["word_tfidf"].named_steps["tfidf"].vocabulary_
    assert "futureexclusive" not in vocabulary
    assert "produto" in vocabulary


def test_selection_is_invariant_to_final_period_labels():
    source = frame()
    # Ensure a nonempty novel-wording diagnostic without leaking its words into fitting.
    source.loc[120:, "text"] += " inédita testemunho particular"
    before = run_review_study(source, {"archive_sha256": "fixture"}, bootstrap_replicates=10)
    altered = source.copy()
    altered.loc[120:, "label"] = "negative"
    after = run_review_study(altered, {"archive_sha256": "fixture"}, bootstrap_replicates=10)
    assert before["selected_model"] == after["selected_model"]
    assert before["candidates"] == after["candidates"]
    assert before["evaluations"]["test"]["metrics"] != after["evaluations"]["test"]["metrics"]
    assert before["protocol"]["retrospective"] is True


def test_normalized_overlap_exclusion_and_no_private_payload():
    source = frame()
    source.loc[120:, "text"] = "  PRODUTO excelente!!! entrega rápida  "
    source.loc[0:5, "text"] = "produto excelente entrega rapida"
    study = run_review_study(source, {"archive_sha256": "fixture"}, bootstrap_replicates=10)
    assert study["duplicates"]["test_seen_before_rows"] == 30
    assert study["evaluations"]["novel_text_test"]["rows"] == 0
    assert study["evaluations"]["novel_text_test"]["metrics"] is None
    payload = json.dumps(study)
    assert "private-order" not in payload
    assert "PRODUTO excelente" not in payload
    assert "produto excelente entrega rapida" not in payload
    assert normalize_review_text("  NÃO, recebi!!!\n ") == "nao recebi"


def test_cluster_bootstrap_matches_perfect_prediction_oracle_and_is_reproducible():
    actual = np.array(LABELS * 10)
    baseline = np.full(len(actual), "positive")
    groups = np.array([f"group-{index}" for index in range(len(actual))])
    first, difference = cluster_bootstrap(actual, actual, baseline, groups, replicates=20)
    second, _ = cluster_bootstrap(actual, actual, baseline, groups, replicates=20)
    assert first == second
    assert first["lower"] == pytest.approx(1.0)
    assert first["upper"] == pytest.approx(1.0)
    assert difference["lower"] > 0.7
    assert first["groups"] == len(groups)


def test_confusion_and_per_class_support_account_for_every_test_row():
    source = frame()
    source.loc[120:, "text"] += " nova expressão"
    study = run_review_study(source, {"archive_sha256": "fixture"}, bootstrap_replicates=10)
    for result in study["evaluations"].values():
        assert sum(map(sum, result["confusion_matrix"])) == result["rows"]
        assert sum(item["support"] for item in result["per_class"]) == result["rows"]
        assert result["bootstrap_macro_f1"]["groups"] <= result["rows"]
    with pytest.raises(ValueError, match="at least 60"):
        chronological_split(source.head(10))
