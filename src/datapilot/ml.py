"""Evaluated, CPU-friendly ML workflows with explicit feature-time boundaries.

Supervised delivery models predict at purchase time. Post-delivery fields and
identifiers are rejected even when explicitly requested. Generic user targets
still require the user to establish which remaining inputs existed at prediction
time; column-name rules cannot prove the absence of leakage in arbitrary CSVs.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import IsolationForest, RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (accuracy_score, f1_score, mean_absolute_error,
                             mean_squared_error, precision_score, r2_score,
                             recall_score, roc_auc_score, silhouette_score)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .data import records

RANDOM_SEED = 42
_OUTCOME_PATTERN = re.compile(r"(^|_)(review|rating|delivered|delivery|arrival|actual|outcome|late|delay|target|label)(_|$)")
_ID_PATTERN = re.compile(r"(^id$|(^|_)id$|uuid|(^|_)name$|(^|_)email$|(^|_)url$)")


def _clean(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    for column in result:
        if pd.api.types.is_numeric_dtype(result[column]):
            result[column] = pd.to_numeric(result[column], errors="coerce").replace([np.inf, -np.inf], np.nan)
        else:
            result[column] = result[column].map(lambda value: str(value) if pd.notna(value) else np.nan)
    return result


def _features(df: pd.DataFrame, target: str | None, requested: list[str] | None = None) -> tuple[list[str], list[dict[str, str]]]:
    candidates = list(df.columns) if requested is None else list(dict.fromkeys(requested))
    unknown = [column for column in candidates if column not in df]
    if unknown:
        raise ValueError(f"Unknown feature columns: {', '.join(unknown)}")
    chosen, excluded = [], []
    for column in candidates:
        name = str(column).lower()
        reason = None
        if column == target:
            reason = "prediction target"
        elif _OUTCOME_PATTERN.search(name):
            reason = "post-outcome field; unavailable at order time"
        elif _ID_PATTERN.search(name):
            reason = "identifier or personal/text field"
        elif pd.api.types.is_datetime64_any_dtype(df[column]) or name.endswith(("_date", "_timestamp")):
            reason = "date reserved for chronological splitting"
        elif df[column].notna().sum() == 0:
            reason = "entirely missing"
        elif not pd.api.types.is_numeric_dtype(df[column]) and df[column].nunique() > 30:
            reason = "high-cardinality text; use a dedicated text workflow"
        elif df[column].nunique(dropna=True) < 2:
            reason = "constant column"
        if reason:
            excluded.append({"feature": str(column), "reason": reason})
        else:
            chosen.append(column)
    if not chosen:
        raise ValueError("No usable order-time features remain. Supply numeric or low-cardinality categorical inputs.")
    if len(chosen) > 50:
        raise ValueError("Select at most 50 model input columns.")
    return chosen, excluded


def _preprocessor(frame: pd.DataFrame) -> ColumnTransformer:
    numeric = list(frame.select_dtypes(include="number").columns)
    categorical = [column for column in frame if column not in numeric]
    transformers = []
    if numeric:
        transformers.append(("numeric", Pipeline([("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
                                                   ("scaler", StandardScaler())]), numeric))
    if categorical:
        transformers.append(("categorical", Pipeline([
            ("imputer", SimpleImputer(strategy="constant", fill_value="(missing)")),
            ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]), categorical))
    return ColumnTransformer(transformers, verbose_feature_names_out=False)


def _split(df: pd.DataFrame, y: np.ndarray, classification: bool) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    indices = np.arange(len(df))
    if "purchase_date" in df:
        dates = pd.to_datetime(df["purchase_date"], errors="coerce", utc=True)
        if dates.isna().any():
            raise ValueError("purchase_date contains missing or invalid dates. Correct them before temporal evaluation.")
        # Split on complete timestamps; equal dates never straddle the boundary.
        cutoff = dates.sort_values().iloc[min(int(len(df) * 0.8), len(df) - 1)]
        train = indices[(dates < cutoff).to_numpy()]
        test = indices[(dates >= cutoff).to_numpy()]
        candidate_rows = len(train)
        latest_training_label = None
        availability_warning = "No outcome_available_date supplied; label-availability timing cannot be verified."
        if "outcome_available_date" in df:
            available = pd.to_datetime(df["outcome_available_date"], errors="coerce", utc=True)
            malformed = df["outcome_available_date"].notna() & available.isna()
            if malformed.any():
                raise ValueError("outcome_available_date contains invalid dates. Correct them before temporal evaluation.")
            if (available.notna() & (available < dates)).any():
                raise ValueError("outcome_available_date must not precede its purchase_date.")
            observed = available.iloc[train].notna() & (available.iloc[train] < cutoff)
            train = train[observed.to_numpy()]
            if len(train):
                latest_training_label = available.iloc[train].max().isoformat()
            availability_warning = "Training labels must have become available strictly before the test cutoff; pending labels are purged."
        if len(train) < 20 or len(test) < 5:
            raise ValueError("Need at least 20 earlier rows with available labels and 5 later holdout rows across distinct purchase dates.")
        return train, test, {"method": "chronological holdout", "cutoff": cutoff.isoformat(),
                             "train_end": dates.iloc[train].max().isoformat(),
                             "test_start": dates.iloc[test].min().isoformat(),
                             "candidate_train_rows": int(candidate_rows),
                             "purged_pending_labels": int(candidate_rows - len(train)),
                             "label_availability_cutoff": cutoff.isoformat(),
                             "latest_training_label_available": latest_training_label,
                             "label_availability": availability_warning,
                             "preprocessing": "Imputation, scaling and encoding fitted on training rows only."}
    counts = pd.Series(y).value_counts()
    stratify = y if classification and counts.min() >= 2 else None
    train, test = train_test_split(indices, test_size=0.2, random_state=RANDOM_SEED, stratify=stratify)
    return train, test, {"method": "random holdout", "seed": RANDOM_SEED,
                         "preprocessing": "Imputation, scaling and encoding fitted on training rows only.",
                         "warning": "No purchase_date supplied; this split does not establish future-period generalization."}


def _prepare(df: pd.DataFrame, target: str, features: list[str] | None, classification: bool):
    if not isinstance(df, pd.DataFrame) or df.empty or target not in df:
        raise ValueError(f"A non-empty dataset containing target '{target}' is required.")
    if not df.columns.is_unique:
        raise ValueError("Dataset column names must be unique.")
    if len(df) > 100_000:
        raise ValueError("Use at most 100,000 rows for this local workbench.")
    frame = df.loc[df[target].notna()].copy().reset_index(drop=True)
    if not classification:
        numeric_target = pd.to_numeric(frame[target], errors="coerce").replace([np.inf, -np.inf], np.nan)
        frame = frame.loc[numeric_target.notna()].copy().reset_index(drop=True)
        frame[target] = pd.to_numeric(frame[target])
    if len(frame) < 40:
        raise ValueError("At least 40 rows with valid target values are required.")
    if classification:
        labels = sorted(frame[target].astype(str).unique())
        if len(labels) != 2:
            raise ValueError("Classification currently requires a binary target with exactly two classes.")
        y = (frame[target].astype(str) == labels[1]).astype(int).to_numpy()
    else:
        labels = None
        y = frame[target].to_numpy(dtype=float)
        if np.ptp(y) == 0:
            raise ValueError("Regression requires a target with more than one distinct value.")
    train, test, split = _split(frame, y, classification)
    if classification and len(np.unique(y[train])) != 2:
        raise ValueError("The training period must contain both classes. Add earlier labeled examples or choose another target.")
    # Feature availability gates use only training distributions, including
    # constant/all-missing/high-cardinality checks. Heldout values stay unseen.
    names, excluded = _features(frame.iloc[train], target, features)
    x = _clean(frame[names])
    return frame, x, y, labels, names, excluded, train, test, split


def _importance(pipeline: Pipeline) -> list[dict[str, Any]]:
    estimator = pipeline.named_steps["model"]
    names = pipeline.named_steps["preprocessor"].get_feature_names_out()
    if hasattr(estimator, "feature_importances_"):
        values = estimator.feature_importances_
    elif hasattr(estimator, "coef_"):
        values = np.abs(np.asarray(estimator.coef_).reshape(-1))
    else:
        return []
    return [{"feature": str(names[i]), "importance": round(float(values[i]), 6)}
            for i in np.argsort(values)[::-1][:15]]


def run_classification(df: pd.DataFrame, target: str = "delivery_late", features: list[str] | None = None) -> dict[str, Any]:
    frame, x, y, labels, names, excluded, train, test, split = _prepare(df, target, features, True)
    estimators = [
        ("Majority baseline", DummyClassifier(strategy="most_frequent")),
        ("Logistic regression", LogisticRegression(max_iter=700, class_weight="balanced", random_state=RANDOM_SEED)),
        ("Random forest", RandomForestClassifier(n_estimators=100, max_depth=12, min_samples_leaf=4,
                                                  class_weight="balanced_subsample", random_state=RANDOM_SEED, n_jobs=1)),
    ]
    results, fitted, outputs = [], {}, {}
    for name, estimator in estimators:
        model = Pipeline([("preprocessor", _preprocessor(x.iloc[train])), ("model", estimator)])
        model.fit(x.iloc[train], y[train])
        predicted = model.predict(x.iloc[test])
        probabilities = model.predict_proba(x.iloc[test])[:, 1]
        metrics = {"accuracy": float(accuracy_score(y[test], predicted)),
                   "precision": float(precision_score(y[test], predicted, zero_division=0)),
                   "recall": float(recall_score(y[test], predicted, zero_division=0)),
                   "f1": float(f1_score(y[test], predicted, zero_division=0)),
                   "roc_auc": float(roc_auc_score(y[test], probabilities)) if len(np.unique(y[test])) == 2 else None}
        results.append({"name": name, "metrics": metrics})
        fitted[name], outputs[name] = model, (predicted, probabilities)
    # Pre-declare the demonstration model. Holdout metrics are not used to tune or
    # select it, and remain an honest final-period comparison of fixed models.
    selected = "Random forest"
    predicted, probabilities = outputs[selected]
    examples = [{"row": int(test[i]), "actual": labels[int(y[test[i]])], "predicted": labels[int(predicted[i])],
                 "probability_positive": round(float(probabilities[i]), 5)} for i in range(min(15, len(test)))]
    return {"task": "classification", "target": target, "classes": labels, "positive_class": labels[1],
            "data_provenance": df.attrs.get("source", "Dataset provenance has not been verified."),
            "features": names, "excluded_features": excluded, "split": split,
            "train_rows": int(len(train)), "test_rows": int(len(test)), "dropped_target_rows": int(len(df) - len(frame)),
            "models": results, "selected_model": selected, "selection_method": "Predeclared random forest; no holdout-driven tuning.",
            "model_definitions": [
                {"name": "Majority baseline", "estimator": "DummyClassifier", "parameters": {"strategy": "most_frequent"}},
                {"name": "Logistic regression", "estimator": "LogisticRegression", "parameters": {"C": 1.0, "class_weight": "balanced", "max_iter": 700}},
                {"name": "Random forest", "estimator": "RandomForestClassifier", "parameters": {"n_estimators": 100, "max_depth": 12, "min_samples_leaf": 4, "class_weight": "balanced_subsample", "random_state": RANDOM_SEED}},
            ],
            "feature_importance": _importance(fitted[selected]), "predictions": examples,
            "limitations": ["Metrics describe this dataset and holdout only; synthetic-demo scores do not establish real-world performance.",
                            "Feature-name exclusions reduce known delivery leakage but cannot certify arbitrary uploaded features.",
                            "Precision/recall use the reported positive class and a 0.5 probability decision threshold.",
                            "Feature importance describes model associations, not causal effects."]}


def run_regression(df: pd.DataFrame, target: str = "delivery_days", features: list[str] | None = None) -> dict[str, Any]:
    frame, x, y, _, names, excluded, train, test, split = _prepare(df, target, features, False)
    estimators = [
        ("Median baseline", DummyRegressor(strategy="median")),
        ("Ridge regression", Ridge(alpha=10.0)),
        ("Random forest", RandomForestRegressor(n_estimators=100, max_depth=12, min_samples_leaf=4,
                                                 random_state=RANDOM_SEED, n_jobs=1)),
    ]
    results, fitted, outputs = [], {}, {}
    for name, estimator in estimators:
        model = Pipeline([("preprocessor", _preprocessor(x.iloc[train])), ("model", estimator)])
        model.fit(x.iloc[train], y[train])
        predicted = model.predict(x.iloc[test])
        results.append({"name": name, "metrics": {"mae": float(mean_absolute_error(y[test], predicted)),
                        "rmse": float(np.sqrt(mean_squared_error(y[test], predicted))),
                        "r2": float(r2_score(y[test], predicted)) if np.ptp(y[test]) > 0 else None}})
        fitted[name], outputs[name] = model, predicted
    selected = "Random forest"
    predicted = outputs[selected]
    return {"task": "regression", "target": target, "features": names, "excluded_features": excluded,
            "data_provenance": df.attrs.get("source", "Dataset provenance has not been verified."),
            "split": split, "train_rows": int(len(train)), "test_rows": int(len(test)),
            "dropped_target_rows": int(len(df) - len(frame)), "models": results,
            "selected_model": selected, "selection_method": "Predeclared random forest; no holdout-driven tuning.",
            "model_definitions": [
                {"name": "Median baseline", "estimator": "DummyRegressor", "parameters": {"strategy": "median"}},
                {"name": "Ridge regression", "estimator": "Ridge", "parameters": {"alpha": 10.0}},
                {"name": "Random forest", "estimator": "RandomForestRegressor", "parameters": {"n_estimators": 100, "max_depth": 12, "min_samples_leaf": 4, "random_state": RANDOM_SEED}},
            ],
            "feature_importance": _importance(fitted[selected]),
            "predictions": [{"row": int(test[i]), "actual": float(y[test[i]]), "predicted": round(float(predicted[i]), 4)}
                            for i in range(min(15, len(test)))],
            "limitations": ["Fixed-model chronological comparison; no nested tuning or causal interpretation.",
                            "Post-outcome columns are excluded. Confirm remaining uploaded inputs existed at prediction time.",
                            "Synthetic-demo performance must not be reported as a real business improvement."]}


def _lag_features(values: list[float] | np.ndarray, day: pd.Timestamp) -> np.ndarray:
    """Use only observed/predicted values strictly preceding the forecast date."""
    history = np.asarray(values, dtype=float)
    angle = 2 * np.pi * day.day_of_week / 7
    return np.asarray([history[-1], history[-7], history[-14], history[-7:].mean(),
                       history[-14:].mean(), np.sin(angle), np.cos(angle)], dtype=float)


def run_forecast(df: pd.DataFrame, date_column: str = "purchase_date") -> dict[str, Any]:
    if date_column not in df or df.empty:
        raise ValueError(f"A dataset containing '{date_column}' is required.")
    dates = pd.to_datetime(df[date_column], errors="coerce", utc=True)
    if dates.isna().any():
        raise ValueError("Forecast dates must be complete and valid.")
    dates = dates.dt.tz_convert(None).dt.floor("D")
    counts = dates.value_counts().sort_index()
    if (counts.index.max() - counts.index.min()).days > 3650:
        raise ValueError("Select a forecast history spanning at most ten years.")
    series = counts.reindex(pd.date_range(counts.index.min(), counts.index.max(), freq="D"), fill_value=0).astype(float)
    if len(series) < 84:
        raise ValueError("Forecasting requires at least 84 calendar days of order history.")
    values, index = series.to_numpy(), series.index
    holdout = 28
    cutoff = len(series) - holdout
    features = np.asarray([_lag_features(values[:i], index[i]) for i in range(14, len(series))])
    labels = values[14:]
    # Separate calibration prefix for approximate intervals. It never uses the
    # final holdout labels, and is not a guarantee of future coverage.
    calibration_start = max(35, cutoff - 28)
    interval_model = Pipeline([("scale", StandardScaler()), ("model", Ridge(alpha=10.0))])
    interval_model.fit(features[:calibration_start - 14], labels[:calibration_start - 14])
    calibration_prediction = np.maximum(0, interval_model.predict(features[calibration_start - 14:cutoff - 14]))
    residuals = np.abs(values[calibration_start:cutoff] - calibration_prediction)
    radius = float(np.quantile(residuals, 0.9))
    model = Pipeline([("scale", StandardScaler()), ("model", Ridge(alpha=10.0))])
    model.fit(features[:cutoff - 14], labels[:cutoff - 14])
    # Rolling one-day evaluation: the previous day's actual count becomes
    # available before predicting the next day. Coefficients remain fixed.
    predicted, seasonal, backtest = [], [], []
    for i in range(cutoff, len(series)):
        value = float(max(0, model.predict(_lag_features(values[:i], index[i]).reshape(1, -1))[0]))
        naive = float(values[i - 7])
        predicted.append(value)
        seasonal.append(naive)
        backtest.append({"date": index[i].strftime("%Y-%m-%d"), "actual": float(values[i]),
                         "predicted": round(value, 4), "seasonal_naive": naive,
                         "lower": round(max(0.0, value - radius), 4), "upper": round(value + radius, 4)})
    results = []
    for name, prediction in [("Weekly seasonal naive", seasonal), ("Lag-feature ridge", predicted)]:
        results.append({"name": name, "metrics": {"mae": float(mean_absolute_error(values[cutoff:], prediction)),
                        "rmse": float(np.sqrt(mean_squared_error(values[cutoff:], prediction)))}})
    # Refit after evaluation using all currently observed history. Recursive
    # forecasts append predictions, never unseen future labels.
    model.fit(features, labels)
    history = list(values)
    future = []
    for step in range(1, 15):
        day = index[-1] + pd.Timedelta(days=step)
        value = float(max(0.0, model.predict(_lag_features(history, day).reshape(1, -1))[0]))
        history.append(value)
        future.append({"date": day.strftime("%Y-%m-%d"), "predicted": round(value, 4),
                       "lower": round(max(0.0, value - radius), 4), "upper": round(value + radius, 4)})
    coverage = np.mean([row["lower"] <= row["actual"] <= row["upper"] for row in backtest])
    return {"task": "forecast", "date_column": date_column, "target": "daily_order_count",
            "data_provenance": df.attrs.get("source", "Dataset provenance has not been verified."),
            "train_rows": int(cutoff), "test_rows": holdout, "selected_model": "Lag-feature ridge",
            "split": {"method": "rolling one-day holdout", "train_end": index[cutoff - 1].strftime("%Y-%m-%d"),
                      "test_start": index[cutoff].strftime("%Y-%m-%d"),
                      "description": "Fixed model; each holdout day uses only observations from preceding dates."},
            "models": results,
            "model_definitions": [{"name": "Weekly seasonal naive", "estimator": "lag-7", "parameters": {"lag": 7}},
                                  {"name": "Lag-feature ridge", "estimator": "StandardScaler + Ridge", "parameters": {"alpha": 10.0},
                                   "features": ["lag_1", "lag_7", "lag_14", "mean_last_7", "mean_last_14", "weekday_sin", "weekday_cos"]}],
            "history": [{"date": day.strftime("%Y-%m-%d"), "count": int(value)}
                                            for day, value in series.tail(365).items()],
            "backtest": backtest, "forecast": future,
            "interval": {"method": "90th percentile absolute residual from a pre-holdout calibration prefix",
                         "nominal_coverage": 0.9, "holdout_coverage": float(coverage),
                         "calibration_days": int(len(residuals)), "radius": radius,
                         "warning": "Approximate one-day residual bands; 14-day recursive coverage is not validated."},
            "limitations": ["Missing dates are treated as zero orders. Verify that the uploaded extract contains complete order history.",
                            "One-day rolling backtest metrics do not measure 14-day recursive forecasting accuracy.",
                            "The same residual width is shown at every horizon; it is an exploratory band, not a coverage guarantee.",
                            "Synthetic-demo patterns and accuracy do not establish real-world forecasting performance."]}


def run_segments(df: pd.DataFrame) -> dict[str, Any]:
    if not isinstance(df, pd.DataFrame) or len(df) < 20:
        raise ValueError("Segmentation requires at least 20 rows.")
    features, excluded = _features(df, None)
    numeric = [column for column in features if pd.api.types.is_numeric_dtype(df[column])]
    if len(numeric) < 2:
        raise ValueError("Segmentation requires at least two varying numeric order-time columns.")
    x = _clean(df[numeric])
    preprocess = Pipeline([("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
                           ("scale", StandardScaler())])
    values = preprocess.fit_transform(x)
    distinct = len(np.unique(values, axis=0))
    if distinct < 3:
        raise ValueError("Segmentation requires at least three distinct numeric profiles.")
    cluster_count = min(4, distinct, max(2, len(df) // 10))
    labels = KMeans(n_clusters=cluster_count, n_init=10, random_state=RANDOM_SEED).fit_predict(values)
    isolation = IsolationForest(n_estimators=80, contamination="auto", random_state=RANDOM_SEED, n_jobs=1)
    isolation.fit(values)
    scores = -isolation.score_samples(values)
    predictions = isolation.predict(values)
    clusters = []
    for cluster in sorted(np.unique(labels)):
        subset = x.loc[labels == cluster]
        means = subset.mean(numeric_only=True)
        clusters.append({"cluster": int(cluster), "count": int(len(subset)),
                         "means": {str(k): float(v) if np.isfinite(v) else None for k, v in means.items()}})
    top = np.argsort(scores)[::-1][:10]
    anomalies = []
    for position in top:
        anomalies.append({"row": int(position), "score": round(float(scores[position]), 5),
                          "flagged": bool(predictions[position] == -1),
                          "values": records(df.iloc[[position]][numeric])[0]})
    silhouette = float(silhouette_score(values, labels, sample_size=min(len(values), 2000), random_state=RANDOM_SEED))
    return {"task": "segments", "features": numeric, "excluded_features": excluded, "rows": int(len(df)),
            "data_provenance": df.attrs.get("source", "Dataset provenance has not been verified."),
            "algorithm": "K-means on median-imputed, standardized numeric order inputs",
            "cluster_count": int(len(clusters)), "silhouette": silhouette, "clusters": clusters,
            "assignments": [{"row": int(i), "cluster": int(labels[i])} for i in range(min(len(df), 1000))],
            "anomalies": anomalies, "anomaly_count": int(np.sum(predictions == -1)),
            "limitations": ["Clustering is exploratory and fitted on the displayed dataset; clusters are not validated customer segments.",
                            "Isolation Forest flags unusual numeric profiles, not verified fraud, defects, or incidents.",
                            "K-means cluster numbers are arbitrary identifiers; silhouette is descriptive, not a business-success metric."]}
