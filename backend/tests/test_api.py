"""HTTP contract of the production node."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURES = Path(__file__).parent / "fixtures"
FRAMEWORK = json.loads((FIXTURES / "framework_dark_cinematic.json").read_text())


@pytest.fixture(scope="module")
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def test_health_reports_capabilities(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "server"
    assert "ffmpeg" in payload and "demucs" in payload
    assert "notes" in payload


def test_framework_crud_roundtrip(client: TestClient) -> None:
    document = {**FRAMEWORK, "id": "fw_api_test", "framework_name": "API Test Framework"}
    created = client.post("/api/frameworks", json=document)
    assert created.status_code == 201
    assert created.json()["framework_name"] == "API Test Framework"

    listed = client.get("/api/frameworks").json()["frameworks"]
    assert any(item["id"] == "fw_api_test" for item in listed)

    fetched = client.get("/api/frameworks/fw_api_test")
    assert fetched.status_code == 200
    assert fetched.json()["watermark"]["position"] == "top-left"

    deleted = client.delete("/api/frameworks/fw_api_test")
    assert deleted.status_code == 200
    assert client.get("/api/frameworks/fw_api_test").status_code == 404


def test_invalid_framework_is_rejected(client: TestClient) -> None:
    assert client.post("/api/frameworks", json={"id": "x", "framework_name": ""}).status_code == 422


def test_import_endpoint_accepts_a_bundle(client: TestClient) -> None:
    bundle = {"frameworks": [{**FRAMEWORK, "id": "fw_imported", "framework_name": "Imported Blueprint"}]}
    response = client.post("/api/frameworks/import", json=bundle)
    assert response.status_code == 200
    assert response.json()["frameworks"][0]["id"] == "fw_imported"
    client.delete("/api/frameworks/fw_imported")


def test_analyze_requires_input(client: TestClient) -> None:
    assert client.post("/api/analyze").status_code == 422


def test_produce_validates_plan(client: TestClient) -> None:
    response = client.post("/api/produce", data={"plan": json.dumps({"slots": []})})
    assert response.status_code == 422
    assert "Invalid render plan" in response.json()["detail"]


def test_produce_requires_clips(client: TestClient) -> None:
    plan = {
        "target_duration_sec": 5,
        "slots": [
            {
                "index": 0,
                "start": 0,
                "end": 5,
                "duration": 5,
                "src_shot": 0,
                "motion": "static",
                "zoom_from": 1,
                "zoom_to": 1,
                "pan": {"x": 0, "y": 0},
                "grade": {"brightness": 0, "contrast": 1, "saturation": 1, "vignette": 0, "temperature": 0},
                "transition": "cut",
                "overlays": [],
                "sfx": [],
            }
        ],
    }
    response = client.post("/api/produce", data={"plan": json.dumps(plan)})
    assert response.status_code == 422
    assert "clip" in response.json()["detail"].lower()


def test_job_lookup_404(client: TestClient) -> None:
    assert client.get("/api/jobs/does-not-exist").status_code == 404


def test_media_streaming_supports_ranges(client: TestClient) -> None:
    from app.config import RENDER_DIR

    asset = RENDER_DIR / "range-test.bin"
    asset.write_bytes(bytes(range(256)) * 8)
    try:
        full = client.get("/api/files/renders/range-test.bin")
        assert full.status_code == 200
        partial = client.get("/api/files/renders/range-test.bin", headers={"Range": "bytes=0-99"})
        assert partial.status_code == 206
        assert partial.headers["content-range"] == f"bytes 0-99/{asset.stat().st_size}"
        assert len(partial.content) == 100
        assert client.get("/api/files/../../etc/passwd").status_code == 404
    finally:
        asset.unlink(missing_ok=True)
