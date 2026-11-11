# Public deployment with no model API bill

The public demo uses `frontend/olist-snapshot.json`: real historical Olist evaluation results, a small source-evidence corpus and exported numeric model coefficients. Predictions, evidence search and report composition execute in the visitor's browser. There is no paid model provider, server-side training endpoint, shared API key or uploaded customer data in this deployment.

The hosted demo is https://jashdeep-datapilot.generousegret2.chatgpt.site . Site access is public for unauthenticated visitors. The account's Sites availability and terms remain separate from the application; this repository does not promise unlimited or perpetual free hosting.

## Build

Download the official Olist archive separately, retain its attribution, and run:

```bash
pip install -e '.[dev]'
python scripts/build_public.py --zip /path/to/brazilian-ecommerce.zip
python scripts/build_public.py --check
```

The build retrains fixed experiments and regenerates aggregate artifacts. It does not read `.datapilot/` or publish a locally uploaded workspace. To package the checked-in public artifact without raw data:

```bash
python scripts/build_public.py --package-only
```

Deploy the resulting `dist/` directory as static files. No Python host is required for this public version. Model retraining and arbitrary CSV uploads remain local workflows; they are not silently simulated in the browser.

## Free static-hosting options

- **GitHub Pages:** available for public repositories on GitHub Free. It serves HTML/CSS/JavaScript, which is sufficient for this browser demo. See [GitHub's current documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
- **Cloudflare Pages:** its documentation states that static-asset requests are free and unlimited; Functions have separate usage limits. This demo needs no Functions. See [Cloudflare pricing](https://developers.cloudflare.com/pages/functions/pricing/).

Use the host's normal deployment setup for `dist/`. A custom domain is optional and may have a separate registration cost. No paid plan or custom domain was purchased for this project. The GitHub account's existing Actions billing lock can prevent GitHub CI/deploy jobs from starting; it does not prevent manual source publication or the existing Sites deployment.

## Runtime boundaries

The public delivery score is uncalibrated and measured on an old delivered-order cohort. Duration regression is illustrative and its median baseline performs better in the recorded holdout. Historical order forecasts are precomputed; they do not forecast today's business. Review groups use recorded star ratings as proxy labels. Review retrieval plus deterministic reporting is the retrieval/evidence layer of RAG; generative LLM answers are not enabled on the public site.

## Dataset terms

Olist's publisher metadata identifies the dataset license as **CC BY-NC-SA 4.0**. Preserve attribution and the noncommercial/share-alike terms for derived data artifacts. The code remains MIT licensed. `frontend/olist-snapshot.json` and its Olist-derived data/model artifacts are shared under CC BY-NC-SA 4.0; authored application code is separate. No affiliation or endorsement is implied.

