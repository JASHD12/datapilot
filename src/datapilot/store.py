"""Append-only local experiment records. Uploaded data never enters public builds."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


def fingerprint(frame: pd.DataFrame) -> str:
    return hashlib.sha256(frame.to_csv(index=False).encode()).hexdigest()


class RunStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path) as connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS runs
                (id TEXT PRIMARY KEY, created_at TEXT, task TEXT, dataset_hash TEXT,
                 source TEXT, result TEXT)""")

    def record(self, task: str, frame: pd.DataFrame, source: dict, result: dict) -> dict:
        run = {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat(),
               "task": task, "dataset_hash": fingerprint(frame), "source": source}
        with sqlite3.connect(self.path) as connection:
            connection.execute("INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?)",
                               (run["id"], run["created_at"], task, run["dataset_hash"],
                                json.dumps(source), json.dumps(result, allow_nan=False)))
        return run

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        with sqlite3.connect(self.path) as connection:
            rows = connection.execute(
                "SELECT id,created_at,task,dataset_hash,source FROM runs ORDER BY created_at DESC LIMIT ?",
                (min(max(limit, 1), 100),)).fetchall()
        return [dict(zip(("id", "created_at", "task", "dataset_hash", "source"),
                         (*row[:4], json.loads(row[4])))) for row in rows]

