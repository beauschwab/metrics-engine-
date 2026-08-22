"""The FastAPI surface without a model: degrade paths and health."""

import json

import httpx
import pytest

from chartroom_agent.app import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> httpx.AsyncClient:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    transport = httpx.ASGITransport(app=create_app())
    return httpx.AsyncClient(transport=transport, base_url="http://agent")


def _events(body: str) -> list[dict]:
    return [
        json.loads(frame[len("data: ") :])
        for frame in body.split("\n\n")
        if frame.startswith("data: ")
    ]


async def test_healthz(client: httpx.AsyncClient) -> None:
    r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["model_available"] is False


async def test_no_key_degrades_to_unavailable(client: httpx.AsyncClient) -> None:
    r = await client.post("/agent/chat", json={"message": "hello"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = _events(r.text)
    assert len(events) == 1
    assert events[0]["type"] == "unavailable"
    assert "deterministic" in events[0]["message"]


async def test_bad_request_is_an_error_event_not_a_500(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-real")
    r = await client.post("/agent/chat", json={"messages": []})
    events = _events(r.text)
    assert events[0]["type"] == "error"
    assert "send a message" in events[0]["message"]


async def test_registry_surface_serves_the_same_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # One process, one endpoint, one frozen protocol — AGENT_SURFACE only
    # changes whose tools load and what the degrade names (ADR-56).
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("AGENT_SURFACE", "registry")
    transport = httpx.ASGITransport(app=create_app())
    client = httpx.AsyncClient(transport=transport, base_url="http://agent")

    health = await client.get("/healthz")
    assert health.json()["surface"] == "registry"

    r = await client.post("/agent/chat", json={"message": "hello"})
    events = _events(r.text)
    assert events[0]["type"] == "unavailable"
    # The degrade speaks for this surface: diagnostics, not the studio's linter.
    assert "diagnostics" in events[0]["message"]
    # The studio's warehouse query path does not ride along on this surface.
    assert (await client.post("/query/run", json={})).status_code == 404
