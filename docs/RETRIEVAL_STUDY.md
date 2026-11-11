# Measured multilingual retrieval study

This extension compares a transparent lexical baseline, actual pretrained multilingual embeddings and reciprocal-rank fusion over the **same 94 source passages**. It adds an opt-in local browser encoder as well as a saved, reproducible evaluation. It performs retrieval; it does not generate an LLM answer.

## Corpus and judgments

The existing public Olist workspace supplies 135 chunks: method/workspace notes and bounded Portuguese review excerpts. Exact wording is deduplicated after case, accent and punctuation normalization, retaining the first source. This yields 94 passages. No raw customer archive, new private data or invented operations policy is added.

The [question manifest](../data/evaluation/retrieval_questions.json) contains **40 questions forming 20 English/Portuguese category pairs**. Eight authored category IDs are development-only (16 questions); twelve are test-only (24 questions). The test has 14 answerable and 10 unanswerable questions. These are 20 paired categories, not 40 independent samples. Category-ID disjointness does not establish semantic independence: policy and private/current-information themes can still be related across splits.

**Questions and binary relevance judgments are AI-assisted seed annotations, not independently human-validated labels.** They are public so a reviewer can audit each query, relevant source ID and justification. Small corpus coverage and annotation choices constrain every score below. A question about a real return policy is unanswerable even if a customer review asks for a refund; that review does not establish an actual company policy.

Benchmark version **1.1** records a source-fidelity audit. A second agent reviewed wording without consulting model scores, qualifying nonreceipt as a statement at review-writing time and changing a regression question to concepts explicitly supported by its passage. No relevance IDs, models, development questions or threshold-selection rule changed. The versioned manifest records the prior fingerprint and this correction after initial scoring. These test questions are withheld from threshold fitting, not a pristine external research test.

## Fixed retrieval methods

| Method | Definition |
|---|---|
| Lexical | Unigram TF-IDF; lowercase and accent normalization, sublinear term frequency, smoothed IDF, L2 cosine; no translation/synonym expansion |
| Dense | Quantized multilingual E5-small; `query:` / `passage:` prefixes, attention-masked mean pooling and L2 cosine |
| Hybrid | Reciprocal-rank fusion with fixed `k=60`; top 20 positive lexical matches and top 20 dense results |

The lexical baseline is deliberately explicit and shared between Python and JavaScript. It is **not identical** to the earlier workbench's keyword-expanded browser search or the local bigram TF-IDF document retriever. This study compares its three declared methods, not every existing search implementation.

All three configurations were declared before scoring and are reported. None is selected or promoted using the test result. Abstention thresholds maximize balanced answerability accuracy on development questions only; ties choose the larger, more conservative threshold. These thresholds are heuristics on a tiny development set, not calibrated probabilities. Cosine, TF-IDF and RRF scores have different scales.

## Recorded test results

Ranking metrics below average over the **14 answerable test questions**. Recall@3 divides retrieved relevant sources by all judged-relevant sources for each question; it is distinct from finding any relevant passage.

| Method | Recall@3 | MRR@3 | nDCG@3 | Any relevant source in top 3 |
|---|---:|---:|---:|---:|
| TF-IDF | 0.4405 | 0.5000 | 0.4943 | 0.5000 |
| E5 dense | 0.5714 | 0.5714 | 0.5714 | 0.5714 |
| RRF hybrid | 0.5079 | 0.5357 | 0.5283 | 0.5714 |

| Method | Dev-selected threshold | Test coverage | Unanswerable abstention | Accepted retrieval success |
|---|---:|---:|---:|---:|
| TF-IDF | 0.224684 | 0.7917 | 0.2000 | 0.2632 |
| E5 dense | 0.841958 | 0.4583 | 0.9000 | 0.5455 |
| RRF hybrid | 0.023709 | 1.0000 | 0.0000 | 0.3333 |

Coverage is the fraction of all 24 test questions accepted. Unanswerable abstention is the fraction of the ten unanswerable questions rejected. Accepted retrieval success means an accepted answerable question has a judged-relevant passage in its top three; it does **not** assess generated-answer factuality.

Dense retrieval modestly improves aggregate ranking on this seed benchmark and rejects more unsupported questions, while also rejecting some answerable queries. It is not uniformly better: English answerable MRR@3 changes from 0.7143 to 0.8571, while Portuguese remains 0.2857 for both TF-IDF and dense retrieval. Each language has only seven answerable test questions.

Hybrid search does not inherit the stronger abstention behavior. Its threshold accepts every test question, including every unanswerable one. RRF rank scores are not reliable evidence of answerability here. This failure is retained in the interface and artifact. No method demonstrates dependable production answers, general multilingual quality or business impact.

The [saved artifact](../frontend/retrieval-study.json) includes every case, ranking, threshold decision, passage, embedding, corpus/question fingerprint and model-file SHA-256. Cases remain inspectable without downloading a model.

## Encoder and browser parity

The base model is [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small), revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`, whose model card declares MIT. The [Xenova ONNX export](https://huggingface.co/Xenova/multilingual-e5-small), revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, points to that base model. Both runtimes use its same `onnx/model_quantized.onnx`, 384 dimensions and 512-token truncation.

Local measurements use ONNX Runtime **1.31.1**, tokenizers **0.23.3**, NumPy **2.5.4** and Python **3.12.14**. Each query is encoded alone, matching live browser use. Model/tokenizer files must match the recorded SHA-256 checksums. No downloaded Python code is executed.

Browser encoding uses pinned [Transformers.js 3.8.1](https://huggingface.co/docs/transformers.js/v3.8.1/en/index), q8 weights and WASM in a dedicated Web Worker. First use explicitly downloads approximately **136 MB** of tokenizer/model data plus runtime files from Hugging Face/jsDelivr. It may be slow or unavailable on constrained devices or networks. No model downloads on ordinary page load. Queries are tokenized and encoded on the visitor's device, without an inference-provider request or API key. Device compute and internet bandwidth are still needed.

Browser verification found identical token IDs but a cosine agreement of approximately 0.99374 between the first native-CPU and WASM q8 probe. The two runtime outputs were not numerically identical; the precise kernel-level cause was not isolated. Quantized computation has numerical limitations; see [ONNX Runtime's quantization documentation](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html).

The loader now checks **three public English/Portuguese probes**, requiring exact token IDs and cosine agreement of at least 0.99 for each. That tolerance is a compatibility heuristic, not a retrieval-quality guarantee. It then **re-encodes all 94 passages in the browser** so live corpus and query representations use the same runtime. Finally, it encodes the 16 development questions on the device and applies the same predeclared threshold-selection rule. No test question enters browser threshold selection.

The tables above remain measurements of the declared native-CPU pipeline. Live browser scores, rankings and thresholds can differ. The interface exposes the runtime compatibility checks and development thresholds, and retains conservative false-negative behavior rather than promising every answerable query will be accepted. Cancellation terminates the worker; failure leaves the saved study and ordinary evidence search available. The model is not uploaded to Pages.

## Reproduce

From the repository root:

```bash
pip install -e '.[dev,semantic]'
python scripts/benchmark_retrieval.py --download-model
pytest tests/test_retrieval_study.py
node scripts/test_semantic_search.mjs
```

The first command with `--download-model` downloads the pinned public model to ignored `.datapilot/models/multilingual-e5-small/`. Subsequent runs can omit that flag. To use an existing immutable model directory, supply `--model-dir /path/to/model`.

The script does not call a paid model provider. Dependencies and the initial model download need network access; inference/evaluation use local CPU. Original Olist-derived excerpts remain CC BY-NC-SA 4.0 with attribution; application code and authored method documents retain their own license. Model weights are governed by their publisher's terms and are not committed to this repository.

## Next evidence to collect

Have the project owner independently review and correct the seed judgments, expand them with realistic questions written before inspecting rankings, and evaluate a new frozen set. Diagnose Portuguese-language failures and RRF false acceptance before changing fusion or thresholds. Evaluate any future generation separately for source support and refusal behavior; citation presence alone does not establish factuality.
