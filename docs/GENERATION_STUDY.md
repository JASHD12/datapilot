# Grounded LLM generation: evidence, refusals and failures

DataPilot runs **Llama 3.1 8B Instruct (FP8 Fast)** through a Cloudflare Workers AI binding. The public Research view exposes saved raw answers and offers an opt-in live question form. This is actual pretrained transformer inference and RAG integration, not training or fine-tuning an LLM.

## Experiment

Executed on 12 November 2026 against the preview deployment recorded in `frontend/generation-study.json`. There are 12 AI-authored seed questions: four development cases and eight test cases, with disjoint question categories. The project owner reviewed all question labels and source matches in `GENERATION_REVIEW.md`, replying “checked”. This is an owner-reported review, not independent expert annotation. **Generated answers have not been human-reviewed.** The review record is bound to the manifest and corpus fingerprints; answer-quality scores remain null.

Each question has two actual model calls:

1. **Plain:** the question with a short-answer instruction, without source evidence.
2. **Grounded:** frozen lexical top-three retrieval over the 94 public passages, the existing retrieval study's development-selected threshold, and a prompt requiring citations or `INSUFFICIENT_EVIDENCE`.
3. **Grounded + validation:** reuses the exact grounded output and withholds drafts with invalid labels, uncited sentences, malformed output or a detected token-limit stop. This is postprocessing, not a third model call.

Thus 24 model calls produce 36 recorded conditions. The two prompts differ in instructions as well as evidence, so this comparison does not isolate retrieval's causal contribution. No model, prompt, source or threshold changes were made between the hosted development and test batches. The test set is now inspected; future tuning needs a new evaluation set.

The fixed request uses `max_tokens=128`, `temperature=0`, `seed=42` and `stream=false`. Questions are limited to 1,000 characters and each source excerpt to 1,000 characters. The hosted model alias has no immutable provider weight revision. A fixed seed does not guarantee identical future outputs.

## Recorded results

| Grounded-generation measure | Development | Test |
|---|---:|---:|
| Questions | 4 | 8 |
| Answerable questions receiving a draft | 1 / 2 | 4 / 5 |
| Unsupported questions returning the exact refusal marker | 2 / 2 | 3 / 3 |
| Drafts with invalid citation labels | 0 / 4 | 0 / 8 |
| Median AI binding latency | 170.5 ms | 283.5 ms |

The citation gate did not change any grounded decision in this run. Its implementation and negative tests demonstrate a formatting boundary, not a measured factuality improvement. Citation-error denominators include refusals, which contain no claims; the test set contains only four substantive grounded answers.

The plain baseline's test median binding latency was 458 ms. Treat this as descriptive: answer lengths and prompts differ, there are only eight requests, and there is no repeated timing or load experiment. The artifact separately preserves client request time. Cloudflare's clock can return zero for short synchronous stages; this does not imply zero CPU work.

Refusal metrics count the exact protocol marker or a validation block. They do **not** semantically recognize natural-language refusals. For example, a plain answer saying it cannot access live parcel information is not counted by that marker-based metric. Inspect raw text; do not turn these rates into a claim that the baseline never refuses.

## Visible failures and limitations

- The development licence question received `INSUFFICIENT_EVIDENCE` despite a retrieved passage explaining that the code licence does not replace the dataset licence.
- The test cohort-generalization question was also falsely refused. Its source explains that delivered-order results exclude canceled and undelivered orders.
- All four accepted test drafts have syntactically valid citations. Whether each claim is supported, complete and correctly phrased still requires human review. In particular, inspect the review-selection answer's causal wording.
- The plain baseline includes unsupported statements and a truncated invented-contact example. These remain available as unverified raw outputs, not presented as factual project answers.
- Three unsupported test cases are insufficient evidence of general prompt-injection resistance. The public corpus is small, selected and not an independent company document collection.
- Only lexical retrieval is used in this generation experiment. The separate E5 dense/hybrid study does not establish those retrievers' end-to-end generation quality.

Earlier development-only local ONNX trials with SmolLM2 360M and Qwen2.5 0.5B/1.5B produced unreliable, uncited or truncated outputs. Their actual outputs and metadata are preserved in `data/evaluation/generation_development_pilots.json`. No test questions were run in those trials. The archived pilot prompt files are not included, so that record is not a fully replayable local-model bundle. These failures motivated hosted inference; they are not silently excluded from the development history.

## Reproduce and inspect

Offline checks need Python's project dependencies and Node 20+; the generation tooling has no npm dependencies:

```bash
python scripts/build_generation.py --check
python scripts/check_research.py
node scripts/test_generation.mjs --require-artifact
```

To rerun the measured protocol against a deployment you control, use its immutable preview URL and retain its Workers Free plan or explicitly manage your own provider budget. Calls consume its shared allowance:

```bash
node scripts/benchmark_generation.mjs --endpoint https://YOUR-PREVIEW.pages.dev --split dev --output artifacts/generation-dev.json
# Inspect development, freeze the protocol, then run test once.
node scripts/benchmark_generation.mjs --endpoint https://YOUR-PREVIEW.pages.dev --split test --output artifacts/generation-test.json
node scripts/benchmark_generation.mjs --merge artifacts/generation-dev.json,artifacts/generation-test.json --output artifacts/generation-runs.json
python scripts/build_generation.py
```

The runner rejects mismatched retrieved evidence, prompts, checks or model metadata. It records HTTP failures separately and stops instead of counting service failures as safe model refusals. Source and protocol hashes prevent silently combining different experiments. The public artifact contains all inputs/outputs needed for offline integrity checks; the ignored raw run files are only needed to rebuild from new calls.

For manual answer review, follow `scripts/review_generation.py --help` and `GENERATION_REVIEW.md`. Reviewing the questions does not authorize answer judgments. Keep pending, uncertain and corrected judgments explicit.

## Deployment and cost

The Pages Function embeds the public corpus and exposes only bounded generation and health routes. No provider credential is sent to visitors. Generating sends the question to Cloudflare, as disclosed beside the form; use public, nonsensitive questions.

On 12 November 2026 the account dashboard showed **Workers Free active** and no payment method. Workers AI includes 10,000 neurons per day; on Free, requests fail after the allowance is exhausted. Paid plans have different overage behavior. This is limited free availability, not unlimited inference or a permanent pricing guarantee. See [Cloudflare's pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [Pages AI bindings](https://developers.cloudflare.com/pages/functions/bindings/#workers-ai). Stay on Free to retain its hard spending boundary. Saved results and ordinary static tools remain readable when live generation is unavailable.
