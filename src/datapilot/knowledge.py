"""Local, source-linked retrieval baseline. No API key or network is required.

Documents are untrusted data: this module reads text and indexes words, never
instructions. TF-IDF is lexical retrieval, not a semantic embedding model.
"""

from __future__ import annotations

import hashlib
import io
import re
from pathlib import Path
from typing import Any

from sklearn.feature_extraction.text import TfidfVectorizer

MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
MAX_EXTRACTED_CHARACTERS = 1_000_000
ALLOWED_SUFFIXES = {".txt", ".md", ".pdf"}


class KnowledgeBase:
    """A small on-disk collection with a reproducible TF-IDF search index."""

    def __init__(self, documents_dir: Path):
        self.documents_dir = Path(documents_dir).resolve()
        self.documents_dir.mkdir(parents=True, exist_ok=True)
        self._documents: list[dict[str, Any]] = []
        self._chunks: list[dict[str, Any]] = []
        self._vectorizer: TfidfVectorizer | None = None
        self._matrix = None
        self._refresh()

    @staticmethod
    def _validate_filename(filename: str) -> str:
        if not isinstance(filename, str) or not filename or len(filename) > 160:
            raise ValueError("Use a filename of 1–160 characters.")
        if Path(filename).name != filename or "/" in filename or "\\" in filename:
            raise ValueError("Document filenames cannot contain paths.")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_. -]*", filename):
            raise ValueError("Use letters, numbers, spaces, underscores, dots, or hyphens.")
        if Path(filename).suffix.lower() not in ALLOWED_SUFFIXES:
            raise ValueError("Supported document formats: .txt, .md, .pdf.")
        return filename

    @staticmethod
    def _extract(filename: str, content: bytes) -> str:
        if not content or len(content) > MAX_DOCUMENT_BYTES:
            raise ValueError("Documents must contain data and be at most 5 MB.")
        if Path(filename).suffix.lower() == ".pdf":
            try:
                from pypdf import PdfReader
            except ImportError as exc:
                raise ValueError("PDF support requires the optional pypdf package.") from exc
            try:
                reader = PdfReader(io.BytesIO(content))
                if reader.is_encrypted:
                    raise ValueError("Encrypted PDF documents are unsupported.")
                pages: list[str] = []
                size = 0
                for number, page in enumerate(reader.pages, start=1):
                    page_text = page.extract_text() or ""
                    size += len(page_text)
                    if size > MAX_EXTRACTED_CHARACTERS:
                        raise ValueError("Extracted document exceeds the 1 million character limit.")
                    pages.append(f"\n## Page {number}\n{page_text}")
                text = "\n".join(pages)
            except ValueError:
                raise
            except Exception as exc:
                raise ValueError("Could not read that PDF. Use a text-based PDF, TXT, or Markdown.") from exc
        else:
            try:
                text = content.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise ValueError("Text documents must use UTF-8 encoding.") from exc
        text = text.replace("\x00", "").strip()
        if len(text) > MAX_EXTRACTED_CHARACTERS:
            raise ValueError("Extracted document exceeds the 1 million character limit.")
        if not text or not re.search(r"\w", text):
            raise ValueError("No readable text found. Scanned PDFs require OCR before upload.")
        return text

    @staticmethod
    def _chunk(filename: str, text: str) -> list[dict[str, Any]]:
        title_match = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else Path(filename).stem.replace("_", " ")
        sections = re.split(r"(?m)^(#{1,6})\s+(.+)\s*$", text)
        heading = "Introduction"
        pieces: list[tuple[str, str]] = []
        if sections[0].strip():
            pieces.append((heading, sections[0].strip()))
        for pos in range(1, len(sections), 3):
            heading = sections[pos + 1].strip()
            body = sections[pos + 2].strip()
            if body:
                pieces.append((heading, body))
        if not pieces:
            pieces = [(heading, text)]
        chunks = []
        for section, body in pieces:
            for start in range(0, len(body), 1400):
                excerpt = body[start : start + 1600].strip()
                if not excerpt:
                    continue
                digest = hashlib.sha256(f"{filename}\0{section}\0{start}\0{excerpt}".encode()).hexdigest()[:16]
                chunks.append({
                    "id": digest,
                    "title": title,
                    "source": filename,
                    "text": excerpt,
                    "section": section,
                })
        return chunks

    def _refresh(self) -> None:
        documents = []
        chunks = []
        for path in sorted(self.documents_dir.iterdir()):
            if path.is_symlink() or not path.is_file() or path.suffix.lower() not in ALLOWED_SUFFIXES:
                continue
            try:
                self._validate_filename(path.name)
                if path.stat().st_size > MAX_DOCUMENT_BYTES:
                    continue
                content = path.read_bytes()
                text = self._extract(path.name, content)
            except (OSError, ValueError):
                continue
            parts = self._chunk(path.name, text)
            documents.append({
                "id": hashlib.sha256(path.name.encode()).hexdigest()[:16],
                "title": parts[0]["title"],
                "source": path.name,
                "filename": path.name,
                "bytes": len(content),
                "chunks": len(parts),
            })
            chunks.extend(parts)
        self._documents, self._chunks = documents, chunks
        self._matrix = self._vectorizer = None
        if chunks:
            try:
                self._vectorizer = TfidfVectorizer(
                    lowercase=True, stop_words="english", ngram_range=(1, 2), sublinear_tf=True,
                    max_features=30_000, token_pattern=r"(?u)\b\w[\w-]+\b",
                )
                self._matrix = self._vectorizer.fit_transform(
                    f"{chunk['title']} {chunk['section']} {chunk['text']}" for chunk in chunks
                )
            except ValueError:
                self._vectorizer = None

    def documents(self) -> list[dict[str, Any]]:
        """Return metadata only; filesystem paths and document instructions stay private."""
        return [dict(document) for document in self._documents]

    def search(self, query: str, limit: int = 4) -> list[dict[str, Any]]:
        if not isinstance(query, str) or not query.strip() or self._vectorizer is None:
            return []
        limit = max(0, min(int(limit), 10))
        if limit == 0:
            return []
        query_vector = self._vectorizer.transform([query[:4000]])
        scores = (self._matrix @ query_vector.T).toarray().ravel()
        ordered = sorted(range(len(scores)), key=lambda index: (-float(scores[index]), index))
        return [
            {**self._chunks[index], "score": round(float(scores[index]), 6)}
            for index in ordered[:limit] if scores[index] >= 0.06
        ]

    def add_document(self, filename: str, content: bytes) -> dict[str, Any]:
        filename = self._validate_filename(filename)
        if not isinstance(content, bytes):
            raise ValueError("Document content must be bytes.")
        self._extract(filename, content)
        destination = self.documents_dir / filename
        if destination.exists() or destination.is_symlink():
            raise ValueError("A document with that filename already exists. Use a new filename.")
        # Exclusive creation avoids overwriting a document or following a symlink.
        with destination.open("xb") as stream:
            stream.write(content)
        self._refresh()
        return next(document for document in self.documents() if document["source"] == filename)
