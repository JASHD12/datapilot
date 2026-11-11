"""Single-user local API. Public hosting serves the sanitized static replay only."""
from __future__ import annotations

import json
import os
import shutil
import threading
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .assistant import answer_question
from .data import demo_frame, load_csv_bytes, profile_frame
from .knowledge import KnowledgeBase
from .ml import run_classification, run_forecast, run_regression, run_segments
from .store import RunStore, fingerprint

ROOT = Path(os.getenv("DATAPILOT_ROOT", Path(__file__).resolve().parents[2]))
MAX_UPLOAD = 8 * 1024 * 1024


def normalized_profile(frame):
    result = profile_frame(frame)
    columns = result.get("columns")
    if isinstance(columns, list):
        result["column_details"] = columns
        result["columns"] = len(columns)
    else:
        result["column_details"] = result.get("column_details", [])
    return result


class TrainRequest(BaseModel):
    task: Literal["classification", "regression"] = "classification"
    target: str | None = Field(default=None, max_length=128)
    features: list[str] | None = Field(default=None, max_length=40)


class ForecastRequest(BaseModel):
    date_column: str = Field(default="purchase_date", max_length=128)


class Question(BaseModel):
    question: str = Field(min_length=2, max_length=2000)


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=1000)


class Workspace:
    def __init__(self, state_dir: Path):
        self.state_dir = state_dir
        state_dir.mkdir(parents=True, exist_ok=True)
        self.store = RunStore(state_dir / "runs.sqlite")
        self.lock = threading.RLock()
        knowledge_dir = state_dir / "documents"
        knowledge_dir.mkdir(exist_ok=True)
        for file in (ROOT / "data" / "documents").glob("*"):
            if file.is_file() and not (knowledge_dir / file.name).exists():
                shutil.copyfile(file, knowledge_dir / file.name)
        self.knowledge = KnowledgeBase(knowledge_dir)
        self.reset()

    def reset(self):
        self.frame = demo_frame()
        self.source = {"kind": "synthetic", "label": "Synthetic order simulation",
                       "description": "Deterministic generated data for testing the workflow; not real customer orders.",
                       "seed": 42}
        self.name = "Operations lab"
        self.results = {}
        snapshot = ROOT / "frontend" / "demo-snapshot.json"
        if snapshot.exists():
            saved = json.loads(snapshot.read_text())
            if saved.get("dataset_hash") == fingerprint(self.frame):
                self.results = saved.get("results", {})

    def view(self):
        return {"id": fingerprint(self.frame)[:12], "name": self.name,
                "source": self.source, "dataset_hash": fingerprint(self.frame),
                "profile": normalized_profile(self.frame), "results": self.results,
                "documents": self.knowledge.documents(), "runs": self.store.list(),
                "capabilities": {"uploads": True, "training": True,
                                 "llm_enabled": os.getenv("DATAPILOT_ENABLE_LLM") == "1"},
                "version": __version__}


def create_app(state_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="DataPilot", version=__version__,
                  description="Local single-user ML workbench. Bind to loopback; the public demo is static.")
    app.state.workspace = Workspace(state_dir or Path(os.getenv("DATAPILOT_STATE_DIR", ROOT / ".datapilot")))

    @app.exception_handler(ValueError)
    async def invalid_input(request: Request, exc: ValueError):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    def workspace(request: Request) -> Workspace:
        return request.app.state.workspace

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": __version__, "mode": "local", "single_user": True}

    @app.get("/api/workspace")
    def get_workspace(request: Request):
        w = workspace(request)
        with w.lock:
            return w.view()

    @app.post("/api/datasets/demo")
    def reset_demo(request: Request):
        w = workspace(request)
        with w.lock:
            w.reset()
            return w.view()

    @app.post("/api/datasets/upload")
    def upload_dataset(request: Request, file: UploadFile = File(...)):
        if not (file.filename or "").lower().endswith(".csv"):
            raise HTTPException(422, "Upload a UTF-8 CSV file.")
        content = file.file.read(MAX_UPLOAD + 1)
        if len(content) > MAX_UPLOAD:
            raise HTTPException(413, "CSV uploads are limited to 8 MB.")
        frame = load_csv_bytes(content)
        w = workspace(request)
        with w.lock:
            w.frame = frame
            w.source = {"kind": "upload", "label": Path(file.filename).name,
                        "description": "User-provided CSV, held in this local process. Provenance supplied by user."}
            w.name = Path(file.filename).stem[:60]
            w.results = {}
            return w.view()

    def save_result(w, task, result):
        result["provenance"] = w.store.record(task, w.frame, w.source, result)
        w.results[task] = result
        return result

    @app.post("/api/models/train")
    def train_model(body: TrainRequest, request: Request):
        w = workspace(request)
        with w.lock:
            function = run_classification if body.task == "classification" else run_regression
            target = body.target or ("delivery_late" if body.task == "classification" else "delivery_days")
            return save_result(w, body.task, function(w.frame, target=target, features=body.features))

    @app.post("/api/forecast")
    def forecast(body: ForecastRequest, request: Request):
        w = workspace(request)
        with w.lock:
            return save_result(w, "forecast", run_forecast(w.frame, date_column=body.date_column))

    @app.post("/api/segments")
    def segments(request: Request):
        w = workspace(request)
        with w.lock:
            return save_result(w, "segments", run_segments(w.frame))

    @app.get("/api/runs")
    def runs(request: Request):
        return {"runs": workspace(request).store.list()}

    @app.get("/api/knowledge")
    def documents(request: Request):
        return {"documents": workspace(request).knowledge.documents()}

    @app.post("/api/knowledge/search")
    def search(body: SearchRequest, request: Request):
        w = workspace(request)
        with w.lock:
            return {"results": w.knowledge.search(body.query)}

    @app.post("/api/knowledge/upload")
    def upload_document(request: Request, file: UploadFile = File(...)):
        content = file.file.read(5 * 1024 * 1024 + 1)
        w = workspace(request)
        with w.lock:
            return w.knowledge.add_document(file.filename or "document.txt", content)

    @app.post("/api/assistant")
    def ask(body: Question, request: Request):
        w = workspace(request)
        with w.lock:
            return answer_question(body.question, normalized_profile(w.frame), w.results, w.knowledge)

    @app.get("/")
    def home():
        return FileResponse(ROOT / "frontend" / "index.html")

    @app.get("/site-config.json")
    def config():
        path = ROOT / "frontend" / "site-config.json"
        return json.loads(path.read_text()) if path.exists() else {"github_url": None}

    # Mount last: API paths are resolved before the frontend.
    app.mount("/", StaticFiles(directory=ROOT / "frontend", html=True), name="frontend")
    return app

