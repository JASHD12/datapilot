# Real-data delivery benchmark

Measured on **11 November 2026** using the full eligible delivered-order cohort from the [Olist public dataset](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce). These are historical offline results, not production results or customer savings. No raw dataset is committed to this repository.

The first benchmark identifies a useful failure: **the fixed random forest does not outperform the simpler baselines on this holdout**. It remains the predeclared demonstration model; these results do not justify promoting it to a production model. The synthetic demonstration is useful for checking the workflow but cannot substitute for these real-data measurements.

## Data and evaluation

| Item | Value |
|---|---|
| Raw unique orders | 99,441 |
| Eligible delivered orders | 96,470; no sampling |
| Exclusions | 2,963 non-delivered orders; 8 orders with missing or invalid dates |
| Purchase period | 2016-09-15 to 2018-08-29 |
| Training candidates before label purge | 77,176 |
| Labels unavailable at cutoff | 2,048; excluded from training |
| Final training rows | 75,128 |
| Final holdout rows | 19,294 |
| Holdout starts at source clock time | 2018-05-26 18:18:03 |
| Latest training purchase | 2018-05-24 18:56:59 |
| Latest available training outcome | 2018-05-26 18:12:42 |
| Fixed seed | 42 |

The source contains naive timestamps. The adapter does not establish their geographical timezone. The model splitter applies a common UTC tag for comparisons, which must not be interpreted as verified source UTC times. Relative source-clock ordering is used consistently.

Each delivered order contributes one row. Item prices and freight are summed before joining order outcomes, avoiding duplicated orders from one-to-many joins. Prices remain source BRL. Classification predicts delivery on a later **calendar date** than the promised date; delivery during the promised date is on time. Regression predicts elapsed delivery duration in days.

Inputs for both tasks are `order_value`, `freight_value`, `promised_days` and `items_count`. `category` is excluded by the current workbench's greater-than-30-level categorical guard; `seller_id` and `order_id` are excluded as identifiers. Actual delivery duration, late-delivery outcome and review ratings are never input features. Dates are reserved for validation. Imputation, scaling and encoding are fitted on training rows only.

Models and hyperparameters were fixed before this evaluation. The final chronological holdout was not used for tuning or selection. Training includes only earlier purchases whose recorded delivery outcomes became available strictly before the cutoff; labels available exactly at the cutoff are also excluded.

## Late-delivery classification

Positive class: `1` means late delivery. Precision, recall and F1 use a fixed 0.5 probability threshold. This is an imbalanced task; accuracy alone is misleading.

| Fixed model | Accuracy | Precision | Recall | F1 | ROC-AUC |
|---|---:|---:|---:|---:|---:|
| Majority baseline | 0.965067 | 0.000000 | 0.000000 | 0.000000 | 0.500000 |
| Logistic regression, balanced class weights | 0.415621 | 0.049851 | 0.870920 | 0.094305 | 0.686119 |
| Random forest, balanced subsample weights | 0.655489 | 0.026929 | 0.252226 | 0.048662 | 0.479192 |

The majority baseline obtains high accuracy while identifying no late deliveries. Logistic regression has the strongest ROC-AUC in this fixed comparison, but its low precision means many false alerts at the chosen threshold. The random forest's ROC-AUC is below 0.5 on this holdout. No model here establishes an operationally useful alert policy. Threshold or feature changes require a separate validation protocol and a new untouched test period.

## Delivery-duration regression

MAE and RMSE are measured in days. Lower is better; negative R-squared indicates worse squared-error performance than a constant prediction using the holdout mean, which is a descriptive reference rather than a deployable baseline.

| Fixed model | MAE, days | RMSE, days | R-squared |
|---|---:|---:|---:|
| Training-median baseline | 4.888074 | 6.328205 | -0.150309 |
| Ridge regression | 5.093787 | 6.726001 | -0.299473 |
| Random forest | 5.025754 | 6.697709 | -0.288564 |

The training-median baseline beats both learned regressors on MAE and RMSE. Adding a more complex estimator has not improved this first real-data result. A sensible next experiment would examine temporal shifts, geographically meaningful inputs and seller history available at prediction time, with feature engineering and tuning restricted to training/validation periods.

## Reproduce

Download the publisher's ZIP separately, install the project, then run:

```bash
python scripts/benchmark_olist.py --zip /path/to/brazilian-ecommerce.zip
```

The script writes full configuration, provenance, model definitions, metrics and timings to the ignored `artifacts/olist-benchmark.json`. It makes no network or LLM-provider request. The published tables above correspond to archive SHA-256:

```text
967e41e04fc306fe604e2a693f488995a8b41e5047418f8a5c8e4abd6deca784
```

Environment: Python 3.12.14, NumPy 2.5.4, pandas 3.1.1, scikit-learn 1.9.1, macOS arm64. Archive loading took 7.286 seconds, classification 4.344 seconds and regression 6.791 seconds on this execution environment. Timings are a local observation, not a throughput guarantee. Recorded generation time: 2026-11-11T15:10:35Z.

## Limits

- The cohort includes only delivered orders. Canceled and undelivered orders are excluded, introducing survivorship bias. The model does not estimate outcomes for the full incoming-order population.
- Estimated delivery dates have no version history. Treating the recorded promise as available at purchase time is an assumption.
- Actual delivery time is used as label availability time. Reporting or ingestion delay is not modeled; a faithful operational reconstruction would need those timestamps.
- Source timezone and daylight-saving interpretation have not been established.
- The small permitted feature set omits location, distance and seller history. Neither unavailable fields nor synthetic substitutes were added.
- This single chronological split does not establish robustness across periods, regions or other businesses. Repeated validation windows and another untouched period are needed for future experiments.
- Review text, clustering quality, retrieval quality and forecasting are separate tasks and are not evaluated by these supervised-model scores. No forecast over the delivered-only cohort is presented as total demand.
- These public historical records are governed by the publisher's dataset terms separately from the repository's code license. Check the source license before redistributing data or derived datasets.

Suitable CV claim today: **implemented and reproduced a chronological real-data benchmark with baseline comparisons, unavailable-label purging and explicit failure analysis**. Do not claim improved delivery accuracy or business impact from this result.
