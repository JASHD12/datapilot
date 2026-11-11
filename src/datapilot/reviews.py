"""Historical Olist review-rating prediction and bounded source evidence.

Ratings define the target groups; they are not independently annotated sentiment
labels. Review text is Portuguese source material, not a translation. The module
never uses ratings, order outcomes, or future vocabulary as classifier inputs.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path
from zipfile import BadZipFile, ZipFile

import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from sklearn.pipeline import Pipeline

SOURCE_URL = "https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce"
LABELS = ["negative", "neutral", "positive"]
MAX_REVIEW_BYTES = 100 * 1024 * 1024
_THEMES = [
    ("Delivery delays", r"\b(?:atras\w*|demor\w*|prazo)\b"),
    ("Item not received", r"\b(?:nao recebi|nao chegou|nao foi entregue|nunca recebi|nao entreg\w*)\b"),
    ("Product condition or function", r"\b(?:defeit\w*|quebrad\w*|danific\w*|nao funciona|estragad\w*)\b"),
    ("Different or incorrect item", r"\b(?:errad\w*|diferente|trocad\w*)\b"),
    ("Incomplete order", r"\b(?:falt\w*|incomplet\w*)\b"),
    ("Service or communication", r"\b(?:atendimento|contato|resposta|respond\w*|telefone|email)\b"),
]


def _normalize(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))


def redact_review(text: str, max_chars: int = 240) -> str:
    """Remove recognizable contact/identifier patterns from a bounded excerpt.

    This is a conservative pattern filter, not a general anonymization guarantee.
    Published excerpts are additionally selected from repeated short phrases and
    reject address/contact language; user/order identifiers are never exported.
    """
    text = re.sub(r"https?://\S+|www\.\S+", "[link removed]", str(text), flags=re.I)
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email removed]", text)
    text = re.sub(r"(?<!\w)(?:\+?\d[\s()./-]*){6,}(?!\w)", "[number removed]", text)
    text = re.sub(r"\b[0-9a-f]{20,}\b", "[identifier removed]", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()[:max_chars]


def _read_reviews(zip_path: Path) -> tuple[pd.DataFrame, dict]:
    path = Path(zip_path)
    if not path.is_file():
        raise ValueError("Provide the downloaded public Olist ZIP archive.")
    try:
        with ZipFile(path) as archive:
            info = archive.getinfo("olist_order_reviews_dataset.csv")
            if info.file_size > MAX_REVIEW_BYTES:
                raise ValueError("Review CSV exceeds the 100 MiB input limit.")
            with archive.open(info) as stream:
                frame = pd.read_csv(stream)
    except (BadZipFile, KeyError, pd.errors.ParserError, UnicodeDecodeError) as exc:
        raise ValueError("Unable to read the Olist review CSV from that archive.") from exc
    needed = {"order_id", "review_score", "review_comment_message", "review_answer_timestamp"}
    if not needed.issubset(frame):
        raise ValueError("The review CSV lacks required rating, text, order or answer-time columns.")
    raw_rows = len(frame)
    frame["available_at"] = pd.to_datetime(frame["review_answer_timestamp"], errors="coerce", format="mixed")
    valid_time = frame["available_at"].notna() & frame["order_id"].notna()
    missing_time = int((~valid_time).sum())
    frame = frame.loc[valid_time].sort_values(["available_at", "order_id"], kind="stable")
    before_dedup = len(frame)
    frame = frame.drop_duplicates("order_id", keep="first").copy()
    duplicate_reviews = before_dedup - len(frame)
    ratings = pd.to_numeric(frame["review_score"], errors="coerce")
    valid_rating = ratings.isin([1, 2, 3, 4, 5])
    missing_rating = int((~valid_rating).sum())
    frame = frame.loc[valid_rating].copy()
    frame["rating"] = ratings.loc[valid_rating].astype(int)
    frame["text"] = frame["review_comment_message"].fillna("").astype(str).str.strip()
    has_text = frame["text"].str.contains(r"[A-Za-zÀ-ÖØ-öø-ÿ]", regex=True) & frame["text"].str.len().ge(3)
    missing_text = int((~has_text).sum())
    frame = frame.loc[has_text].copy().reset_index(drop=True)
    frame["label"] = np.where(frame["rating"] <= 2, "negative", np.where(frame["rating"] == 3, "neutral", "positive"))
    metadata = {"archive_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "raw_reviews": raw_rows, "missing_order_or_answer_time": missing_time,
                "duplicate_order_reviews_removed": int(duplicate_reviews),
                "invalid_rating_rows": missing_rating, "empty_or_nontext_rows": missing_text,
                "deduplication": "Earliest answered review per order, before excluding missing comment text.",
                "timestamp": "review_answer_timestamp; source timezone not established"}
    return frame, metadata


def _public_examples(frame: pd.DataFrame, holdout: pd.DataFrame, model: Pipeline) -> list[dict]:
    # Repeated compact phrases provide useful review evidence while excluding
    # rare, detailed narratives most likely to contain personal information.
    normalized = frame["text"].map(_normalize).str.replace(r"\s+", " ", regex=True).str.strip()
    frequency = normalized.value_counts()
    candidates = holdout.copy()
    candidates["normalized"] = candidates["text"].map(_normalize).str.replace(r"\s+", " ", regex=True).str.strip()
    candidates["frequency"] = candidates["normalized"].map(frequency).fillna(0)
    candidates = candidates.loc[candidates["text"].str.len().between(3, 180) & candidates["frequency"].ge(3)]
    # Contact/address language, long identifiers and atypical symbols are not
    # included in the published corpus even if a pattern could be redacted.
    blocked = (r"\b(?:rua|avenida|endereco|cep|cpf|cnpj|telefone|celular|whatsapp|email|"
               r"meu nome|nome completo|me chamo|apartamento)\b|@|https?://|\d{4,}")
    candidates = candidates.loc[~candidates["normalized"].str.contains(blocked, regex=True)]
    selected = []
    for label in LABELS:
        group = candidates.loc[candidates["label"].eq(label)].sort_values(
            ["frequency", "available_at"], ascending=[False, True], kind="stable").drop_duplicates("normalized").head(50)
        for _, row in group.iterrows():
            text = redact_review(row["text"])
            date = row["available_at"].strftime("%Y-%m-%d")
            identifier = hashlib.sha256(f"{label}:{date}:{text}".encode()).hexdigest()[:16]
            selected.append({"id": f"review-{identifier}", "text": text, "rating": int(row["rating"]),
                             "label": label, "predicted": str(model.predict([row["text"]])[0]), "date": date})
    return selected


def build_review_analysis(zip_path: Path) -> dict:
    """Fit and evaluate rating-group prediction; return safe bounded artifacts."""
    frame, filtering = _read_reviews(zip_path)
    if len(frame) < 60:
        raise ValueError("Review evaluation requires at least 60 valid text reviews.")
    cutoff = frame["available_at"].iloc[min(int(len(frame) * 0.8), len(frame) - 1)]
    train = frame.loc[frame["available_at"] < cutoff].copy()
    test = frame.loc[frame["available_at"] >= cutoff].copy()
    if len(train) < 40 or len(test) < 10 or set(train["label"]) != set(LABELS):
        raise ValueError("Need chronological training examples from all three rating groups and a later holdout.")
    vectorizer = TfidfVectorizer(lowercase=True, strip_accents="unicode", ngram_range=(1, 2),
                                 sublinear_tf=True, min_df=2, max_features=5000)
    learned = Pipeline([("tfidf", vectorizer), ("model", LogisticRegression(
        C=1.0, class_weight="balanced", max_iter=500, random_state=42))])
    learned.fit(train["text"], train["label"])
    baseline = DummyClassifier(strategy="most_frequent").fit(np.zeros((len(train), 1)), train["label"])
    predictions = learned.predict(test["text"])
    baseline_predictions = baseline.predict(np.zeros((len(test), 1)))
    models = []
    for name, predicted in [("Majority rating-group baseline", baseline_predictions), ("TF-IDF + logistic regression", predictions)]:
        models.append({"name": name, "metrics": {"accuracy": float(accuracy_score(test["label"], predicted)),
                        "macro_f1": float(f1_score(test["label"], predicted, labels=LABELS, average="macro", zero_division=0)),
                        "weighted_f1": float(f1_score(test["label"], predicted, labels=LABELS, average="weighted", zero_division=0))}})
    negative = frame.loc[frame["label"].eq("negative"), "text"].map(_normalize)
    themes = [{"theme": name, "count": int(negative.str.contains(pattern, regex=True).sum())}
              for name, pattern in _THEMES]
    examples = _public_examples(frame, test, learned)
    chunks = [{"id": example["id"], "title": "Olist customer review (Portuguese)",
               "source": "Olist public review dataset", "section": f"{example['date']} · rating {example['rating']}/5",
               "text": example["text"], "rating": example["rating"], "label": example["label"],
               "source_url": SOURCE_URL, "language": "Portuguese"} for example in examples]
    analysis = {"source": {"kind": "public", "label": "Olist review comments", "source_url": SOURCE_URL,
                          "language": "Portuguese", "license": "CC BY-NC-SA 4.0",
                          "archive_sha256": filtering["archive_sha256"], "filtering": filtering},
                "rows": filtering["raw_reviews"], "labeled_rows": len(frame), "train_rows": len(train), "test_rows": len(test),
                "labels": LABELS, "class_counts": {label: int(frame["label"].eq(label).sum()) for label in LABELS},
                "split": {"method": "chronological review-answer holdout", "cutoff": cutoff.isoformat(),
                          "train_end": train["available_at"].max().isoformat(), "test_start": test["available_at"].min().isoformat(),
                          "preprocessing": "Vocabulary and IDF fitted on training review text only."},
                "models": models, "selected_model": "TF-IDF + logistic regression",
                "selection_method": "Predeclared text baseline; no holdout-driven tuning.",
                "model_definition": {"text_input": "review_comment_message only", "max_features": 5000,
                                     "ngrams": [1, 2], "min_df": 2, "C": 1.0, "class_weight": "balanced", "random_seed": 42,
                                     "actual_vocabulary_size": len(vectorizer.vocabulary_)},
                "confusion_matrix": confusion_matrix(test["label"], predictions, labels=LABELS).tolist(),
                "confusion_matrix_axes": "Rows are actual labels, columns predicted labels, in labels order.",
                "complaint_themes": themes, "complaint_scope_rows": len(negative),
                "examples": examples[:18], "public_excerpt_count": len(chunks),
                "limitations": [
                    "Targets are rating groups (1–2 negative, 3 neutral, 4–5 positive), not independently annotated sentiment.",
                    "Identical wording can carry different ratings, so a positive-sounding phrase may appear in a low-rating group.",
                    "Review text is Portuguese source material. No translation or universal multilingual accuracy is claimed.",
                    "Only earliest answered reviews with nonempty comments enter evaluation; text reviewers may differ from all customers.",
                    "Common wording may repeat across train and holdout. The model has not been evaluated on a different marketplace.",
                    "Complaint themes use overlapping keyword rules on low-rating comments; they are descriptive matches, not validated topic labels or causal findings.",
                    "Published excerpts are a bounded set of repeated short phrases selected from the heldout period and filtered for contact/address patterns; they are not a representative review sample.",
                    "These are historical offline results. Scikit-learn inference runs locally; the public site shows saved text-model metrics and retrieval evidence.",
                ]}
    result = {"analysis": analysis, "review_chunks": chunks}
    # Fail the build rather than publishing NaN/Infinity through a permissive JSON encoder.
    import json
    json.dumps(result, ensure_ascii=False, allow_nan=False)
    return result
