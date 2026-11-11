# Roadmap

## Initial implementation

- CSV profiling and validated local uploads.
- Binary classification: majority baseline, logistic regression, random forest.
- Regression: median baseline, ridge, random forest.
- Temporal holdouts and training-label availability checks.
- Daily-count forecasting: lag-7 baseline and lag-feature ridge; exploratory bands.
- K-means profiles and Isolation Forest unusual-record scores.
- Document chunking, lexical retrieval, source excerpts and deterministic evidence reports.
- Optional LangGraph orchestration and explicitly configured LangChain provider synthesis.
- Append-only experiment records with data fingerprints.
- Local API, project page, replay snapshot, Docker configuration and CI tests.
- Real Olist adapter and full delivered-cohort baseline comparison, including unsuccessful learned-model results.

## Next milestones

1. Improve the recorded Olist benchmark using a separate validation period, better order-time features and imbalance-aware analysis; preserve a locked test period for future claims.
2. Dense embeddings, hybrid search and reranking evaluated against the lexical baseline on human-checked questions.
3. Hyperparameter search using training/validation only, followed by one locked test.
4. Exportable trained pipelines and validated record-level prediction endpoints.
5. Review-text classification: TF-IDF baseline versus a fine-tuned multilingual transformer.
6. MLflow experiment integration, drift analysis and monitoring beyond the existing local run log.
7. Recommendation experiments on a suitable repeated-interaction dataset, evaluated chronologically.
8. OCR, document extraction, multimodal search and MCP tools with independent benchmarks.

Optional dependencies, planned capabilities and configuration files are not evidence that an integration has been exercised. Record the actual experiment, data source, evaluation, failure cases and cost before making a resume claim.

