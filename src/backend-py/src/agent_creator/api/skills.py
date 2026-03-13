"""Skills pool API - manage reusable agent skills / tool definitions."""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel

import aiosqlite

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.skill_service import skill_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class SkillCreate(BaseModel):
    name: str
    description: str | None = None
    category: str
    complexity: str
    recommended_model_tier: str
    instructions: str | None = None
    opencode_tools: list[str] | None = None
    mcp_ids: list[str] | None = None
    applicable_positions: list[str] | None = None
    applicable_min_level: str = "junior"


class SkillUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    complexity: str | None = None
    recommended_model_tier: str | None = None
    instructions: str | None = None
    opencode_tools: list[str] | None = None
    mcp_ids: list[str] | None = None
    applicable_positions: list[str] | None = None
    applicable_min_level: str | None = None
    is_active: bool | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=ApiResponse)
async def list_skills(
    category: Optional[str] = Query(None),
    complexity: Optional[str] = Query(None),
    position_id: Optional[str] = Query(None),
    level: Optional[str] = Query(None, alias="min_level"),
    is_preset: Optional[bool] = Query(None),
    is_active: Optional[bool] = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
):
    """获取技能列表，支持多维度过滤"""
    skills = await skill_service.list_skills(
        db,
        category=category,
        complexity=complexity,
        position_id=position_id,
        min_level=level,
        is_preset=is_preset,
        is_active=is_active,
    )
    return ApiResponse(success=True, data=skills)


@router.post("", response_model=ApiResponse, status_code=201)
async def create_skill(
    body: SkillCreate,
    db: aiosqlite.Connection = Depends(get_db),
):
    """创建自定义技能"""
    skill = await skill_service.create_skill(db, body.model_dump())
    return ApiResponse(success=True, data=skill, message="技能创建成功")


@router.post("/parse-skillmd", response_model=ApiResponse)
async def parse_skillmd(file: UploadFile = File(...)):
    """上传 SKILL.md 文件，解析 frontmatter + 正文"""
    if file.filename and not file.filename.endswith('.md'):
        raise HTTPException(status_code=400, detail="请上传 .md 文本文件")
    content = await file.read()
    if len(content) > 512 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过限制（最大 512KB）")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="请上传 .md 文本文件")

    from agent_creator.services.skillmd_parser import parse_skillmd as _parse
    try:
        result = _parse(text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return ApiResponse(success=True, data={
        "name": result.name,
        "description": result.description,
        "category": result.category,
        "complexity": result.complexity,
        "recommended_model_tier": result.recommended_model_tier,
        "opencode_tools": result.opencode_tools,
        "applicable_min_level": result.applicable_min_level,
        "instructions": result.instructions,
    })


@router.get("/available-tools", response_model=ApiResponse)
async def get_available_tools():
    """获取可绑定的预置工具列表（代理 OpenCode）"""
    from agent_creator.services.opencode_gateway import get_available_tools as fetch_tools
    tools = await fetch_tools()
    return ApiResponse(success=True, data=tools)


class AiGenerateRequest(BaseModel):
    messages: list[dict]
    current_skill: dict | None = None
    model_id: str | None = None

@router.post("/ai-generate")
async def ai_generate_skill(body: AiGenerateRequest):
    """AI 辅助生成技能指令（SSE 流式响应）- 骨架实现"""
    async def generate():
        yield 'data: {"type": "text", "content": "AI 辅助生成功能正在开发中，请先使用手动编写模式。"}\n\n'
        yield 'data: {"type": "done"}\n\n'
    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/for-position/{position_id}", response_model=ApiResponse)
async def get_skills_for_position(
    position_id: str,
    level: str = Query("junior"),
    db: aiosqlite.Connection = Depends(get_db),
):
    """根据岗位+等级获取可用技能（推荐/可选/不可选）"""
    result = await skill_service.get_skills_for_position(db, position_id, level)
    return ApiResponse(success=True, data=result)


@router.get("/{skill_id}", response_model=ApiResponse)
async def get_skill(
    skill_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """获取技能详情"""
    skill = await skill_service.get_skill(db, skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="技能不存在")
    return ApiResponse(success=True, data=skill)


@router.put("/{skill_id}", response_model=ApiResponse)
async def update_skill(
    skill_id: str,
    body: SkillUpdate,
    db: aiosqlite.Connection = Depends(get_db),
):
    """更新技能"""
    skill = await skill_service.update_skill(
        db, skill_id, body.model_dump(exclude_none=True)
    )
    if skill is None:
        raise HTTPException(status_code=404, detail="技能不存在")
    return ApiResponse(success=True, data=skill, message="技能更新成功")


@router.delete("/{skill_id}", response_model=ApiResponse)
async def delete_skill(
    skill_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """删除技能（预置技能不可删除，被引用的技能需先解绑）"""
    try:
        deleted = await skill_service.delete_skill(db, skill_id)
    except ValueError as e:
        error_msg = str(e)
        status = 403 if "预置" in error_msg else 400
        raise HTTPException(status_code=status, detail=error_msg)
    if not deleted:
        raise HTTPException(status_code=404, detail="技能不存在")
    return ApiResponse(success=True, message="技能删除成功")


@router.post("/{skill_id}/export")
async def export_skill(
    skill_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """导出技能为 SKILL.md 格式"""
    content = await skill_service.export_as_skillmd(db, skill_id)
    if content is None:
        raise HTTPException(status_code=404, detail="技能不存在")
    return PlainTextResponse(content, media_type="text/markdown")
