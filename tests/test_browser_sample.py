import copy
import importlib.util
from pathlib import Path

import pandas as pd
import pytest

from datapilot.data import demo_frame

spec = importlib.util.spec_from_file_location("browser_sample_builder", Path(__file__).resolve().parents[1] / "scripts" / "build_browser_sample.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def fixture():
    frame = demo_frame(rows=600)
    frame.attrs["metadata"] = {"archive_sha256": "a" * 64}
    return frame


def test_sample_preserves_temporal_and_training_label_boundaries():
    frame = fixture()
    # Deliberately unordered input must still produce time-ordered sampling.
    frame = frame.sample(frac=1, random_state=7).reset_index(drop=True)
    result = builder.build_browser_sample(frame, train_limit=120, test_limit=35)
    for data in result["tasks"].values():
        assert len(data["train"]["y"]) == 120
        assert len(data["test"]["y"]) == 35
        split = data["split"]
        cutoff = pd.Timestamp(split["cutoff"])
        assert pd.Timestamp(split["sample_train_end"]) < cutoff
        assert pd.Timestamp(split["sample_test_start"]) >= cutoff
        assert pd.Timestamp(split["latest_sample_training_label_available"]) < cutoff
        assert data["features"] == builder.FEATURES
        assert all(len(row) == 4 for row in data["train"]["x"])


def test_sample_is_deterministic_and_contains_only_numeric_inputs():
    first = builder.build_browser_sample(fixture(), train_limit=100, test_limit=25)
    second = builder.build_browser_sample(fixture(), train_limit=100, test_limit=25)
    assert first == second
    assert first["source"]["archive_sha256"] == "a" * 64
    assert first["source"]["license"] == "CC BY-NC-SA 4.0"
    for data in first["tasks"].values():
        assert not {"order_id", "seller_id", "review_rating", "outcome_available_date"}.intersection(data["features"])
        assert all(value is None or isinstance(value, (int, float)) for row in data["train"]["x"] for value in row)
    assert set(first["tasks"]["classification"]["train"]["y"]) == {0, 1}


def test_modified_sample_or_target_is_rejected():
    result = builder.build_browser_sample(fixture(), train_limit=100, test_limit=25)
    changed = copy.deepcopy(result)
    changed["tasks"]["regression"]["train"]["y"][0] += 10
    with pytest.raises(ValueError, match="checksum"):
        builder.validate_browser_sample(changed)
    changed = copy.deepcopy(result)
    changed["tasks"]["classification"]["test"]["y"][0] = 5
    with pytest.raises(ValueError, match="binary"):
        builder.validate_browser_sample(changed)


def test_limits_and_label_availability_are_required():
    with pytest.raises(ValueError, match="train_limit"):
        builder.build_browser_sample(fixture(), train_limit=2001)
    with pytest.raises(ValueError, match="availability"):
        builder.build_browser_sample(fixture().drop(columns="outcome_available_date"))
