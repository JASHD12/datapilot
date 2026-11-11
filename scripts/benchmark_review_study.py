"""Reproduce the retrospective review representation and duplicate audit."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from datapilot.review_study import build_review_study


def report(study: dict) -> str:
    selected = study["selected_model"]["name"]
    lines = [
        "# Review classification under repeated wording", "",
        "Question: **Does rating-group classification remain useful when repeated wording is excluded?**", "",
        "This is a **retrospective diagnostic**. The broader Olist cohort and final period were inspected in the earlier public benchmark. The new code withholds the final period from fitting and selection, but that does not make it pristine unseen research evidence. The original benchmark is unchanged.", "",
        "## Protocol", "",
        "The earliest answered eligible comment per order is retained. Rating 1–2 defines negative, 3 neutral, and 4–5 positive. These are rating proxies, not independently annotated sentiment. Only Portuguese comment text is a classifier input.", "",
        study["protocol"]["time_rule"], "", study["protocol"]["fit_rule"], "",
        study["protocol"]["selection_rule"], "",
        "Candidate definitions are fixed in `src/datapilot/review_study.py`: word TF-IDF (1–2 grams, 5,000 features) versus character-boundary TF-IDF (3–5 grams, 20,000 features), both with `min_df=2`, sublinear TF, accent stripping and balanced logistic regression (`C=1`, `max_iter=500`, seed 42). Different vocabulary budgets are a limitation of this bounded ablation.", "",
        "| Partition | Rows | Answer-time start | Answer-time end | Negative / neutral / positive |",
        "|---|---:|---|---|---|",
    ]
    for name, partition in study["split"].items():
        counts = " / ".join(f"{partition['class_counts'][label]:,}" for label in study["labels"])
        lines.append(f"| {name} | {partition['rows']:,} | {partition['start']} | {partition['end']} | {counts} |")
    lines.extend(["", "## Validation-only model selection", "", "| Candidate | Validation accuracy | Validation macro-F1 |", "|---|---:|---:|"])
    for candidate in study["candidates"]:
        lines.append(f"| {candidate['name']} | {candidate['validation']['accuracy']:.4f} | {candidate['validation']['macro_f1']:.4f} |")
    learned = [candidate for candidate in study["candidates"] if candidate["id"] != "majority"]
    validation_gap = max(candidate["validation"]["macro_f1"] for candidate in learned) - min(candidate["validation"]["macro_f1"] for candidate in learned)
    lines.extend(["", f"Selected text representation: **{selected}**. No test results were used to change this choice. The training-majority baseline is reported independently.", "", f"The validation macro-F1 gap between the two learned candidates is only **{validation_gap:.4f}** on one period. This is enough to apply the predeclared selection rule, but is limited evidence of general superiority. Repeated validation windows would be needed before preferring a representation broadly.", "", "## Final-period diagnostic", "", "| Cohort | Rows | Selected macro-F1 | Majority macro-F1 | Selected accuracy | Cluster-bootstrap 95% interval |", "|---|---:|---:|---:|---:|---|"])
    for key, name in [("test", "All final-period reviews"), ("novel_text_test", "Wording not seen in earlier partitions")]:
        evaluation = study["evaluations"][key]
        if evaluation["rows"]:
            interval = evaluation["bootstrap_macro_f1"]
            lines.append(f"| {name} | {evaluation['rows']:,} | {evaluation['metrics']['macro_f1']:.4f} | {evaluation['baseline_metrics']['macro_f1']:.4f} | {evaluation['metrics']['accuracy']:.4f} | {interval['lower']:.4f}–{interval['upper']:.4f} |")
    duplicate = study["duplicates"]
    lines.extend(["", f"The [earlier public review artifact](../frontend/olist-snapshot.json) reports word TF-IDF macro-F1 **0.6558**, trained on 32,338 reviews. This study's selected-model score of **{study['evaluations']['test']['metrics']['macro_f1']:.4f}**, trained on {study['split']['train']['rows']:,} reviews, **does not establish an improvement over that result**. The training sizes and selection protocols differ; the original result is preserved rather than replaced.", "", f"**{duplicate['test_seen_before_rows']:,} test reviews ({duplicate['test_seen_before_fraction']:.1%}) repeat normalized wording from training or validation.** The robustness subset removes those reviews. Normalization: {duplicate['normalization']}", "", f"The training partition contains {duplicate['train_conflicting_label_groups']:,} normalized-wording groups with conflicting rating labels, covering {duplicate['train_rows_in_conflicting_label_groups']:,} reviews. This documents ambiguity in the proxy target; it is not proof of label error.", "", "The two cohorts have different case mixes. A score difference is a useful diagnostic, not a causal estimate of memorization. Scores on the novel-wording subset cannot be advertised as overall future performance.", "", "## Per-class errors", ""])
    for key, name in [("test", "All final-period reviews"), ("novel_text_test", "Previously unseen normalized wording")]:
        evaluation = study["evaluations"][key]
        lines.extend([f"### {name}", "", "| Rating group | Precision | Recall | F1 | Support |", "|---|---:|---:|---:|---:|"])
        for row in evaluation["per_class"]:
            lines.append(f"| {row['label']} | {row['precision']:.4f} | {row['recall']:.4f} | {row['f1']:.4f} | {row['support']:,} |")
        lines.extend(["", "Confusion matrix: rows are actual, columns predicted; order is negative, neutral, positive.", "", "```text"])
        for row in evaluation["confusion_matrix"]:
            lines.append(" ".join(f"{value:5d}" for value in row))
        lines.extend(["```", ""])
    neutral = next(row for row in study["evaluations"]["test"]["per_class"] if row["label"] == "neutral")
    lines.extend(["## Uncertainty and interpretation", "", "The 95% percentile intervals use 200 bootstrap replicates with seed 42, resampling normalized-text groups so repeated wording remains together. The artifact also records paired intervals for the model-minus-majority macro-F1 difference. These are exploratory intervals assuming exchangeable groups; they do not account for temporal drift, label uncertainty, candidate selection or another marketplace.", "", *[f"- {finding}" for finding in study["findings"]], "", f"The next modeling decision should address neutral-rating errors: final-period neutral precision is {neutral['precision']:.4f}, recall {neutral['recall']:.4f} and F1 {neutral['f1']:.4f}. Privately review a bounded error sample and conflicting-rating wording, clarify whether the desired target is star-rating group or independently annotated sentiment, then define repeated temporal validation before changing the model. The current study supports an educational rating-group classifier; it does not validate automated customer-treatment decisions.", "", "## Reproduce", "", "```bash", "python scripts/benchmark_review_study.py --zip /path/to/brazilian-ecommerce.zip", "```", "", "This writes aggregate results to `frontend/review-study.json` and regenerates this document. The script does not call a network service, LLM or GPU. Raw comments, IDs, classifier vocabulary and fitted model weights are not published.", "", f"Source: [Olist public dataset]({study['source']['source_url']}). Derived aggregate artifact: **CC BY-NC-SA 4.0**. Application code: MIT. Archive SHA-256: `{study['source']['archive_sha256']}`. Data fingerprint SHA-256: `{study['source']['data_fingerprint_sha256']}`.", "", "Environment: " + study["environment"]["python"] + "; " + ", ".join(f"{name} {version}" for name, version in study["environment"]["packages"].items()) + ".", "", "## Limits", "", *[f"- {limitation}" for limitation in study["limitations"]], ""])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("frontend/review-study.json"))
    parser.add_argument("--report", type=Path, default=Path("docs/REVIEW_STUDY.md"))
    args = parser.parse_args()
    study = build_review_study(args.zip)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(study, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(report(study), encoding="utf-8")
    print(json.dumps({"selected_model": study["selected_model"], "split": study["split"],
                      "metrics": {name: value["metrics"] for name, value in study["evaluations"].items()},
                      "duplicate_audit": study["duplicates"], "artifact": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
