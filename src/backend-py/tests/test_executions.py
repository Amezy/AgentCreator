"""Tests for execution API endpoints.

Uses the shared `client` fixture from conftest.py — do NOT redefine it here.
"""

import pytest
from httpx import AsyncClient


@pytest.fixture
async def seed_workflow(client: AsyncClient):
    """Create a minimal workflow + persona + wf_node for testing executions."""
    # Create a persona
    resp = await client.post("/api/v1/personas", json={
        "name": "test-worker",
        "position_id": "pos_dev",
        "level": "mid",
    })
    persona_id = resp.json()["data"]["id"] if resp.status_code in (200, 201) else "test-persona"

    # Create a workflow
    resp = await client.post("/api/v1/workflows", json={
        "name": "test-workflow",
        "description": "test",
    })
    workflow_id = resp.json()["data"]["id"] if resp.status_code in (200, 201) else "test-workflow"

    # Add at least one wf_node so execution creates actual steps
    resp = await client.post(f"/api/v1/workflows/{workflow_id}/nodes", json={
        "node_type": "persona_task",
        "label": "需求分析",
        "persona_id": persona_id,
        "position_y": 100,
    })
    node_id = resp.json()["data"]["id"] if resp.status_code in (200, 201) else None

    return {"persona_id": persona_id, "workflow_id": workflow_id, "node_id": node_id}


@pytest.mark.asyncio
async def test_create_execution(client: AsyncClient, seed_workflow):
    """POST /api/v1/executions should create an execution with 201."""
    resp = await client.post("/api/v1/executions", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "测试执行",
    })
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["status"] == "running"
    assert "id" in data
    assert "log_dir" in data
    assert data["total_steps"] >= 1


@pytest.mark.asyncio
async def test_get_execution(client: AsyncClient, seed_workflow):
    """GET /api/v1/executions/{id} should return execution."""
    create_resp = await client.post("/api/v1/executions", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "测试执行",
    })
    exec_id = create_resp.json()["data"]["id"]

    resp = await client.get(f"/api/v1/executions/{exec_id}")
    assert resp.status_code == 200
    assert resp.json()["data"]["task_title"] == "测试执行"


@pytest.mark.asyncio
async def test_get_execution_not_found(client: AsyncClient):
    """GET /api/v1/executions/nonexistent should return 404."""
    resp = await client.get("/api/v1/executions/nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_execution_steps(client: AsyncClient, seed_workflow):
    """GET /api/v1/executions/{id}/steps should return steps list with entries."""
    create_resp = await client.post("/api/v1/executions", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "测试执行",
    })
    exec_id = create_resp.json()["data"]["id"]

    resp = await client.get(f"/api/v1/executions/{exec_id}/steps")
    assert resp.status_code == 200
    steps = resp.json()["data"]
    assert isinstance(steps, list)
    assert len(steps) >= 1


@pytest.mark.asyncio
async def test_execution_lifecycle(client: AsyncClient, seed_workflow):
    """Test full lifecycle: create → steps are pending → complete."""
    create_resp = await client.post("/api/v1/executions", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "生命周期测试",
    })
    assert create_resp.status_code == 201
    exec_id = create_resp.json()["data"]["id"]

    steps_resp = await client.get(f"/api/v1/executions/{exec_id}/steps")
    steps = steps_resp.json()["data"]
    assert all(s["status"] == "pending" for s in steps)

    exec_resp = await client.get(f"/api/v1/executions/{exec_id}")
    assert exec_resp.json()["data"]["status"] == "running"
    assert exec_resp.json()["data"]["completed_steps"] == 0


@pytest.mark.asyncio
async def test_compact_execution(client: AsyncClient, seed_workflow):
    """POST /api/v1/executions/{id}/compact should return compaction result."""
    create_resp = await client.post("/api/v1/executions", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "压缩测试",
    })
    exec_id = create_resp.json()["data"]["id"]

    resp = await client.post(f"/api/v1/executions/{exec_id}/compact")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "trigger" in data
    assert data["trigger"] == "manual"


@pytest.mark.asyncio
async def test_compact_execution_not_found(client: AsyncClient):
    """POST /api/v1/executions/nonexistent/compact should return 404."""
    resp = await client.post("/api/v1/executions/nonexistent/compact")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_context_status(client: AsyncClient, seed_workflow):
    """GET /api/v1/executions/{id}/context-status should return context info."""
    create_resp = await client.post("/api/v1/executions", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "上下文测试",
    })
    exec_id = create_resp.json()["data"]["id"]

    resp = await client.get(f"/api/v1/executions/{exec_id}/context-status")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "total_capacity" in data
    assert "used_tokens" in data
    assert "usage_percent" in data
    assert "steps_breakdown" in data
    assert isinstance(data["steps_breakdown"], list)


@pytest.mark.asyncio
async def test_context_status_not_found(client: AsyncClient):
    """GET /api/v1/executions/nonexistent/context-status should return 404."""
    resp = await client.get("/api/v1/executions/nonexistent/context-status")
    assert resp.status_code == 404
