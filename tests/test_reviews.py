from pathlib import Path
from zipfile import ZipFile

import pandas as pd
import pytest

from datapilot.reviews import build_review_analysis, redact_review


def fixture(path: Path):
    rows = []
    texts = {1: "não recebi o produto atrasou muito", 3: "produto razoavel entrega regular", 5: "produto excelente entrega rapida"}
    for i in range(150):
        rating = [1, 3, 5][i % 3]
        rows.append({"order_id": f"order-{i}", "review_score": rating,
                     "review_comment_message": texts[rating],
                     "review_answer_timestamp": (pd.Timestamp("2017-01-01") + pd.Timedelta(days=i)).isoformat()})
    # A later conflicting review for the same order must not multiply rows.
    rows.append({**rows[0], "review_score": 5, "review_answer_timestamp": "2018-01-01"})
    rows.append({"order_id": "no-text", "review_score": 1, "review_comment_message": None,
                 "review_answer_timestamp": "2017-02-01"})
    with ZipFile(path, "w") as archive:
        archive.writestr("olist_order_reviews_dataset.csv", pd.DataFrame(rows).to_csv(index=False))


def test_chronological_rating_evaluation_and_earliest_review_dedup(tmp_path):
    path = tmp_path / "reviews.zip"
    fixture(path)
    result = build_review_analysis(path)
    analysis = result["analysis"]
    assert analysis["labeled_rows"] == 150
    assert analysis["source"]["filtering"]["duplicate_order_reviews_removed"] == 1
    assert analysis["source"]["filtering"]["empty_or_nontext_rows"] == 1
    assert analysis["split"]["train_end"] < analysis["split"]["test_start"]
    assert len(analysis["models"]) == 2
    assert analysis["models"][1]["metrics"]["macro_f1"] > 0.9
    assert sum(map(sum, analysis["confusion_matrix"])) == analysis["test_rows"]
    assert set(analysis["labels"]) == {"negative", "neutral", "positive"}


def test_public_chunks_have_source_and_no_original_order_id(tmp_path):
    path = tmp_path / "reviews.zip"
    fixture(path)
    result = build_review_analysis(path)
    assert result["review_chunks"]
    assert len(result["review_chunks"]) <= 150
    for chunk in result["review_chunks"]:
        assert chunk["language"] == "Portuguese"
        assert chunk["source_url"].startswith("https://www.kaggle.com/")
        assert "order_id" not in chunk
        assert len(chunk["text"]) <= 240


def test_theme_counts_are_negative_only_and_can_overlap(tmp_path):
    path = tmp_path / "reviews.zip"
    fixture(path)
    analysis = build_review_analysis(path)["analysis"]
    themes = {theme["theme"]: theme["count"] for theme in analysis["complaint_themes"]}
    assert themes["Delivery delays"] == 50
    assert themes["Item not received"] == 50
    assert analysis["complaint_scope_rows"] == 50


def test_redaction_removes_contacts_urls_and_identifiers():
    text = redact_review("Contato teste@example.com https://example.com ou +55 (11) 99999-8888, id aabbccddeeff00112233445566778899")
    assert "teste@example.com" not in text
    assert "https://example.com" not in text
    assert "99999" not in text
    assert "aabbcc" not in text


def test_invalid_or_insufficient_archive_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="downloaded"):
        build_review_analysis(tmp_path / "absent.zip")
    path = tmp_path / "tiny.zip"
    with ZipFile(path, "w") as archive:
        archive.writestr("olist_order_reviews_dataset.csv", "order_id,review_score,review_comment_message,review_answer_timestamp\na,5,ok,2017-01-01\n")
    with pytest.raises(ValueError, match="at least 60"):
        build_review_analysis(path)
