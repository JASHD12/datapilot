"""Reproducible bilingual retrieval experiment with optional local ONNX encoding.

The corpus is public source material, not executable instructions. Encoder
dependencies are imported only when requested; ordinary app startup stays small.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import time
import unicodedata
import urllib.request

import numpy as np

MODEL_ID = "intfloat/multilingual-e5-small"
MODEL_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
BROWSER_MODEL = "Xenova/multilingual-e5-small"
BROWSER_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78"
MODEL_FILES = ("config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx")
MODEL_SHA256 = {
    "config.json": "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1",
    "tokenizer.json": "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    "tokenizer_config.json": "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
    "onnx/model_quantized.onnx": "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
}
RRF_K = 60
RETRIEVAL_K = 3
RRF_CANDIDATES = 20


def normalized_text(text: str) -> str:
    text = "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z0-9]+", text))


def corpus_from_snapshot(snapshot: dict) -> list[dict]:
    """Deduplicate wording, retaining the first original source and no new text."""
    seen = set()
    passages = []
    for chunk in snapshot["knowledge_chunks"]:
        normalized = normalized_text(chunk["text"])
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        passages.append({key: chunk[key] for key in ["id", "title", "source", "section", "text", "source_url"] if key in chunk})
    if not passages:
        raise ValueError("A nonempty source corpus is required.")
    return passages


def fingerprint(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


class LexicalIndex:
    """Small transparent unigram TF-IDF baseline shared with the browser."""

    def __init__(self, texts: list[str]):
        counts = [Counter(normalized_text(text).split()) for text in texts]
        vocabulary = sorted({word for row in counts for word in row})
        self.vocabulary = vocabulary
        self.lookup = {word: index for index, word in enumerate(vocabulary)}
        self.idf = np.asarray([math.log((1 + len(texts)) / (1 + sum(word in row for row in counts))) + 1 for word in vocabulary])
        self.matrix = np.asarray([self.encode_counts(row) for row in counts])

    def encode_counts(self, counts: Counter) -> np.ndarray:
        vector = np.zeros(len(self.vocabulary), dtype=float)
        for word, count in counts.items():
            if word in self.lookup:
                index = self.lookup[word]
                vector[index] = (1 + math.log(count)) * self.idf[index]
        length = np.linalg.norm(vector)
        return vector / length if length else vector

    def score(self, query: str) -> np.ndarray:
        return self.matrix @ self.encode_counts(Counter(normalized_text(query).split()))

    def export(self) -> dict:
        return {"vocabulary": self.vocabulary, "idf": self.idf.round(9).tolist(),
                "vectors": [[[int(index), round(float(row[index]), 9)] for index in np.flatnonzero(row)] for row in self.matrix],
                "definition": "Lowercase, NFKD accent removal, ASCII word unigrams; sublinear TF and smoothed IDF; L2 cosine. No translation or synonym expansion."}


def ranked_indices(scores: np.ndarray) -> list[int]:
    return sorted(range(len(scores)), key=lambda index: (-float(scores[index]), index))


def hybrid_scores(lexical: np.ndarray, dense: np.ndarray) -> np.ndarray:
    if lexical.shape != dense.shape or lexical.ndim != 1:
        raise ValueError("Score vectors must have equal one-dimensional shapes.")
    result = np.zeros(len(lexical), dtype=float)
    for scores, positive_only in [(lexical, True), (dense, False)]:
        ranked = [index for index in ranked_indices(scores) if not positive_only or scores[index] > 0][:RRF_CANDIDATES]
        for rank, index in enumerate(ranked, start=1):
            result[index] += 1 / (RRF_K + rank)
    return result


def ranking_metrics(ids: list[str], relevant_ids: list[str], k: int = RETRIEVAL_K) -> dict:
    relevant = set(relevant_ids)
    if not relevant:
        raise ValueError("Ranking metrics require an answerable question.")
    hits = [1 if identifier in relevant else 0 for identifier in ids[:k]]
    dcg = sum(hit / math.log2(rank + 2) for rank, hit in enumerate(hits))
    ideal = sum(1 / math.log2(rank + 2) for rank in range(min(k, len(relevant))))
    return {f"recall_at_{k}": sum(hits) / len(relevant),
            f"mrr_at_{k}": next((1 / (rank + 1) for rank, hit in enumerate(hits) if hit), 0),
            f"ndcg_at_{k}": dcg / ideal,
            f"hit_rate_at_{k}": float(any(hits))}


def validate_questions(questions: list[dict], passages: list[dict]) -> None:
    ids = {passage["id"] for passage in passages}
    question_ids = [question["id"] for question in questions]
    if len(question_ids) != len(set(question_ids)):
        raise ValueError("Question IDs must be unique.")
    intents = {split: set() for split in ["dev", "test"]}
    for question in questions:
        if question.get("split") not in intents or question.get("language") not in {"en", "pt"}:
            raise ValueError("Declare dev/test and en/pt for every question.")
        if bool(question["relevant_ids"]) != question["answerable"]:
            raise ValueError("Answerability must agree with relevance judgments.")
        if len(question["relevant_ids"]) != len(set(question["relevant_ids"])) or not set(question["relevant_ids"]).issubset(ids):
            raise ValueError("Relevant IDs must reference unique corpus passages.")
        intents[question["split"]].add(question["intent"])
    if intents["dev"] & intents["test"]:
        raise ValueError("Development and test intent families must be disjoint.")
    for split in intents:
        selected = [question for question in questions if question["split"] == split]
        if not any(question["answerable"] for question in selected) or not any(not question["answerable"] for question in selected):
            raise ValueError("Each split needs answerable and unanswerable questions.")


def select_threshold(dev_rows: list[dict]) -> tuple[float, dict]:
    """Maximize balanced answerability accuracy using development rows only."""
    if not dev_rows or not all(row.get("split") == "dev" for row in dev_rows):
        raise ValueError("Threshold selection accepts development rows only.")
    if {row["answerable"] for row in dev_rows} != {True, False} or not all(math.isfinite(row["top_score"]) for row in dev_rows):
        raise ValueError("Development rows need both answerability classes and finite scores.")
    values = sorted(set(float(row["top_score"]) for row in dev_rows))
    thresholds = [values[0] - 1e-8] + [(a + b) / 2 for a, b in zip(values, values[1:])] + [values[-1] + 1e-8]
    def objective(threshold: float) -> tuple[float, float]:
        positive = [row for row in dev_rows if row["answerable"]]
        negative = [row for row in dev_rows if not row["answerable"]]
        tpr = sum(row["top_score"] >= threshold for row in positive) / len(positive)
        tnr = sum(row["top_score"] < threshold for row in negative) / len(negative)
        # Conservative abstention breaks equal-objective ties, fixed in advance.
        return (tpr + tnr) / 2, threshold
    threshold = max(thresholds, key=objective)
    return threshold, {"objective": "development balanced answerability accuracy; equal-objective ties prefer the larger threshold", "value": objective(threshold)[0], "candidate_count": len(thresholds)}


def summarize(rows: list[dict], threshold: float) -> dict:
    answerable = [row for row in rows if row["answerable"]]
    negative = [row for row in rows if not row["answerable"]]
    keys = list(answerable[0]["metrics"]) if answerable else []
    accepted = [row for row in rows if row["top_score"] >= threshold]
    accepted_correct = [row for row in accepted if row["answerable"] and row["metrics"]["hit_rate_at_3"] > 0]
    return {"questions": len(rows), "answerable_questions": len(answerable), "unanswerable_questions": len(negative),
            "answerable": {key: float(np.mean([row["metrics"][key] for row in answerable])) for key in keys},
            "abstention": {"coverage": len(accepted) / len(rows) if rows else 0,
                           "answerable_accept_rate": sum(row["top_score"] >= threshold for row in answerable) / len(answerable) if answerable else None,
                           "unanswerable_abstain_rate": sum(row["top_score"] < threshold for row in negative) / len(negative) if negative else None,
                           "accepted_retrieval_success_rate": len(accepted_correct) / len(accepted) if accepted else None,
                           "definition": "Success means an accepted answerable question has a judged-relevant passage in its top 3. It does not measure generated-answer factuality."}}


def download_model(directory: Path) -> None:
    """Download immutable public ONNX/tokenizer files; no remote Python execution."""
    for filename in MODEL_FILES:
        destination = directory / filename
        if destination.is_file():
            if hashlib.sha256(destination.read_bytes()).hexdigest() != MODEL_SHA256[filename]:
                raise ValueError(f"Cached model checksum mismatch: {filename}; remove that file and download the pinned revision again.")
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".partial")
        with urllib.request.urlopen(f"https://huggingface.co/{BROWSER_MODEL}/resolve/{BROWSER_REVISION}/{filename}", timeout=120) as response, temporary.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != MODEL_SHA256[filename]:
            raise ValueError(f"Downloaded model checksum mismatch: {filename}.")
        temporary.replace(destination)


class OnnxEncoder:
    """E5 attention-masked mean pooling with matching query/passage prefixes."""

    def __init__(self, directory: Path):
        try:
            import onnxruntime as ort
            from tokenizers import Tokenizer
        except ImportError as exc:
            raise RuntimeError("Install the semantic extra: pip install -e '.[semantic]'.") from exc
        ort.disable_telemetry_events()
        self.directory = Path(directory)
        for filename in MODEL_FILES:
            if hashlib.sha256((self.directory / filename).read_bytes()).hexdigest() != MODEL_SHA256[filename]:
                raise ValueError(f"Pinned model checksum mismatch: {filename}.")
        self.tokenizer = Tokenizer.from_file(str(self.directory / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=512)
        self.tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(self.directory / "onnx/model_quantized.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        self.input_names = {item.name for item in self.session.get_inputs()}

    def encode(self, texts: list[str], kind: str, batch_size: int = 8) -> np.ndarray:
        if kind not in {"query", "passage"}:
            raise ValueError("Use the query or passage prefix.")
        vectors = []
        for start in range(0, len(texts), batch_size):
            encoded = self.tokenizer.encode_batch([f"{kind}: {text}" for text in texts[start:start + batch_size]])
            values = {"input_ids": np.asarray([row.ids for row in encoded], dtype=np.int64),
                      "attention_mask": np.asarray([row.attention_mask for row in encoded], dtype=np.int64),
                      "token_type_ids": np.asarray([row.type_ids for row in encoded], dtype=np.int64)}
            output = self.session.run(None, {key: value for key, value in values.items() if key in self.input_names})[0]
            mask = values["attention_mask"][..., None]
            pooled = (output * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1)
            norm = np.linalg.norm(pooled, axis=1, keepdims=True)
            vectors.extend(pooled / np.maximum(norm, 1e-12))
        return np.asarray(vectors, dtype=np.float32)

    def files(self) -> list[dict]:
        return [{"path": filename, "bytes": (self.directory / filename).stat().st_size,
                 "sha256": hashlib.sha256((self.directory / filename).read_bytes()).hexdigest()} for filename in MODEL_FILES]


def build_study(snapshot: dict, questions_manifest: dict, encoder: OnnxEncoder) -> dict:
    start = time.perf_counter()
    passages = corpus_from_snapshot(snapshot)
    questions = questions_manifest["questions"]
    validate_questions(questions, passages)
    corpus_vectors = encoder.encode([passage["text"] for passage in passages], "passage")
    # Single-query batches match the browser's live query encoding path.
    query_vectors = encoder.encode([question["query"] for question in questions], "query", batch_size=1)
    lexical_index = LexicalIndex([passage["text"] for passage in passages])
    all_rows = {method: [] for method in ["lexical", "dense", "hybrid"]}
    cases = []
    for index, question in enumerate(questions):
        lexical = lexical_index.score(question["query"])
        dense = corpus_vectors @ query_vectors[index]
        scores_by_method = {"lexical": lexical, "dense": dense, "hybrid": hybrid_scores(lexical, dense)}
        case = {**question, "results": {}}
        for method, scores in scores_by_method.items():
            ranking = ranked_indices(scores)
            top = [{"id": passages[position]["id"], "score": float(scores[position]), "rank": rank + 1} for rank, position in enumerate(ranking[:3])]
            metrics = ranking_metrics([passages[position]["id"] for position in ranking], question["relevant_ids"]) if question["answerable"] else None
            all_rows[method].append({**question, "top_score": float(scores[ranking[0]]), "metrics": metrics})
            case["results"][method] = {"hits": top, "metrics": metrics}
        cases.append(case)
    methods = []
    for method, rows in all_rows.items():
        dev_rows = [row for row in rows if row["split"] == "dev"]
        threshold, selection = select_threshold(dev_rows)
        methods.append({"id": method, "label": {"lexical": "Unigram TF-IDF", "dense": "Multilingual E5 cosine", "hybrid": "TF-IDF + E5 reciprocal-rank fusion"}[method],
                        "threshold": threshold, "threshold_selection": selection,
                        "dev": summarize(dev_rows, threshold), "test": summarize([row for row in rows if row["split"] == "test"], threshold),
                        "test_by_language": {language: summarize([row for row in rows if row["split"] == "test" and row["language"] == language], threshold) for language in ["en", "pt"]}})
        for case in cases:
            case["results"][method]["abstained"] = case["results"][method]["hits"][0]["score"] < threshold
    probe_queries = [
        "Which review reports that an item had not arrived when the comment was written?",
        "Como evitar que informações futuras influenciem o modelo?",
        "Why can high accuracy be misleading when late deliveries are rare?",
    ]
    probe_vectors = encoder.encode(probe_queries, "query", batch_size=1)
    probes = [{"query": query, "embedding": vector.astype(float).round(8).tolist(),
               "token_ids": encoder.tokenizer.encode("query: " + query).ids}
              for query, vector in zip(probe_queries, probe_vectors)]
    return {"schema_version": 1, "title": "Multilingual retrieval: lexical, dense and hybrid",
            "scope": "A small English/Portuguese seed benchmark over the existing bounded source library. Retrieval only; no generated answers or paid inference.",
            "model": {"id": MODEL_ID, "revision": MODEL_REVISION, "browser_id": BROWSER_MODEL, "browser_revision": BROWSER_REVISION,
                      "license": "Base model MIT; ONNX export references the base model", "model_card": f"https://huggingface.co/{MODEL_ID}",
                      "export_card": f"https://huggingface.co/{BROWSER_MODEL}", "dtype": "q8", "transformers_version": "3.8.1", "dimensions": int(corpus_vectors.shape[1]),
                      "pooling": "Attention-masked mean pooling, L2 normalization; query: and passage: prefixes; 512-token truncation.",
                      "files": encoder.files(), "download_notice": "Optional first-use download of about 136 MB of model/tokenizer files plus the runtime. Runs on your device; no query is sent to a model API.",
                      "probe": {**probes[0], "minimum_cosine": 0.99},
                      "runtime_parity": {"minimum_cosine": 0.99, "probes": probes,
                                         "rule": "Exact probe token IDs and cosine >= 0.99 on all three probes. This is a compatibility heuristic, not a retrieval-quality score. Native and browser q8 outputs are not assumed bit-identical.",
                                         "live_corpus": "Re-encode passages and development questions in the browser; select browser abstention thresholds from development only. Do not mix native passage vectors with browser query vectors."}},
            "corpus": {"documents": len(snapshot["documents"]), "source_chunks": len(snapshot["knowledge_chunks"]), "chunks": len(passages),
                       "deduplication": "Case, accents and punctuation normalized for exact-wording deduplication; first source retained. No rating classification inferred from a retrieved phrase.",
                       "fingerprint": fingerprint(passages), "license": "Olist-derived excerpts CC BY-NC-SA 4.0; authored method documents MIT."},
            "benchmark": {"annotation_status": questions_manifest["annotation_status"], "question_fingerprint": fingerprint(questions_manifest),
                          "version": questions_manifest.get("benchmark_version", "1.0"), "audit_log": questions_manifest.get("audit_log", []),
                          "dev_questions": sum(question["split"] == "dev" for question in questions), "test_questions": sum(question["split"] == "test" for question in questions),
                          "dev_intent_categories": len({question["intent"] for question in questions if question["split"] == "dev"}),
                          "test_intent_categories": len({question["intent"] for question in questions if question["split"] == "test"}),
                          "split_rule": "Authored category IDs are disjoint across development and test; this does not prove semantic independence. Bilingual counterparts stay together. Threshold selection reads development only.",
                          "ranking_k": RETRIEVAL_K, "rrf_k": RRF_K, "rrf_candidates": RRF_CANDIDATES, "selected_method": None,
                          "selection_note": "All three predeclared methods are reported; none is promoted using test scores.", "elapsed_seconds": round(time.perf_counter() - start, 3)},
            "methods": methods, "cases": cases, "passages": passages, "passage_embeddings": corpus_vectors.astype(float).round(7).tolist(), "lexical_index": lexical_index.export(),
            "limitations": ["Questions and relevance judgments were authored with AI assistance and have not been independently human-validated. This is a seed evaluation for review, not a validated external benchmark.",
                            "The 40 questions represent 20 bilingual category pairs, not 40 independent units. Eight categories are development-only and twelve test-only; related policy/privacy themes can still occur across the splits.",
                            "The small source corpus and question set cannot establish broad retrieval quality or multilingual generalization. Test questions are only withheld from threshold selection, not a pristine external research test.",
                            "Binary relevance is based on the supplied source wording. Review statements are historical customer claims, not verified facts, and rating groups are not independent sentiment annotations.",
                            "Abstention thresholds are small-development-set heuristics, not calibrated probabilities. False positive retrieval and missed evidence remain possible.",
                            "RRF scores and cosine scores use different scales. A higher numeric score across methods does not imply higher confidence.",
                            "Live semantic search downloads third-party runtime/model files on explicit request; availability, device memory and bandwidth can limit use. Saved evaluation remains inspectable without downloading the model.",
                            "No cross-encoder reranker or generative LLM is implemented by this experiment."]}
