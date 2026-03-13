"""Tests for AI skill generation SSE endpoint."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_ai_generate_returns_sse_content_type(client: AsyncClient):
    """POST /api/v1/skills/ai-generate should return SSE content type."""
    resp = await client.post(
        "/api/v1/skills/ai-generate",
        json={
            "messages": [{"role": "user", "content": "创建一个代码审查技能"}],
            "current_skill": {},
            "step": 1,
        },
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_ai_generate_with_no_model_returns_error_event(client: AsyncClient):
    """When no models configured, should return error SSE event."""
    resp = await client.post(
        "/api/v1/skills/ai-generate",
        json={
            "messages": [{"role": "user", "content": "test"}],
            "current_skill": {},
            "step": 1,
            "model_id": "nonexistent",
        },
    )
    assert resp.status_code == 200
    body = resp.text
    # Should contain SSE data lines
    assert "data:" in body


@pytest.mark.asyncio
async def test_ai_generate_request_validation(client: AsyncClient):
    """Request with default values should work."""
    resp = await client.post(
        "/api/v1/skills/ai-generate",
        json={"messages": [], "step": 1},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_ai_generate_accepts_all_steps(client: AsyncClient):
    """Steps 1, 2, 3 should all be accepted."""
    for step in [1, 2, 3]:
        resp = await client.post(
            "/api/v1/skills/ai-generate",
            json={"messages": [{"role": "user", "content": "test"}], "step": step},
        )
        assert resp.status_code == 200
