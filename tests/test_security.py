import pytest

from app.edge_flow import EdgeFlowDriver


def test_cdp_restricted_to_loopback():
    EdgeFlowDriver.validate_cdp_url("http://127.0.0.1:9223")
    EdgeFlowDriver.validate_cdp_url("http://localhost:9223")
    with pytest.raises(ValueError):
        EdgeFlowDriver.validate_cdp_url("http://192.168.1.10:9223")
    with pytest.raises(ValueError):
        EdgeFlowDriver.validate_cdp_url("https://127.0.0.1:9223")
