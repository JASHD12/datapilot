# Architecture and implementation boundary

DataPilot has two deliberately different execution modes.

**Local application:** FastAPI serves a vanilla JavaScript frontend and runs pandas/scikit-learn workflows. A single local workspace accepts CSV uploads and text-based TXT/Markdown/PDF documents. Source CSVs remain in process memory; local documents and append-only SQLite experiment metadata live in ignored `.datapilot/` storage. This is a single-user application bound to loopback, not a multi-tenant production service.

**Public Olist workspace:** the interface reads `frontend/olist-snapshot.json`. It contains real measured offline experiments, bounded source excerpts and exported logistic/ridge coefficients. New order predictions, ranked evidence search and report composition run in the visitor's browser. Arbitrary data uploads and model training remain local-only. No Python server or model provider runs on the static host. The separate `demo-snapshot.json` is a synthetic fallback used for testing.

Delivery models and segmentation use a delivered-order cohort. Forecasting counts every recorded order status in a separately declared historical window. Review classification uses nonempty Portuguese comments, recorded rating-group targets and review answer timestamps. These populations are explicitly different; the application does not merge them into a single denominator.

```mermaid
flowchart LR
  CSV[CSV or synthetic fixture] --> V[Validation and profile]
  V --> M[Classification and regression]
  V --> F[Forecast and segments]
  M --> R[Metrics and run provenance]
  F --> R
  DOC[Documents] --> K[TF-IDF lexical retrieval]
  R --> A[Bounded evidence workflow]
  K --> A
  A --> UI[Workbench and one-project portfolio]
```

Models compare predeclared baselines and estimators on a chronological holdout when `purchase_date` exists; generic CSVs without that column use an explicitly labeled random holdout. Learned preprocessing fits training rows only. Delivery outcomes, review fields, identifiers and dates are excluded from order-time predictors. When supplied, `outcome_available_date` also purges training labels unavailable at the cutoff.

Column-name gates cannot establish information availability for arbitrary datasets. Users must define their prediction time and input semantics. Forecast evaluation is rolling one-day prediction; the displayed 14-day recursive forecast is a separate artifact and its long-horizon interval coverage is not validated.

The assistant's default is deterministic. If LangGraph is installed, it runs plan, retrieve, compose and validate nodes with bounded control flow. LangChain provider synthesis is opt-in, limited to documentary answers, and has not been verified against a paid provider in the bundled demo. Citation-index checks do not establish claim entailment. TF-IDF is a lexical baseline, not dense embeddings, hybrid retrieval or a neural reranker.

Security scope: no arbitrary Python execution, no generated SQL execution, bounded uploads, no secrets in frontend assets. Keep the Python API local until authentication, quotas, workspace isolation and background job controls are implemented. The Docker Compose port is loopback-only.

