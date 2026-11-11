# CV wording

Project: **DataPilot — AI Analytics and Machine Learning Workbench**

Repository: https://github.com/JASHD12/datapilot

Live project: https://jashdeep-datapilot.pages.dev

Accurate v0.3 wording; use claims you can explain and reproduce:

- Built a Python/FastAPI workbench for CSV profiling, classification, regression, forecasting and exploratory segmentation, with a browser interface and reproducible demo.
- Implemented chronological model evaluation with train-only preprocessing, unavailable-label purging and baseline comparisons on a 96,470-order historical Olist cohort.
- Audited Portuguese review rating-group classification using validation-selected word/character TF-IDF, per-class error analysis and duplicate-text robustness; recorded macro-F1 0.6475 versus a 0.2605 majority baseline on 6,548 later reviews with previously unseen normalized wording.
- Built multilingual lexical, E5 dense and reciprocal-rank-fusion retrieval over 94 source passages; published a 40-question bilingual seed evaluation and deployed optional browser ONNX inference with runtime checks and source-linked results.

The review study is retrospective, uses recorded ratings as target proxies, and does not establish improvement over the original review model or another marketplace. The retrieval questions form 20 bilingual category pairs; their AI-assisted relevance labels have not been independently human-validated. No production business impact or generative-answer quality was measured.

Do not describe the default evidence report as an LLM, lexical retrieval as semantic search, synthetic scores as real-world results, or recorded full-data benchmarks as freshly trained public results. Browser sample training and opt-in live semantic retrieval are separate, bounded capabilities. See [the technical walkthrough](WALKTHROUGH.md) for practice questions and concrete independent exercises.

