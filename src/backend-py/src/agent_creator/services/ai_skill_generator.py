"""AI skill generation service — drives the 3-step guided conversation."""

import asyncio
import json
import logging
import os
from typing import AsyncGenerator

import aiosqlite
import httpx

from agent_creator.config import settings
from agent_creator.services.model_service import model_service

logger = logging.getLogger(__name__)


def _resolve_api_key(model_config: dict) -> str:
    """Extract API key from model config.

    Currently keys are stored as plaintext in api_key_enc.
    This helper centralises the lookup so encryption can be added later.
    """
    return model_config.get("api_key_enc", "") or model_config.get("api_key", "")

STEP_PROMPTS = {
    1: "你正在帮助用户创建一个新技能。根据用户的描述，提取技能名称(name)、分类(category: engineering/consulting/general)、描述(description)、复杂度(complexity: basic/medium/complex/special)、推荐模型等级(recommended_model_tier: basic/medium/advanced)。以 JSON 格式输出 form_updates 数组，每项包含 field 和 value。然后用自然语言确认并引导用户进入工具选择。",
    2: "根据技能类型推荐合适的工具。可选工具: read(阅读文件), edit(编辑文件), write(创建文件), ls(浏览目录), glob(查找文件), grep(搜索内容), codesearch(代码搜索), bash(运行命令), webfetch(访问网页), websearch(搜索网络)。输出 tools_suggest 包含推荐工具 ID 列表和 labels 字段（每个工具 ID 对应中文显示名，如 {\"read\": \"📖 阅读文件\"}）。然后引导用户确认或调整。",
    3: "根据已确定的技能信息和工具，生成完整的 Markdown 格式技能指令。包含: 角色定义、执行流程、输出格式、约束条件。输出 instructions_update 包含完整 Markdown 内容。",
}

SYSTEM_PROMPT = """你是 AgentCreator 的技能设计助手，帮助用户创建 AI 技能。

你的回复必须是合法的 JSON，格式如下:
{
  "message": "给用户看的自然语言回复",
  "events": [
    {"type": "form_update", "field": "name", "value": "代码审查"},
    {"type": "tools_suggest", "tools": ["read", "grep", "bash"], "labels": {"read": "📖 阅读文件", "grep": "🔍 搜索内容", "bash": "⚡ 运行命令"}},
    {"type": "instructions_update", "content": "# 代码审查\\n..."},
    {"type": "step_complete", "step": 1, "next_step": 2},
    {"type": "user_choices", "question": "选择分类", "choices": [{"id": "engineering", "label": "🔧 工程"}, {"id": "consulting", "label": "💼 咨询"}, {"id": "general", "label": "📋 通用"}], "field": "category"}
  ]
}

事件类型说明:
- form_update: 直接更新表单字段
- tools_suggest: 推荐工具列表
- instructions_update: 更新指令编辑器
- step_complete: 步骤完成，跳到下一步
- user_choices: 给用户展示选项卡让用户选择（必须用于所有需要用户确认/选择的场景），每个选项包含 id 和 label

规则:
- message 字段必须始终存在，用于对话展示
- events 数组包含所有需要同步到表单/编辑器的结构化更新
- 当有多个候选值时（如分类、复杂度），必须使用 user_choices 事件让用户选择，而不是直接设值
- 根据当前步骤阶段生成对应的 events
- 【严格】当 events 中包含 user_choices 时，message 中绝对不要提及选项内容、不要列出候选项、不要重复 question 的文字。message 只写简短的上下文说明即可（如"我来帮你确认几个配置："），选项展示完全由 user_choices 事件负责
- 【严格】不要在 message 中重复任何 events 中已包含的信息（如表单值、工具列表、选项等）
"""


async def generate_skill_stream(
    db: aiosqlite.Connection,
    messages: list[dict],
    current_skill: dict,
    model_id: str | None,
    step: int,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for AI skill generation.

    Yields SSE-formatted strings: 'data: {...}\n\n'
    """
    # Build conversation for LLM
    step_instruction = STEP_PROMPTS.get(step, STEP_PROMPTS[1])

    system_content = f"{SYSTEM_PROMPT}\n\n当前步骤: {step}/3\n步骤指令: {step_instruction}\n\n当前技能状态: {json.dumps(current_skill, ensure_ascii=False)}"

    llm_messages = [{"role": "system", "content": system_content}]
    for msg in messages:
        llm_messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})

    # Get model config
    model_config = None
    if model_id:
        model_config = await model_service.get_model(db, model_id)

    if not model_config:
        # Fallback: use first available model
        models = await model_service.list_models(db)
        if models:
            model_config = models[0]

    if not model_config:
        yield _sse_event({"type": "error", "message": "没有可用的模型，请先在模型池中配置"})
        yield _sse_event({"type": "done"})
        return

    logger.info(
        "AI generate: provider=%s model=%s auth=%s msg_count=%d",
        model_config.get("provider"),
        model_config.get("model_id"),
        model_config.get("auth_method", "api_key"),
        len(llm_messages),
    )

    try:
        # Call LLM API based on provider
        response_text = await _call_llm(model_config, llm_messages)

        # Strip markdown code fences that LLMs often wrap around JSON
        cleaned = response_text.strip()
        if cleaned.startswith("```"):
            # Remove opening fence (```json or ```)
            first_newline = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
            cleaned = cleaned[first_newline + 1:]
            # Remove closing fence
            if cleaned.rstrip().endswith("```"):
                cleaned = cleaned.rstrip()[:-3].rstrip()

        # Parse structured response
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            # LLM didn't return valid JSON, wrap as message
            yield _sse_event({"type": "message", "content": response_text})
            yield _sse_event({"type": "done"})
            return

        # Emit message event
        if parsed.get("message"):
            yield _sse_event({"type": "message", "content": parsed["message"]})

        # Emit structured events
        for event in parsed.get("events", []):
            yield _sse_event(event)

        yield _sse_event({"type": "done"})

    except Exception as e:
        logger.exception("AI generation failed")
        yield _sse_event({"type": "error", "message": f"生成失败: {str(e)}"})
        yield _sse_event({"type": "done"})


async def _call_llm(model_config: dict, messages: list[dict]) -> str:
    """Call the LLM API and return the response text."""
    provider = (model_config.get("provider", "") or "").lower()
    auth_method = (model_config.get("auth_method", "") or "").lower()

    if provider in ("claude", "anthropic"):
        if auth_method == "cli_auth":
            return await _call_claude_cli(model_config, messages)
        return await _call_anthropic(model_config, messages)
    elif provider in ("zhipu", "glm"):
        return await _call_zhipu(model_config, messages)
    elif provider == "google":
        return await _call_google_gemini(model_config, messages)
    else:
        # Generic OpenAI-compatible API
        return await _call_openai_compatible(model_config, messages)


async def _call_claude_cli(model_config: dict, messages: list[dict]) -> str:
    """Call Claude via CC CLI using existing OAuth authentication."""
    model_id = model_config.get("model_id", "claude-sonnet-4-6")

    # Extract system message and build user prompt
    system_content = ""
    user_parts = []
    for msg in messages:
        if msg["role"] == "system":
            system_content += msg["content"] + "\n"
        else:
            user_parts.append(msg["content"])

    prompt_text = "\n\n".join(user_parts)

    # Build command
    cmd = ["claude", "-p", "--model", model_id, "--output-format", "text"]

    # Clean environment: remove vars that block nested CC CLI sessions
    env = {k: v for k, v in os.environ.items()
           if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}

    # Pass system prompt via --system-prompt if available
    if system_content.strip():
        cmd.extend(["--system-prompt", system_content.strip()])

    logger.info("Calling Claude CLI: model=%s prompt_len=%d", model_id, len(prompt_text))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    stdout, stderr = await asyncio.wait_for(
        proc.communicate(input=prompt_text.encode()),
        timeout=120,
    )

    if proc.returncode != 0:
        err_msg = stderr.decode().strip()
        logger.error("Claude CLI failed (rc=%d): %s", proc.returncode, err_msg)
        raise RuntimeError(f"Claude CLI 调用失败: {err_msg[:300]}")

    return stdout.decode().strip()


async def _call_anthropic(model_config: dict, messages: list[dict]) -> str:
    """Call Anthropic Claude API."""
    api_key = _resolve_api_key(model_config)
    model_id = model_config.get("model_id", "claude-sonnet-4-20250514")

    # Extract system message
    system_content = ""
    chat_messages = []
    for msg in messages:
        if msg["role"] == "system":
            system_content += msg["content"] + "\n"
        else:
            chat_messages.append(msg)

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model_id,
                "max_tokens": 4096,
                "system": system_content.strip(),
                "messages": chat_messages,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["content"][0]["text"]


async def _call_zhipu(model_config: dict, messages: list[dict]) -> str:
    """Call ZhipuAI GLM API."""
    api_key = _resolve_api_key(model_config)
    model_id = model_config.get("model_id", "glm-4")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_id,
                "messages": messages,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def _call_google_gemini(model_config: dict, messages: list[dict]) -> str:
    """Call Google Gemini API (OpenAI-compatible endpoint)."""
    api_key = _resolve_api_key(model_config)
    model_id = model_config.get("model_id", "gemini-2.0-flash")
    base_url = (
        model_config.get("endpoint", "")
        or "https://generativelanguage.googleapis.com/v1beta/openai"
    )

    # Gemini's OpenAI-compatible endpoint uses standard messages format
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_id,
                "messages": messages,
            },
        )
        if resp.status_code != 200:
            body = resp.text
            logger.error("Gemini API error %s: %s", resp.status_code, body)
            raise RuntimeError(f"Gemini API 返回 {resp.status_code}: {body[:300]}")
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def _call_openai_compatible(model_config: dict, messages: list[dict]) -> str:
    """Call OpenAI-compatible API."""
    api_key = _resolve_api_key(model_config)
    model_id = model_config.get("model_id", "gpt-4")
    base_url = model_config.get("endpoint", "") or model_config.get("base_url", "https://api.openai.com/v1")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_id,
                "messages": messages,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


def _sse_event(data: dict) -> str:
    """Format a dict as an SSE event string."""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
