"""MCP connections pool API - manage Model Context Protocol server connections."""

import logging
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.mcp_service import mcp_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class McpConnectionCreate(BaseModel):
    name: str
    description: str | None = None
    connection_type: str = "sse"  # 'stdio' | 'sse'
    # HTTP/SSE mode
    server_url: str | None = None
    auth_type: str | None = "none"  # 'api_key' | 'oauth' | 'none'
    auth_config: dict | None = None  # {"api_key": "xxx", "header_name": "..."}
    headers: dict | None = None  # custom HTTP headers
    # Stdio mode
    command: str | None = None  # e.g. "npx", "uvx", "node"
    args: list[str] | None = None  # e.g. ["-y", "@modelcontextprotocol/server-filesystem"]
    env: dict | None = None  # e.g. {"ALLOWED_PATHS": "/tmp"}


class McpConnectionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    connection_type: str | None = None
    server_url: str | None = None
    auth_type: str | None = None
    auth_config: dict | None = None
    headers: dict | None = None
    command: str | None = None
    args: list[str] | None = None
    env: dict | None = None
    is_active: bool | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=ApiResponse)
async def list_connections(
    connection_type: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: aiosqlite.Connection = Depends(get_db),
):
    """获取 MCP 连接列表，支持按 connection_type / is_active 过滤。"""
    items = await mcp_service.list_connections(
        db, connection_type=connection_type, is_active=is_active
    )
    return ApiResponse(success=True, data=items)


@router.post("", response_model=ApiResponse, status_code=201)
async def create_connection(
    body: McpConnectionCreate,
    db: aiosqlite.Connection = Depends(get_db),
):
    """创建一个新的 MCP 连接。"""
    item = await mcp_service.create_connection(db, body.model_dump())
    return ApiResponse(success=True, data=item, message="MCP connection created")


@router.get("/{conn_id}", response_model=ApiResponse)
async def get_connection(
    conn_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """获取单个 MCP 连接详情（不返回 auth_config_enc）。"""
    item = await mcp_service.get_connection(db, conn_id)
    if not item:
        raise HTTPException(status_code=404, detail="MCP connection not found")
    return ApiResponse(success=True, data=item)


@router.put("/{conn_id}", response_model=ApiResponse)
async def update_connection(
    conn_id: str,
    body: McpConnectionUpdate,
    db: aiosqlite.Connection = Depends(get_db),
):
    """更新 MCP 连接配置。"""
    existing = await mcp_service.get_connection(db, conn_id)
    if not existing:
        raise HTTPException(status_code=404, detail="MCP connection not found")

    updated = await mcp_service.update_connection(
        db, conn_id, body.model_dump(exclude_unset=True)
    )
    return ApiResponse(success=True, data=updated, message="MCP connection updated")


@router.delete("/{conn_id}", response_model=ApiResponse)
async def delete_connection(
    conn_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """删除 MCP 连接。"""
    deleted = await mcp_service.delete_connection(db, conn_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="MCP connection not found")
    return ApiResponse(success=True, data=None, message="MCP connection deleted")


@router.post("/{conn_id}/test", response_model=ApiResponse)
async def test_connection(
    conn_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """测试 MCP 连接的连通性，返回健康状态和延迟。"""
    result = await mcp_service.test_connection(db, conn_id)
    return ApiResponse(
        success=result.get("connected", False),
        data=result,
        error=result.get("error"),
    )
