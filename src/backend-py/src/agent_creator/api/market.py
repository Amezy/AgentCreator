"""Market proxy API - forwards requests to WorkX-Market service."""

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Query

from agent_creator.models.schemas import ApiResponse

logger = logging.getLogger(__name__)

router = APIRouter()

MARKET_API_BASE = os.environ.get("MARKET_API_URL", "http://121.199.63.30:9091/api/v1")


@router.get("/items", response_model=ApiResponse)
async def list_market_items(
    type: Optional[str] = Query(None, description="Item type: connector, skill, plugin"),
    q: Optional[str] = Query(None, description="Search keyword"),
    category: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    sort: str = Query("popular", pattern="^(popular|newest|rating)$"),
):
    """代理转发市场列表请求到 WorkX-Market 服务。"""
    params: dict[str, str | int] = {"page": page, "pageSize": pageSize, "sort": sort}
    if type:
        params["type"] = type
    if q:
        params["q"] = q
    if category:
        params["category"] = category

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{MARKET_API_BASE}/market/items", params=params)
            data = resp.json()
        return ApiResponse(success=True, data=data)
    except Exception as e:
        logger.warning("Market API request failed: %s", e)
        return ApiResponse(success=False, error=f"市场服务不可用: {e}")


@router.get("/items/{item_id}", response_model=ApiResponse)
async def get_market_item_detail(item_id: str):
    """获取市场条目详情（含 installConfig 和 userConfigSchema）。"""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{MARKET_API_BASE}/market/items/{item_id}")
            if resp.status_code == 404:
                return ApiResponse(success=False, error="条目不存在")
            data = resp.json()
        return ApiResponse(success=True, data=data)
    except Exception as e:
        logger.warning("Market API detail request failed: %s", e)
        return ApiResponse(success=False, error=f"市场服务不可用: {e}")


@router.post("/items/{item_id}/install", response_model=ApiResponse)
async def record_install(item_id: str):
    """记录安装行为（通知市场服务增加安装计数）。"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{MARKET_API_BASE}/market/items/{item_id}/install",
                json={"version": "latest"},
            )
            data = resp.json()
        return ApiResponse(success=True, data=data)
    except Exception as e:
        logger.warning("Market install record failed: %s", e)
        return ApiResponse(success=True, data=None)  # 不影响安装流程
