"""Release checks catch report corruption independently of model fitting."""
import copy
import json
from pathlib import Path

import pytest

from datapilot.research_validation import validate_research_directory, validate_review_study, validate_retrieval_study

ROOT = Path(__file__).resolve().parents[1]


def read(name):
    return json.loads((ROOT / "frontend" / name).read_text())


def test_saved_research_scores_and_data_fingerprints_are_consistent():
    summary = validate_research_directory(ROOT)
    assert summary["review_test_rows"] > summary["novel_wording_rows"] > 0
    assert summary["retrieval_passages"] > 0


def test_review_confusion_corruption_and_wrong_selection_are_rejected():
    review = read("review-study.json")
    altered = copy.deepcopy(review)
    altered["evaluations"]["test"]["confusion_matrix"][0][0] += 1
    with pytest.raises(ValueError, match="row count"):
        validate_review_study(altered)
    altered = copy.deepcopy(review)
    altered["selected_model"]["id"] = "majority"
    with pytest.raises(ValueError, match="validation"):
        validate_review_study(altered)


def test_retrieval_rejects_incompatible_vectors_and_decorative_scores():
    retrieval = read("retrieval-study.json")
    altered = copy.deepcopy(retrieval)
    altered["passage_embeddings"][0][0] = float("nan")
    with pytest.raises(ValueError, match="embedding"):
        validate_retrieval_study(altered)
    altered = copy.deepcopy(retrieval)
    altered["cases"][0]["results"]["lexical"]["metrics"]["mrr_at_3"] = 0.125
    with pytest.raises(ValueError, match="judged ranks"):
        validate_retrieval_study(altered)
