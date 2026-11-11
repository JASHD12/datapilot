from fastapi.testclient import TestClient

from datapilot.api import create_app


def client(tmp_path):
    return TestClient(create_app(tmp_path / "state"))


def test_workspace_returns_normalized_profile_and_no_private_paths(tmp_path):
    response = client(tmp_path).get("/api/workspace")
    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["rows"] == 1400
    assert isinstance(body["profile"]["columns"], int)
    assert body["source"]["kind"] == "synthetic"
    assert str(tmp_path) not in response.text


def test_uploaded_csv_resets_results_and_invalid_data_has_422(tmp_path):
    api = client(tmp_path)
    invalid = api.post("/api/datasets/upload", files={"file": ("bad.csv", b"a,a\n1,2\n", "text/csv")})
    assert invalid.status_code == 422
    valid = api.post("/api/datasets/upload", files={"file": ("sample.csv", b"x,y\n1,2\n3,4\n", "text/csv")})
    assert valid.status_code == 200
    assert valid.json()["source"]["kind"] == "upload"
    assert valid.json()["results"] == {}


def test_training_records_data_fingerprint_and_run_history(tmp_path):
    api = client(tmp_path)
    response = api.post("/api/models/train", json={"task": "classification"})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["split"]["method"] == "chronological holdout"
    assert len(result["provenance"]["dataset_hash"]) == 64
    assert len(api.get("/api/runs").json()["runs"]) == 1


def test_invalid_task_and_unsupported_file_are_rejected(tmp_path):
    api = client(tmp_path)
    assert api.post("/api/models/train", json={"task": "invented"}).status_code == 422
    assert api.post("/api/datasets/upload", files={"file": ("bad.py", b"print(1)")}).status_code == 422


def test_document_search_and_default_assistant_no_provider(tmp_path, monkeypatch):
    monkeypatch.delenv("DATAPILOT_ENABLE_LLM", raising=False)
    api = client(tmp_path)
    search = api.post("/api/knowledge/search", json={"query": "data leakage"})
    assert search.status_code == 200
    assert search.json()["results"]
    response = api.post("/api/assistant", json={"question": "How many orders are in this dataset?"})
    assert response.status_code == 200
    assert response.json()["mode"] == "deterministic"
    assert "1400" in response.json()["answer"]

