# Review classification under repeated wording

Question: **Does rating-group classification remain useful when repeated wording is excluded?**

This is a **retrospective diagnostic**. The broader Olist cohort and final period were inspected in the earlier public benchmark. The new code withholds the final period from fitting and selection, but that does not make it pristine unseen research evidence. The original benchmark is unchanged.

## Protocol

The earliest answered eligible comment per order is retained. Rating 1–2 defines negative, 3 neutral, and 4–5 positive. These are rating proxies, not independently annotated sentiment. Only Portuguese comment text is a classifier input.

First approximately 60% training, next 20% validation, final 20% test by review-answer timestamp; equal timestamps stay together.

Vocabulary, IDF, classifier and majority class fitted on the earliest training partition only. No train+validation refit.

Maximum validation macro-F1 among the two predeclared text representations; ties follow declaration order. Majority remains an independent reference. No test-driven selection or tuning.

Candidate definitions are fixed in `src/datapilot/review_study.py`: word TF-IDF (1–2 grams, 5,000 features) versus character-boundary TF-IDF (3–5 grams, 20,000 features), both with `min_df=2`, sublinear TF, accent stripping and balanced logistic regression (`C=1`, `max_iter=500`, seed 42). Different vocabulary budgets are a limitation of this bounded ablation.

| Partition | Rows | Answer-time start | Answer-time end | Negative / neutral / positive |
|---|---:|---|---|---|
| train | 24,253 | 2016-10-07T18:32:28 | 2018-03-18T10:39:35 | 6,368 / 2,143 / 15,742 |
| validation | 8,085 | 2018-03-18T10:40:25 | 2018-06-06T20:22:46 | 2,578 / 697 / 4,810 |
| test | 8,085 | 2018-06-06T20:34:38 | 2018-10-24T21:34:38 | 1,855 / 669 / 5,561 |

## Validation-only model selection

| Candidate | Validation accuracy | Validation macro-F1 |
|---|---:|---:|
| Training-majority rating-group baseline | 0.5949 | 0.2487 |
| Word TF-IDF + logistic regression | 0.7832 | 0.6670 |
| Character TF-IDF + logistic regression | 0.7884 | 0.6693 |

Selected text representation: **Character TF-IDF + logistic regression**. No test results were used to change this choice. The training-majority baseline is reported independently.

The validation macro-F1 gap between the two learned candidates is only **0.0024** on one period. This is enough to apply the predeclared selection rule, but is limited evidence of general superiority. Repeated validation windows would be needed before preferring a representation broadly.

## Final-period diagnostic

| Cohort | Rows | Selected macro-F1 | Majority macro-F1 | Selected accuracy | Cluster-bootstrap 95% interval |
|---|---:|---:|---:|---:|---|
| All final-period reviews | 8,085 | 0.6533 | 0.2717 | 0.7880 | 0.6411–0.6638 |
| Wording not seen in earlier partitions | 6,548 | 0.6475 | 0.2605 | 0.7625 | 0.6340–0.6622 |

The [earlier public review artifact](../frontend/olist-snapshot.json) reports word TF-IDF macro-F1 **0.6558**, trained on 32,338 reviews. This study's selected-model score of **0.6533**, trained on 24,253 reviews, **does not establish an improvement over that result**. The training sizes and selection protocols differ; the original result is preserved rather than replaced.

**1,537 test reviews (19.0%) repeat normalized wording from training or validation.** The robustness subset removes those reviews. Normalization: Unicode NFKD casefold, remove accent marks, retain alphanumeric tokens and collapse punctuation/whitespace. Exact equality after this transform only; near-duplicate and paraphrase detection is not performed.

The training partition contains 135 normalized-wording groups with conflicting rating labels, covering 2,816 reviews. This documents ambiguity in the proxy target; it is not proof of label error.

The two cohorts have different case mixes. A score difference is a useful diagnostic, not a causal estimate of memorization. Scores on the novel-wording subset cannot be advertised as overall future performance.

## Per-class errors

### All final-period reviews

| Rating group | Precision | Recall | F1 | Support |
|---|---:|---:|---:|---:|
| negative | 0.7559 | 0.7811 | 0.7683 | 1,855 |
| neutral | 0.2226 | 0.4589 | 0.2998 | 669 |
| positive | 0.9637 | 0.8299 | 0.8918 | 5,561 |

Confusion matrix: rows are actual, columns predicted; order is negative, neutral, positive.

```text
 1449   359    47
  235   307   127
  233   713  4615
```

### Previously unseen normalized wording

| Rating group | Precision | Recall | F1 | Support |
|---|---:|---:|---:|---:|
| negative | 0.7504 | 0.7736 | 0.7618 | 1,749 |
| neutral | 0.2272 | 0.4775 | 0.3079 | 599 |
| positive | 0.9621 | 0.7986 | 0.8728 | 4,200 |

Confusion matrix: rows are actual, columns predicted; order is negative, neutral, positive.

```text
 1353   354    42
  223   286    90
  227   619  3354
```

## Uncertainty and interpretation

The 95% percentile intervals use 200 bootstrap replicates with seed 42, resampling normalized-text groups so repeated wording remains together. The artifact also records paired intervals for the model-minus-majority macro-F1 difference. These are exploratory intervals assuming exchangeable groups; they do not account for temporal drift, label uncertainty, candidate selection or another marketplace.

- Validation selected Character TF-IDF + logistic regression (macro-F1 0.6693) from two fixed text representations.
- On all 8,085 final-period reviews, selected-model macro-F1 was 0.6533; training-majority baseline 0.2717.
- 1,537 final-period reviews (19.0%) repeated normalized wording from training or validation.
- The weakest final-period class was neutral (F1 0.2998, support 669).
- After excluding wording seen in earlier partitions, 6,548 reviews remained; macro-F1 was 0.6475, versus baseline 0.2605.

The next modeling decision should address neutral-rating errors: final-period neutral precision is 0.2226, recall 0.4589 and F1 0.2998. Privately review a bounded error sample and conflicting-rating wording, clarify whether the desired target is star-rating group or independently annotated sentiment, then define repeated temporal validation before changing the model. The current study supports an educational rating-group classifier; it does not validate automated customer-treatment decisions.

## Reproduce

```bash
python scripts/benchmark_review_study.py --zip /path/to/brazilian-ecommerce.zip
```

This writes aggregate results to `frontend/review-study.json` and regenerates this document. The script does not call a network service, LLM or GPU. Raw comments, IDs, classifier vocabulary and fitted model weights are not published.

Source: [Olist public dataset](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce). Derived aggregate artifact: **CC BY-NC-SA 4.0**. Application code: MIT. Archive SHA-256: `967e41e04fc306fe604e2a693f488995a8b41e5047418f8a5c8e4abd6deca784`. Data fingerprint SHA-256: `d56dcc7884f2385ff055fd4ce8584d10242ca3aa43e0a0245de35f55571442b7`.

Environment: 3.12.14; numpy 2.5.4, pandas 3.1.1, scikit-learn 1.9.1.

## Limits

- Retrospective diagnostic: the dataset and final period were already inspected in the earlier public benchmark; this is not untouched evidence of improvement.
- Ratings are proxy target groups, not independently annotated sentiment. Identical wording can legitimately have conflicting ratings.
- The novel-text subset excludes exact normalized wording seen earlier; it does not remove paraphrases, near duplicates, shared authors or seller effects.
- The subset changes the case mix. Its score is a robustness diagnostic, not an unbiased estimate of all future reviews or a causal measure of memorization.
- Bootstrap intervals resample normalized-text groups and do not account for temporal drift, label uncertainty, model selection or transfer to other marketplaces.
- Two feature sets and fixed classifier settings were selected for a bounded educational ablation. Word/character vocabulary budgets differ; this is not a controlled comparison at equal representation size.
- Only earliest answered reviews with eligible comments enter the cohort. Source timezone and ingestion delays are not established.
- No raw text, customer/order identifiers or trained vocabulary are included in the public study artifact. This is an offline study; the site displays recorded results.
