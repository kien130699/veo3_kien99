from fastapi.testclient import TestClient
from app.main import app
client=TestClient(app)

def test_health():
    response=client.get('/api/health');assert response.status_code==200;payload=response.json();assert payload['ok'] is True;assert payload['version']=='1.0.0';assert payload['mock_flow'] is True

def test_scan_mock():
    response=client.post('/api/scan');assert response.status_code==200;payload=response.json();assert payload['editor_found'] is True;assert payload['submit_enabled'] is True

def test_generate_mock():
    response=client.post('/api/generate',json={'prompt':'A red teapot','mode':'image'});assert response.status_code==200;payload=response.json();assert payload['submit_clicked'] is True;assert payload['submit_signal']=='mock_submitted'

def test_generate_rejects_empty_prompt():
    assert client.post('/api/generate',json={'prompt':''}).status_code==422
