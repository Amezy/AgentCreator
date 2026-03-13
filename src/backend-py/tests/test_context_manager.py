"""Tests for context manager service."""

import pytest
from httpx import AsyncClient


@pytest.fixture
async def execution_id(client: AsyncClient):
    """Create a test execution and return its ID."""
    # Create persona
    resp = await client.post("/api/v1/personas", json={
        "name": "ctx-test-worker",
        "position_id": "pos_dev",
        "level": "mid",
        "system_prompt": "test",
    })
    persona_id = resp.json().get("data", {}).get("id", "test-persona")

    # Create workflow
    resp = await client.post("/api/v1/workflows", json={
        "name": "ctx-test-wf",
        "description": "test",
    })
    workflow_id = resp.json().get("data", {}).get("id", "test-wf")

    # Add a node
    await client.post(f"/api/v1/workflows/{workflow_id}/nodes", json={
        "node_type": "persona_task",
        "label": "测试步骤",
        "persona_id": persona_id,
        "position_y": 100,
    })

    # Create execution
    resp = await client.post("/api/v1/executions", json={
        "workflow_id": workflow_id,
        "persona_id": persona_id,
        "task_title": "上下文测试",
    })
    return resp.json()["data"]["id"]


@pytest.mark.asyncio
async def test_context_status(client: AsyncClient, execution_id: str):
    """GET /executions/{id}/context-status should return usage info."""
    resp = await client.get(f"/api/v1/executions/{execution_id}/context-status")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "total_capacity" in data
    assert "used_tokens" in data
    assert "usage_percent" in data
    assert "auto_compact_enabled" in data
    assert "steps_breakdown" in data
    assert isinstance(data["steps_breakdown"], list)


@pytest.mark.asyncio
async def test_manual_compact(client: AsyncClient, execution_id: str):
    """POST /executions/{id}/compact should return compaction metrics."""
    resp = await client.post(f"/api/v1/executions/{execution_id}/compact")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "pre_tokens" in data
    assert "post_tokens" in data
    assert "freed_tokens" in data
    assert data["trigger"] == "manual"


@pytest.mark.asyncio
async def test_context_status_not_found(client: AsyncClient):
    """Context status for nonexistent execution should return 404."""
    resp = await client.get("/api/v1/executions/nonexistent/context-status")
    assert resp.status_code == 404
