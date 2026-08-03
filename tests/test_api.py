from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["gflow_pin"] == "v0.49.0"


def test_validate_endpoint():
    response = client.post(
        "/api/validate",
        json={
            "input_text": "image | video motion | 12",
            "dry_run": True,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["duration_plan"] == [[[10, 4]]]
    assert data["generation_units"] == 3
