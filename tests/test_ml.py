"""Behavior checks for leakage boundaries, honest temporal evaluation and ingestion."""

import json

import numpy as np
import pandas as pd
import pytest

from datapilot.data import demo_frame, load_csv_bytes, profile_frame
from datapilot.ml import (_lag_features, _preprocessor, run_classification,
                          run_forecast, run_regression, run_segments)


@pytest.fixture(scope="module")
def orders():
    return demo_frame(rows=650)


def test_demo_is_reproducible_and_explicitly_synthetic():
    first, second = demo_frame(rows=80), demo_frame(rows=80)
    pd.testing.assert_frame_equal(first, second)
    assert "Synthetic" in first.attrs["source"]
    assert np.array_equal(first.delivery_late, (first.delivery_days > first.promised_days).astype(int))
    expected_availability = first.purchase_date + pd.to_timedelta(first.delivery_days, unit="D")
    pd.testing.assert_series_equal(first.outcome_available_date, expected_availability,
                                   check_names=False)


def test_profile_and_ingest_are_strict_json(orders):
    restored = load_csv_bytes(orders.to_csv(index=False).encode())
    assert pd.api.types.is_datetime64_any_dtype(restored.purchase_date)
    profile = profile_frame(restored)
    json.dumps(profile, allow_nan=False)
    assert profile["rows"] == len(orders)
    assert sum(row["count"] for row in profile["charts"]["categories"]) == len(orders)


@pytest.mark.parametrize("content", [b"", b"a,a\n1,2", b"a,\n1,2", b"a,b\n", b"\x00a,b\n1,2"])
def test_invalid_csv_is_rejected(content):
    with pytest.raises(ValueError):
        load_csv_bytes(content)


def test_classification_excludes_outcomes_even_when_requested(orders):
    result = run_classification(orders, features=["distance_km", "promised_days", "delivery_days", "review_rating", "order_id"])
    assert result["features"] == ["distance_km", "promised_days"]
    assert {row["feature"] for row in result["excluded_features"]} == {"delivery_days", "review_rating", "order_id"}
    assert pd.Timestamp(result["split"]["train_end"]) < pd.Timestamp(result["split"]["test_start"])
    assert len(result["models"]) == 3
    assert result["selection_method"].startswith("Predeclared")
    json.dumps(result, allow_nan=False)


def test_regression_does_not_use_labels_or_review(orders):
    result = run_regression(orders)
    assert {"delivery_late", "delivery_days", "review_rating", "seller_id", "order_id"}.isdisjoint(result["features"])
    assert all(model["metrics"]["mae"] >= 0 for model in result["models"])
    json.dumps(result, allow_nan=False)


def test_preprocessing_statistics_fit_only_training_values():
    training = pd.DataFrame({"distance": [1.0, 2.0, np.nan], "category": ["a", "b", None]})
    # _clean normalizes missing object values before this normal production path.
    training["category"] = training["category"].fillna(np.nan)
    preprocess = _preprocessor(training)
    preprocess.fit(training)
    numeric = preprocess.named_transformers_["numeric"]
    assert numeric.named_steps["imputer"].statistics_[0] == 1.5
    transformed = preprocess.transform(pd.DataFrame({"distance": [1_000_000.0], "category": ["unseen"]}))
    assert np.isfinite(transformed).all()
    assert numeric.named_steps["imputer"].statistics_[0] == 1.5


def test_forecast_uses_only_prefix_and_reserves_holdout(orders):
    result = run_forecast(orders)
    assert len(result["forecast"]) == 14
    assert len(result["backtest"]) == 28
    assert pd.Timestamp(result["split"]["train_end"]) < pd.Timestamp(result["split"]["test_start"])
    assert result["interval"]["calibration_days"] == 28
    assert result["interval"]["holdout_coverage"] >= 0
    prefix = np.arange(20.0)
    assert _lag_features(prefix, pd.Timestamp("2025-02-03"))[0] == 19
    assert _lag_features(prefix, pd.Timestamp("2025-02-03"))[1] == 13
    assert _lag_features(prefix, pd.Timestamp("2025-02-03"))[2] == 6
    json.dumps(result, allow_nan=False)


def test_forecast_ignores_unrelated_outcome_values(orders):
    original = run_forecast(orders)
    altered = orders.copy()
    altered["delivery_days"] = 99999
    altered["review_rating"] = 0
    changed = run_forecast(altered)
    assert original == changed


def test_future_holdout_observations_cannot_change_earlier_forecasts(orders):
    original = run_forecast(orders)
    # Extra final-day orders change a later observation without moving the
    # calendar boundary. Earlier predictions and calibration remain unchanged.
    last_day = orders.purchase_date.max()
    extra = orders.loc[orders.purchase_date == last_day].copy()
    altered = pd.concat([orders, extra, extra, extra], ignore_index=True)
    changed = run_forecast(altered)
    assert original["backtest"][0] == changed["backtest"][0]
    assert original["interval"]["radius"] == changed["interval"]["radius"]


def test_holdout_only_features_are_not_selected(orders):
    modified = orders.copy()
    modified["holdout_only_signal"] = 1.0
    modified.loc[modified.purchase_date >= modified.purchase_date.quantile(0.9), "holdout_only_signal"] = 999.0
    result = run_classification(modified)
    assert "holdout_only_signal" not in result["features"]


def test_training_labels_must_be_available_before_cutoff(orders):
    original = run_classification(orders)
    cutoff = pd.Timestamp(original["split"]["cutoff"]).tz_localize(None)
    altered = orders.copy()
    # These early purchases would normally belong to training, but their labels
    # are unavailable at deployment time and must not enter model fitting.
    altered.loc[altered.index[:15], "outcome_available_date"] = cutoff + pd.Timedelta(days=1)
    altered.loc[altered.index[15], "outcome_available_date"] = pd.NaT
    changed = run_classification(altered)
    assert changed["split"]["purged_pending_labels"] == original["split"]["purged_pending_labels"] + 16
    assert changed["train_rows"] == original["train_rows"] - 16
    assert "outcome_available_date" not in changed["features"]
    assert pd.Timestamp(changed["split"]["latest_training_label_available"]) < pd.Timestamp(
        changed["split"]["label_availability_cutoff"])


def test_labels_available_exactly_at_cutoff_are_purged(orders):
    original = run_regression(orders)
    cutoff = pd.Timestamp(original["split"]["cutoff"]).tz_localize(None)
    altered = orders.copy()
    altered.loc[altered.index[:4], "outcome_available_date"] = cutoff
    changed = run_regression(altered)
    assert changed["split"]["purged_pending_labels"] == original["split"]["purged_pending_labels"] + 4


def test_outcome_availability_cannot_precede_purchase(orders):
    altered = orders.copy()
    altered.loc[0, "outcome_available_date"] = altered.loc[0, "purchase_date"] - pd.Timedelta(days=1)
    with pytest.raises(ValueError, match="must not precede"):
        run_classification(altered)


def test_segments_do_not_use_delivery_outcomes(orders):
    result = run_segments(orders)
    assert {"delivery_days", "delivery_late", "review_rating"}.isdisjoint(result["features"])
    assert sum(cluster["count"] for cluster in result["clusters"]) == len(orders)
    assert -1 <= result["silhouette"] <= 1
    json.dumps(result, allow_nan=False)


def test_unusable_inputs_return_actionable_errors(orders):
    with pytest.raises(ValueError, match="40 rows"):
        run_classification(orders.head(10))
    with pytest.raises(ValueError, match="No usable"):
        run_classification(orders, features=["delivery_days", "order_id"])
    missing_target = orders.copy()
    missing_target["delivery_late"] = np.nan
    with pytest.raises(ValueError, match="40 rows"):
        run_classification(missing_target)
    bad_dates = orders.copy()
    bad_dates["purchase_date"] = pd.NaT
    with pytest.raises(ValueError, match="invalid dates"):
        run_classification(bad_dates)
    with pytest.raises(ValueError, match="84 calendar days"):
        run_forecast(orders.head(10))
