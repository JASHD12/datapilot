# DataPilot

A reusable workbench for data exploration, evaluated machine learning and answers with visible evidence. Built by Jashdeep Singh.

[Live Olist demo](https://jashdeep-datapilot.generousegret2.chatgpt.site) · [Source repository](https://github.com/JASHD12/datapilot) · [Implementation](docs/ARCHITECTURE.md) · [Real-data benchmark](docs/BENCHMARKS.md) · [Deployment](docs/DEPLOYMENT.md)

The public workspace uses **real historical Olist data**: delivery models on 96,470 eligible delivered orders, a separate all-status order-count forecast, and text analysis of 40,423 reviews. Visitors can train a small comparison, enter an order for live browser inference, search source evidence and generate a combined report without an API key. Full-data evaluations are saved offline results; arbitrary CSV uploads and full-data training run in the local Python application. The synthetic fixture remains available for local testing.

**Run sample comparison** performs genuine browser training on 1,600 historical orders and evaluates on 400 later orders. It compares median/majority baselines, ridge/logistic regression and a 24-tree random forest in a background worker. These sample metrics are displayed separately from the recorded full-data benchmark. Public targets are fixed to delivery duration and late delivery; arbitrary target selection remains a local workflow.

The public report is deterministic and source-linked. It does not call an LLM or claim to implement generative RAG. The optional provider integration remains separate from the public no-API-bill demo.

## Run locally

Requires Python 3.11 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
datapilot serve
```

For the exact development dependency versions, use `pip install -r requirements.lock` followed by `pip install --no-deps -e .`. The lock records the Python 3.12 environment used for the initial verification; the declared package range supports Python 3.11 and newer.

Open http://127.0.0.1:8000. API documentation: http://127.0.0.1:8000/docs.

```bash
pytest
python scripts/build_demo.py
python scripts/build_public.py --check
node scripts/test_browser_training.mjs
```

Optional LangChain/LangGraph and model-provider integration:

```bash
pip install -e '.[ai]'
export DATAPILOT_ENABLE_LLM=1
export DATAPILOT_MODEL='openai:your-model-name'
export OPENAI_API_KEY='your-own-key'
datapilot serve
```

Provider calls may incur charges and send selected evidence to the configured provider. No provider calls occur in the default mode. The `.env.example` file documents variables; environment files are not loaded automatically.

## Product

Explore a dataset, compare classification and regression models, inspect temporal validation, forecast order volumes, examine operational segments, retrieve document passages and ask evidence-based questions. Every model run records the selected inputs, data fingerprint, split, metrics and limitations. A project page showcases only DataPilot.

The assistant uses deterministic numerical tools and lexical document retrieval. The public browser search uses ranked lexical matching with a small documented English/Portuguese keyword expansion; the Python retrieval baseline uses TF-IDF. Optional LLM generation and LangGraph orchestration are separate capabilities; installing an extra does not mean those capabilities are active.

See `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/DATA_CARD.md` and `docs/CV.md` for the implementation boundary and planned extensions.

## Real public data

Download the [official Olist archive](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce), then prepare a local CSV:

```bash
python scripts/import_olist.py --zip /path/to/brazilian-ecommerce.zip --max-rows 10000
```

Upload the generated `data/raw/olist_orders.csv` to the local workbench. The adapter aggregates items before joining, preserves source metadata and outcome availability timestamps, and does not invent missing geographic information. A sample's daily counts are sample counts, not total marketplace demand. The complete delivered-order cohort may exceed the browser's 8 MB CSV upload limit; use the adapter directly for full-data experiments.

The source archive was verified locally: 99,441 source orders yield 96,470 delivered orders after status/date filtering. Raw records and prepared CSVs are not included in this repository. Code is MIT licensed; public datasets retain their own licenses and attribution requirements.

The [first full-cohort benchmark](docs/BENCHMARKS.md) is also recorded: the fixed learned models do not yet establish an improvement over simple baselines. In particular, the median duration baseline beats both learned regressors. Those failures are published to guide the next validation and feature-engineering experiments.

Build the complete public example from the source archive:

```bash
python scripts/build_public.py --zip /path/to/brazilian-ecommerce.zip
python scripts/build_browser_sample.py --zip /path/to/brazilian-ecommerce.zip
```

The seven connected demo capabilities are late-delivery classification, delivery-duration regression, historical order-count forecasting, exploratory order-profile segmentation, Portuguese review rating-group analysis, source-evidence investigation, and a downloadable combined report. Segments describe order profiles, not validated seller rankings. Review ratings are proxy labels, not independent sentiment annotations.

The Olist-derived public artifact is shared under CC BY-NC-SA 4.0 with publisher attribution. The application code is MIT licensed.

## Why this project

AI analyst platforms already exist. DataPilot is a portfolio implementation focused on reproducibility: baseline comparisons, explicit feature exclusions, training-label availability cutoffs, data fingerprints, source excerpts and visible limitations. It does not claim to be the first or only application of its kind.

