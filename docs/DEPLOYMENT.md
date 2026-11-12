# Public deployment on Cloudflare Pages

Primary demo: [DataPilot](https://jashdeep-datapilot.pages.dev). The Cloudflare Pages project `jashdeep-datapilot` serves the packaged `dist/` directory through Direct Upload. No Python host is required. The optional live generation workflow uses a bounded Pages Function and Workers AI; the remaining tools and saved studies are static/browser features.

The public demo uses `frontend/olist-snapshot.json`: real historical Olist evaluation results, a small source-evidence corpus and exported numeric model coefficients. Predictions, evidence search and report composition execute in the visitor's browser. `frontend/olist-training-sample.json` additionally supports genuine browser training on 1,600 orders with a separate 400-order holdout. There is no server-side training endpoint, shared API key in the browser or uploaded customer data in this deployment.

The Research view also serves `review-study.json`, `retrieval-study.json` and `semantic-search.js`. The saved studies need no model download. Explicitly loading live semantic search downloads approximately 136 MB of pinned model/tokenizer data plus the runtime from Hugging Face/jsDelivr; query encoding runs in a browser worker. Those weights are not stored on Pages. Internet access, third-party availability and sufficient device memory are required, and this semantic-search feature invokes no inference API or Cloudflare Function. Hosted generation is a separate opt-in feature.

Direct Upload does not automatically deploy GitHub commits. Rebuild and upload `dist/` whenever public frontend files or artifacts change. The GitHub account's existing Actions billing lock can prevent GitHub CI/deploy jobs from starting; it does not prevent Cloudflare Pages Direct Upload.

## Build

Download the official Olist archive separately, retain its attribution, and run:

```bash
pip install -e '.[dev]'
python scripts/build_public.py --zip /path/to/brazilian-ecommerce.zip
python scripts/build_browser_sample.py --zip /path/to/brazilian-ecommerce.zip
python scripts/build_public.py --check
python scripts/build_browser_sample.py --check
python scripts/check_research.py
```

The build retrains fixed experiments and regenerates aggregate artifacts. It does not read `.datapilot/` or publish a locally uploaded workspace. To package the checked-in public artifact without raw data:

```bash
python scripts/build_public.py --package-only
```

The deeper review and retrieval experiments have separate reproduction commands in [REVIEW_STUDY.md](REVIEW_STUDY.md) and [RETRIEVAL_STUDY.md](RETRIEVAL_STUDY.md). Their corpus/source fingerprints must match the public workspace before packaging. Run `python scripts/check_research.py` to recompute report metrics from recorded confusion matrices and judged rankings without downloading raw data or model weights.

After both artifacts are built, run `python scripts/build_public.py --package-only`, then build the generation worker with `node scripts/build_generation_worker.mjs dist` and deploy the static files plus `_worker.js` and `_routes.json`. No Python host is required. The comparison worker genuinely fits small models in the visitor's browser; full-data retraining and arbitrary CSV uploads remain local workflows. The sample and full-data metrics are intentionally separate.

The browser comparison supports only the two fixed Olist targets. Numeric median imputation and scaling fit training rows only; sample selection preserves the original temporal boundary and label-availability purge. Worker time and input sizes are capped, failures restore the button, and navigation stays usable. The sample's classification holdout has only 11 late orders, so classification metrics are especially uncertain. These JavaScript estimators have their own declared parameters and are not presented as identical to scikit-learn's full-data models.

## Update the Pages deployment

For a manual update without installing Wrangler or the Cloudflare CLI:

1. Run the artifact checks above, then `python scripts/build_public.py --package-only`.
2. In the Cloudflare dashboard, open **Workers & Pages** and select the existing `jashdeep-datapilot` Pages project.
3. Run `node scripts/build_generation_worker.mjs dist`. Configure the Pages environment AI binding named `AI`, then upload the assets with the generated `_worker.js` and `_routes.json` using a deployment route that supports advanced-mode Functions (Pages API or Wrangler). A plain static-only upload omits live generation. Test a preview first.
4. Deploy, then check `/api/generation-health`, an actual generation and unsupported-question refusal, the public workspace, source evidence and **Run sample comparison** at the primary URL before sharing the updated version.

See [Cloudflare's Direct Upload documentation](https://developers.cloudflare.com/pages/get-started/direct-upload/). The same static files can also be uploaded through the Pages API: create an account-scoped project once, upload the asset contents, then create a production deployment with its file manifest. Authentication belongs in the host's consent flow or a protected credential store; never commit access tokens to this repository.

## Hosting costs and terms

- **GitHub Pages:** available for public repositories on GitHub Free. It serves HTML/CSS/JavaScript, which is sufficient for this browser demo. See [GitHub's current documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
- **Cloudflare Pages:** its documentation states that static-asset requests are free and unlimited; Functions have separate usage limits. The generation routes use Functions; static routes bypass them. See [Cloudflare pricing](https://developers.cloudflare.com/pages/functions/pricing/).

No paid plan or custom domain was purchased for this project. A custom domain is optional and may have a separate registration cost. Hosting availability, quotas and terms remain controlled by the provider; this repository does not promise perpetual free hosting. Optional model-provider calls in the local application have separate costs. Hosted public generation uses Workers AI and its shared daily Free allowance.

## Runtime boundaries

The public delivery score is uncalibrated and measured on an old delivered-order cohort. Duration regression is illustrative and its median baseline performs better in the recorded holdout. Historical order forecasts are precomputed; they do not forecast today's business. Review groups use recorded star ratings as proxy labels. The separate Research generation workflow supplies retrieved public excerpts to a hosted LLM. It has an actual evaluation artifact, but citation-format checks do not establish factual correctness.

## Dataset terms

Olist's publisher metadata identifies the dataset license as **CC BY-NC-SA 4.0**. Preserve attribution and the noncommercial/share-alike terms for derived data artifacts. The code remains MIT licensed. `frontend/olist-snapshot.json` and its Olist-derived data/model artifacts are shared under CC BY-NC-SA 4.0; authored application code is separate. No affiliation or endorsement is implied.


## Hosted generation configuration

The existing Pages project uses an AI binding named `AI`. The API shape is `deployment_configs: {production: {ai_bindings: {AI: {}}}}` (and separately `preview` for preview deployments); this empty binding object matches Cloudflare's current Wrangler SDK. It does not require an invented project ID. Preserve other existing settings when adding the binding. The generated `_routes.json` includes only `/api/generate` and `/api/generation-health`; static content should remain outside Function quotas.

The preview and production environments have separate bindings. API deployments submit `_worker.js` with MIME `application/javascript+module`, `_routes.json`, and the public asset manifest. Never upload private `.datapilot/` state or model caches. Use structured runtime events for troubleshooting; this portfolio does not have persistent production tracing or a monitoring service.

Workers Free and no payment method were verified in the account dashboard on 12 November 2026. Keep Workers Free: its AI allowance is 10,000 neurons per day, shared across visitors and account uses, and requests fail after the allowance is exhausted. Upgrading to Paid changes overage behavior. No paid plan was purchased. See [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [the generation study](GENERATION_STUDY.md).
