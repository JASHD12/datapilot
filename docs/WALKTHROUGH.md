# Technical walkthrough and practice guide

This guide is for understanding, reproducing and extending DataPilot. Completing the exercises is evidence you can discuss in an interview; the presence of this guide does not establish that you have completed them.

## A five-minute demonstration

1. Open the [public workspace](https://jashdeep-datapilot.pages.dev). Explain the Olist source, its historical period and its separate order/review populations.
2. In **Models**, run a delivery-duration sample comparison. Identify the 1,600 training orders and 400 later test orders. Explain that these JavaScript models train on the visitor's device, while the full-cohort tables are saved Python evaluations.
3. Open the research studies. Compare the review classifier's ordinary test results with its previously unseen-wording subset. Explain the split, model-selection rule, class imbalance and duplicate-text audit before discussing the score.
4. Inspect the retrieval benchmark. Follow one question to its relevance labels and ranked passages, including a failure or an unanswerable question. Explain that the initial relevance labels were authored with AI assistance and need independent human review.
5. Demonstrate source search, then generate an evidence report. Identify the original passage behind a claim. The default report composes supplied evidence; it is not generative LLM inference.

## Follow one request through the code

| Step | Implementation | What to explain |
|---|---|---|
| Load a local workspace | `src/datapilot/api.py` | FastAPI routes, single-user state and bounded uploads |
| Prepare historical orders | `src/datapilot/olist.py` | Aggregate before joining; distinguish order-time features from outcomes |
| Fit a baseline comparison | `src/datapilot/ml.py` | Chronology, label availability and train-only preprocessing |
| Classify review rating groups | `src/datapilot/reviews.py` | Text input, rating proxies and the original saved comparison |
| Audit the deeper text experiment | `src/datapilot/review_study.py` | Validation-only selection, per-class errors and duplicate robustness |
| Evaluate retrieval | `src/datapilot/retrieval_study.py` | Dense representations, lexical matching, fusion and relevance metrics |
| Train the public numeric sample | `frontend/browser-training.js` | Background workers, reproducible fitting and bounded input sizes |
| Render a result | `frontend/app.js` | Public artifacts, local API calls, loading states and failure handling |

The public host serves files. It runs no Python training service and embeds no model-provider API key. Optional browser semantic search downloads a pretrained encoder and computes query representations on the visitor's device. The saved retrieval evaluation and a live query are distinct operations.

## Reproduce the checks

From a fresh checkout, create a Python virtual environment, then install the documented dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
pytest
node scripts/test_browser_training.mjs
python scripts/build_public.py --check
python scripts/build_browser_sample.py --check
```

Download the official Olist archive separately and preserve its license. Use the commands in [the review study](REVIEW_STUDY.md) and [the retrieval study](RETRIEVAL_STUDY.md) to reproduce the new experiments. The semantic study needs its optional dependencies and an initial model download; neither experiment requires a paid inference API. Record the model revision, input fingerprint and configuration with your results.

Local check results and GitHub Actions status are separate evidence. The repository's existing GitHub account billing issue can stop remote jobs before they run; a locally passing test suite is not a passing remote CI run.

## Questions to practise answering

- **Why can high classification accuracy be useless?** The majority prediction can miss every rare late delivery. Explain precision, recall, macro-F1 and the operating threshold using the actual confusion matrix.
- **Why does the median beat the delivery regressors?** This is an observed result with a restricted feature set and temporal shift. Explain what the measured errors establish, then propose a validation experiment. Model complexity alone does not establish an improvement.
- **Where can future information enter training?** Discuss outcome availability, text vocabulary fitting, joins and feature timestamps. Name the checks that enforce the declared boundaries and the assumptions those checks cannot prove.
- **What does the duplicate-text subset test?** It checks whether the selected model transfers to normalized wording absent from its fitting and selection data. It does not establish performance on another company or language.
- **What makes a retrieval result relevant?** Show the labeled question, document IDs and source passage. Distinguish Recall@k, reciprocal rank, nDCG and abstention from answer correctness.
- **Why can semantic search fail?** Short ambiguous passages, domain mismatch, cross-language wording and missing facts can all produce misleading neighbors. Show an actual recorded failure.
- **What remains outside the deployment?** Arbitrary uploaded workspaces, full-data Python training, multi-user isolation, generative LLM evaluation and production monitoring require separate implementation or evaluation.

## Make and explain one change yourself

Choose an exercise, write a short rationale before editing, and retain both the initial and changed result.

1. Add a regression test for an input boundary or a leakage scenario. Demonstrate that it fails for the faulty behavior and passes after the fix.
2. Audit five retrieval relevance labels against their source passages. Record your judgments and reasons; keep the original seed labels so the review is traceable. Publish revised metrics with the reviewed benchmark version.
3. Propose one text-model change using training/validation data. Write the selection rule before evaluating the final period. If the published test period has already informed your decisions, label the new result exploratory and obtain a separate future evaluation before claiming confirmation.
4. Trace one incorrect review prediction through its true class, predicted class and cohort. Explain how rating proxies or conflicting labels limit what a text model can learn.

Use a short experiment note: **question → data available at the decision time → baseline → validation rule → result → failure cases → next decision**. Keep unsuccessful experiments. Any CV claim should correspond to code you can explain, a result you can reproduce and work you actually performed.
