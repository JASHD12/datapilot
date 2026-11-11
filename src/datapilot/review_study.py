"""Retrospective review-classification study with a repeated-wording audit.

The existing public Olist cohort has already been inspected. This study freezes
its candidate set before running and withholds the final period from its fitting
and selection code; it does not turn that period into previously unseen evidence.
Only aggregate metrics leave this module. Review text and order IDs stay local.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import platform
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.pipeline import Pipeline

from datapilot.reviews import LABELS, SOURCE_URL, _read_reviews

SEED = 42
CANDIDATES = (
    {
        "id": "word_tfidf",
        "name": "Word TF-IDF + logistic regression",
        "definition": {"analyzer": "word", "ngram_range": [1, 2], "max_features": 5000},
    },
    {
        "id": "char_tfidf",
        "name": "Character TF-IDF + logistic regression",
        "definition": {"analyzer": "char_wb", "ngram_range": [3, 5], "max_features": 20000},
    },
)
NORMALIZATION = (
    "Unicode NFKD casefold, remove accent marks, retain alphanumeric tokens and "
    "collapse punctuation/whitespace. Exact equality after this transform only; "
    "near-duplicate and paraphrase detection is not performed."
)


def normalize_review_text(text: str) -> str:
    text = "".join(
        character for character in unicodedata.normalize("NFKD", str(text).casefold())
        if not unicodedata.combining(character)
    )
    return " ".join(re.findall(r"[^\W_]+", text, flags=re.UNICODE))


def chronological_split(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Choose 60/20/20 timestamp boundaries without splitting identical times."""
    required = {"available_at", "text", "label"}
    if not required.issubset(frame) or len(frame) < 60:
        raise ValueError("Need at least 60 review texts, labels and answer timestamps.")
    ordered = frame.copy()
    ordered["available_at"] = pd.to_datetime(ordered["available_at"], errors="raise")
    if ordered["available_at"].isna().any() or not set(ordered["label"]).issubset(LABELS):
        raise ValueError("Need valid answer timestamps and declared rating-group labels.")
    ordered = ordered.sort_values("available_at", kind="stable").reset_index(drop=True)
    validation_start = ordered["available_at"].iloc[int(len(ordered) * 0.6)]
    test_start = ordered["available_at"].iloc[int(len(ordered) * 0.8)]
    train = ordered.loc[ordered["available_at"] < validation_start].copy()
    validation = ordered.loc[(ordered["available_at"] >= validation_start) & (ordered["available_at"] < test_start)].copy()
    test = ordered.loc[ordered["available_at"] >= test_start].copy()
    if len(train) < 30 or len(validation) < 10 or len(test) < 10 or set(train["label"]) != set(LABELS):
        raise ValueError("Need three chronological partitions and every rating group in training.")
    return train, validation, test


def fit_candidates(train: pd.DataFrame) -> dict[str, Pipeline]:
    """Fit the two predeclared ablations using the training partition only."""
    result = {}
    for specification in CANDIDATES:
        definition = specification["definition"]
        model = Pipeline([
            ("tfidf", TfidfVectorizer(
                analyzer=definition["analyzer"], ngram_range=tuple(definition["ngram_range"]),
                max_features=definition["max_features"], min_df=2, lowercase=True,
                strip_accents="unicode", sublinear_tf=True,
            )),
            ("model", LogisticRegression(C=1.0, class_weight="balanced", max_iter=500, random_state=SEED)),
        ])
        model.fit(train["text"], train["label"])
        result[specification["id"]] = model
    return result


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict:
    return {
        "accuracy": float(accuracy_score(actual, predicted)),
        "macro_f1": float(f1_score(actual, predicted, labels=LABELS, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(actual, predicted, labels=LABELS, average="weighted", zero_division=0)),
    }


def _macro_f1_from_confusions(matrices: np.ndarray) -> np.ndarray:
    true_positive = np.diagonal(matrices, axis1=1, axis2=2)
    denominator = matrices.sum(axis=1) + matrices.sum(axis=2)
    ratios = np.divide(2 * true_positive, denominator, out=np.zeros_like(true_positive, dtype=float), where=denominator != 0)
    return ratios.mean(axis=1)


def cluster_bootstrap(
    actual: np.ndarray, predicted: np.ndarray, baseline: np.ndarray, groups: np.ndarray,
    *, replicates: int = 200, seed: int = SEED,
) -> tuple[dict, dict]:
    """Resample normalized-text groups, keeping repeated wording together.

    These exploratory intervals assume exchangeable text groups. They do not
    model temporal drift, label uncertainty or transfer to another marketplace.
    """
    if not 10 <= replicates <= 1000:
        raise ValueError("Bootstrap replicates must be between 10 and 1000.")
    if not (len(actual) == len(predicted) == len(baseline) == len(groups)) or not len(actual):
        raise ValueError("Bootstrap needs equally sized nonempty labels, predictions and groups.")
    _, inverse = np.unique(groups, return_inverse=True)
    number_of_groups = int(inverse.max()) + 1
    label_index = {label: index for index, label in enumerate(LABELS)}
    actual_index = np.asarray([label_index[label] for label in actual])
    candidate_index = np.asarray([label_index[label] for label in predicted])
    baseline_index = np.asarray([label_index[label] for label in baseline])
    group_candidate = np.zeros((number_of_groups, 9), dtype=np.int64)
    group_baseline = np.zeros_like(group_candidate)
    np.add.at(group_candidate, (inverse, actual_index * 3 + candidate_index), 1)
    np.add.at(group_baseline, (inverse, actual_index * 3 + baseline_index), 1)
    random = np.random.default_rng(seed)
    weights = random.multinomial(number_of_groups, np.full(number_of_groups, 1.0 / number_of_groups), size=replicates)
    candidate_scores = _macro_f1_from_confusions((weights @ group_candidate).reshape(-1, 3, 3))
    baseline_scores = _macro_f1_from_confusions((weights @ group_baseline).reshape(-1, 3, 3))
    definition = {"confidence": 0.95, "replicates": replicates, "seed": seed,
                  "unit": "normalized text groups", "groups": number_of_groups,
                  "method": "paired cluster bootstrap; percentile interval", "available": True}
    interval = {**definition, "lower": float(np.quantile(candidate_scores, 0.025)), "upper": float(np.quantile(candidate_scores, 0.975))}
    differences = candidate_scores - baseline_scores
    difference = {**definition, "lower": float(np.quantile(differences, 0.025)), "upper": float(np.quantile(differences, 0.975))}
    return interval, difference


def _evaluate(frame: pd.DataFrame, model: Pipeline, majority_label: str, bootstrap_replicates: int) -> dict:
    if frame.empty:
        return {"rows": 0, "metrics": None, "baseline_metrics": None, "per_class": [],
                "confusion_matrix": [[0] * 3 for _ in range(3)],
                "bootstrap_macro_f1": {"available": False, "reason": "No qualifying test reviews."},
                "bootstrap_macro_f1_difference": {"available": False, "reason": "No qualifying test reviews."}}
    actual = frame["label"].to_numpy()
    predicted = model.predict(frame["text"])
    baseline = np.full(len(frame), majority_label, dtype=object)
    precision, recall, f1, support = precision_recall_fscore_support(actual, predicted, labels=LABELS, zero_division=0)
    interval, difference = cluster_bootstrap(actual, predicted, baseline, frame["normalized"].to_numpy(), replicates=bootstrap_replicates)
    return {
        "rows": len(frame), "metrics": metrics(actual, predicted), "baseline_metrics": metrics(actual, baseline),
        "per_class": [{"label": label, "precision": float(precision[index]), "recall": float(recall[index]),
                       "f1": float(f1[index]), "support": int(support[index])} for index, label in enumerate(LABELS)],
        "confusion_matrix": confusion_matrix(actual, predicted, labels=LABELS).tolist(),
        "bootstrap_macro_f1": interval, "bootstrap_macro_f1_difference": difference,
    }


def run_review_study(frame: pd.DataFrame, source: dict, *, bootstrap_replicates: int = 200) -> dict:
    """Run frozen candidates, validation-only selection and retrospective tests."""
    train, validation, test = chronological_split(frame)
    for partition in (train, validation, test):
        partition["normalized"] = partition["text"].map(normalize_review_text)
    models = fit_candidates(train)
    majority_label = max(LABELS, key=lambda label: int(train["label"].eq(label).sum()))
    candidates = [{
        "id": "majority", "name": "Training-majority rating-group baseline",
        "definition": {"strategy": "most_frequent", "training_majority_label": majority_label},
        "validation": metrics(validation["label"].to_numpy(), np.full(len(validation), majority_label, dtype=object)),
    }]
    for specification in CANDIDATES:
        identifier = specification["id"]
        definition = {**specification["definition"], "min_df": 2, "sublinear_tf": True,
                      "strip_accents": "unicode", "C": 1.0, "class_weight": "balanced", "max_iter": 500,
                      "random_seed": SEED, "actual_vocabulary_size": len(models[identifier].named_steps["tfidf"].vocabulary_)}
        candidates.append({"id": identifier, "name": specification["name"], "definition": definition,
                           "validation": metrics(validation["label"].to_numpy(), models[identifier].predict(validation["text"]))})
    # A tie follows declared candidate order. The baseline is a reference, not a
    # text-representation candidate; it remains visible even if it is strongest.
    selected = max(candidates[1:], key=lambda item: item["validation"]["macro_f1"])
    train_texts = set(train["normalized"])
    earlier_texts = train_texts | set(validation["normalized"])
    test_seen_before = test["normalized"].isin(earlier_texts)
    novel = test.loc[~test_seen_before].copy()
    evaluations = {"test": _evaluate(test, models[selected["id"]], majority_label, bootstrap_replicates),
                   "novel_text_test": _evaluate(novel, models[selected["id"]], majority_label, bootstrap_replicates)}
    distributions = {}
    for name, partition in [("train", train), ("validation", validation), ("test", test)]:
        distributions[name] = {"rows": len(partition), "start": partition["available_at"].min().isoformat(),
                               "end": partition["available_at"].max().isoformat(),
                               "class_counts": {label: int(partition["label"].eq(label).sum()) for label in LABELS}}
    training_conflicts = train.groupby("normalized")["label"].nunique().gt(1)
    conflicting_groups = set(training_conflicts.loc[training_conflicts].index)
    fingerprint = hashlib.sha256()
    for row in pd.concat([train, validation, test]).itertuples(index=False):
        fingerprint.update(json.dumps([row.available_at.isoformat(), row.text, row.label], ensure_ascii=False, separators=(",", ":")).encode())
        fingerprint.update(b"\n")
    test_result = evaluations["test"]
    novel_result = evaluations["novel_text_test"]
    weakest = min(test_result["per_class"], key=lambda row: row["f1"])
    findings = [
        f"Validation selected {selected['name']} (macro-F1 {selected['validation']['macro_f1']:.4f}) from two fixed text representations.",
        f"On all {len(test):,} final-period reviews, selected-model macro-F1 was {test_result['metrics']['macro_f1']:.4f}; training-majority baseline {test_result['baseline_metrics']['macro_f1']:.4f}.",
        f"{int(test_seen_before.sum()):,} final-period reviews ({float(test_seen_before.mean()):.1%}) repeated normalized wording from training or validation.",
        f"The weakest final-period class was {weakest['label']} (F1 {weakest['f1']:.4f}, support {weakest['support']:,}).",
    ]
    if len(novel):
        findings.append(f"After excluding wording seen in earlier partitions, {len(novel):,} reviews remained; macro-F1 was {novel_result['metrics']['macro_f1']:.4f}, versus baseline {novel_result['baseline_metrics']['macro_f1']:.4f}.")
    result = {
        "schema_version": 1, "title": "Review classification under repeated wording",
        "question": "Does rating-group classification remain useful when repeated wording is excluded?",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {**source, "dataset": "Olist historical Portuguese review comments", "source_url": SOURCE_URL,
                   "license": "CC BY-NC-SA 4.0", "data_fingerprint_sha256": fingerprint.hexdigest()},
        "protocol": {
            "retrospective": True, "seed": SEED, "input": "review_comment_message only",
            "target": "rating 1–2 negative; rating 3 neutral; rating 4–5 positive",
            "selection_rule": "Maximum validation macro-F1 among the two predeclared text representations; ties follow declaration order. Majority remains an independent reference. No test-driven selection or tuning.",
            "fit_rule": "Vocabulary, IDF, classifier and majority class fitted on the earliest training partition only. No train+validation refit.",
            "time_rule": "First approximately 60% training, next 20% validation, final 20% test by review-answer timestamp; equal timestamps stay together.",
            "normalization": NORMALIZATION,
            "test_status": "The broader Olist cohort and its final period were inspected in an earlier published benchmark. This is a retrospective diagnostic, not a pristine unseen confirmatory test.",
        },
        "labels": LABELS, "split": distributions, "candidates": candidates,
        "selected_model": {"id": selected["id"], "name": selected["name"], "selection_reason": "Highest validation macro-F1 among the predeclared learned candidates."},
        "evaluations": evaluations,
        "confusion_matrix_axes": "Rows: actual; columns: predicted. Both use labels order.",
        "duplicates": {
            "normalization": NORMALIZATION,
            "validation_seen_train_rows": int(validation["normalized"].isin(train_texts).sum()),
            "test_seen_before_rows": int(test_seen_before.sum()), "test_seen_before_fraction": float(test_seen_before.mean()),
            "within_test_repeated_rows": int(len(test) - test["normalized"].nunique()),
            "train_conflicting_label_groups": len(conflicting_groups),
            "train_rows_in_conflicting_label_groups": int(train["normalized"].isin(conflicting_groups).sum()),
            "novel_text_test_rows": len(novel),
        },
        "findings": findings,
        "limitations": [
            "Retrospective diagnostic: the dataset and final period were already inspected in the earlier public benchmark; this is not untouched evidence of improvement.",
            "Ratings are proxy target groups, not independently annotated sentiment. Identical wording can legitimately have conflicting ratings.",
            "The novel-text subset excludes exact normalized wording seen earlier; it does not remove paraphrases, near duplicates, shared authors or seller effects.",
            "The subset changes the case mix. Its score is a robustness diagnostic, not an unbiased estimate of all future reviews or a causal measure of memorization.",
            "Bootstrap intervals resample normalized-text groups and do not account for temporal drift, label uncertainty, model selection or transfer to other marketplaces.",
            "Two feature sets and fixed classifier settings were selected for a bounded educational ablation. Word/character vocabulary budgets differ; this is not a controlled comparison at equal representation size.",
            "Only earliest answered reviews with eligible comments enter the cohort. Source timezone and ingestion delays are not established.",
            "No raw text, customer/order identifiers or trained vocabulary are included in the public study artifact. This is an offline study; the site displays recorded results.",
        ],
        "environment": {"python": platform.python_version(), "packages": {name: importlib.metadata.version(name) for name in ["numpy", "pandas", "scikit-learn"]}},
    }
    json.dumps(result, ensure_ascii=False, allow_nan=False)
    return result


def build_review_study(zip_path: Path, *, bootstrap_replicates: int = 200) -> dict:
    frame, filtering = _read_reviews(Path(zip_path))
    return run_review_study(frame, {"archive_sha256": filtering["archive_sha256"], "filtering": filtering}, bootstrap_replicates=bootstrap_replicates)
