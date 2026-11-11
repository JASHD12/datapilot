import json
from zipfile import ZipFile

import numpy as np
import pandas as pd
import pytest

from datapilot.data import demo_frame
from datapilot.public_demo import all_order_history, fit_browser_model, predict_exported


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_exported_formula_matches_pipeline_with_missing_values(task):
    frame = demo_frame(rows=300)
    exported, pipeline = fit_browser_model(frame, task)
    values = {"order_value": 160.0, "freight_value": None, "promised_days": 7.0, "items_count": 2.0}
    inputs = pd.DataFrame([values], columns=exported["features"])
    expected = pipeline.predict_proba(inputs)[0, 1] if task == "classification" else pipeline.predict(inputs)[0]
    assert predict_exported(exported, values) == pytest.approx(expected, rel=1e-12, abs=1e-12)
    assert exported["split"]["purged_pending_labels"] > 0
    assert exported["cutoff"] > exported["split"]["latest_training_label_available"]
    json.dumps(exported, allow_nan=False)


def test_exported_sigmoid_is_finite_for_extreme_values():
    exported, _ = fit_browser_model(demo_frame(rows=300), "classification")
    for value in [1e100, -1e100]:
        result = predict_exported(exported, {feature: value for feature in exported["features"]})
        assert np.isfinite(result)
        assert 0 <= result <= 1


def test_all_order_forecast_includes_every_status_and_excludes_sparse_tail(tmp_path):
    path = tmp_path / "orders.zip"
    with ZipFile(path, "w") as archive:
        archive.writestr("olist_orders_dataset.csv", "order_id,order_status,order_purchase_timestamp\n"
                         "a,delivered,2017-02-01 12:00:00\n"
                         "b,canceled,2017-02-01 13:00:00\n"
                         "c,unavailable,2018-08-21 23:59:59\n"
                         "d,delivered,2018-08-22 00:00:00\n"
                         "e,delivered,2016-12-31 23:59:59\n")
    frame = all_order_history(path)
    assert len(frame) == 3
    assert frame.attrs["source"]["raw_unique_orders"] == 5
    assert frame.attrs["source"]["window_orders"] == 3
    assert frame["purchase_date"].max() == pd.Timestamp("2018-08-21 23:59:59")


def test_export_refuses_unknown_task():
    with pytest.raises(ValueError, match="classification or regression"):
        fit_browser_model(demo_frame(rows=300), "invented")
