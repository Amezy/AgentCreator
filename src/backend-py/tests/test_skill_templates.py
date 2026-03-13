"""Tests for skill template API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_templates_returns_all(client: AsyncClient):
    """GET /api/v1/skill-templates should return all active templates."""
    resp = await client.get("/api/v1/skill-templates")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    templates = body["data"]
    assert len(templates) >= 5
    names = [t["name"] for t in templates]
    assert "空白技能" in names
    assert "代码审查" in names


@pytest.mark.asyncio
async def test_list_templates_filter_by_category(client: AsyncClient):
    """GET /api/v1/skill-templates?category=engineering should filter."""
    resp = await client.get("/api/v1/skill-templates", params={"category": "engineering"})
    assert resp.status_code == 200
    templates = resp.json()["data"]
    assert all(t["category"] == "engineering" for t in templates)
    assert any(t["name"] == "代码审查" for t in templates)


@pytest.mark.asyncio
async def test_get_template_by_id(client: AsyncClient):
    """GET /api/v1/skill-templates/{id} should return template with parsed tools."""
    resp = await client.get("/api/v1/skill-templates/tpl_code_review")
    assert resp.status_code == 200
    tpl = resp.json()["data"]
    assert tpl["name"] == "代码审查"
    assert tpl["icon"] == "🔍"
    assert isinstance(tpl["default_tools"], list)
    assert "read" in tpl["default_tools"]
    assert "grep" in tpl["default_tools"]
    assert tpl["default_instructions"] is not None
    assert "## 你的角色" in tpl["default_instructions"]


@pytest.mark.asyncio
async def test_get_template_not_found(client: AsyncClient):
    """GET /api/v1/skill-templates/nonexistent should return 404."""
    resp = await client.get("/api/v1/skill-templates/nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_template_default_tools_parsed_as_list(client: AsyncClient):
    """Templates should have default_tools as list, not JSON string."""
    resp = await client.get("/api/v1/skill-templates/tpl_blank")
    tpl = resp.json()["data"]
    assert isinstance(tpl["default_tools"], list)
    assert tpl["default_tools"] == []


@pytest.mark.asyncio
async def test_templates_sorted_by_sort_order(client: AsyncClient):
    """Templates should be returned in sort_order."""
    resp = await client.get("/api/v1/skill-templates")
    templates = resp.json()["data"]
    sort_orders = [t["sort_order"] for t in templates]
    assert sort_orders == sorted(sort_orders)
