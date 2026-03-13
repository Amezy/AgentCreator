# Sub-project 2: 对话模式 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将技能创建的 AI 对话面板从静态骨架改造为真正的 SSE 流式对话系统，支持三步引导（基本信息 → 工具资源 → 技能指令），对话输出实时同步到左侧表单和中间编辑器。

**Architecture:** 后端改造 `/api/v1/skills/ai-generate` 为真正的 SSE 端点，接收对话历史 + 当前表单状态 + 步骤号，调用模型池中的 LLM 生成结构化响应（form_update / tools_suggest / instructions_update 事件），前端 AIChatPanel 通过 EventSource 消费 SSE 流，解析事件类型分发到 SkillEditor 的表单和编辑器。

**Tech Stack:** Python FastAPI + SSE (StreamingResponse) + httpx (后端), React + TypeScript + EventSource API (前端)

**Spec:** `docs/superpowers/specs/2026-03-13-skill-system-design.md` — Section 3 + Section 8.1

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/backend-py/src/agent_creator/services/ai_skill_generator.py` | AI 技能生成服务：构建 system prompt、调用 LLM、解析结构化输出为 SSE 事件 |
| `src/frontend/src/pages/agent-creator/components/AIChatPanel.tsx` | AI 对话面板：SSE 消息流 + 步骤进度指示 + 模型选择 |
| `src/backend-py/tests/test_ai_generate.py` | AI 生成 API 测试 |

### Modified Files

| File | Changes |
|------|---------|
| `src/backend-py/src/agent_creator/api/skills.py` | 改造 `/ai-generate` 端点为真正的 SSE 流 |
| `src/frontend/src/pages/agent-creator/SkillEditor.tsx` | 右侧面板从骨架替换为 AIChatPanel，添加 SSE 事件处理 |
| `src/frontend/src/services/agentCreatorApi.ts` | 新增 SSE 请求辅助函数 |

---

## Chunk 1: 后端 — SSE 生成服务 + API 改造

### Task 1: AI 技能生成服务

**Files:**
- Create: `src/backend-py/src/agent_creator/services/ai_skill_generator.py`

- [ ] **Step 1: 创建 ai_skill_generator.py**

```python
"""AI skill generation service — drives the 3-step guided conversation."""

import json
import logging
from typing import AsyncGenerator

import aiosqlite
import httpx

from agent_creator.config import settings
from agent_creator.services.model_service import model_service

logger = logging.getLogger(__name__)

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
    {"type": "step_complete", "step": 1, "next_step": 2}
  ]
}

规则:
- message 字段必须始终存在，用于对话展示
- events 数组包含所有需要同步到表单/编辑器的结构化更新
- 根据当前步骤阶段生成对应的 events
- 不要在 message 中重复 events 的内容
"""


async def generate_skill_stream(
    db: aiosqlite.Connection,
    messages: list[dict],
    current_skill: dict,
    model_id: str | None,
    step: int,
) -> AsyncGenerator[str, None]:
    """Stream SSE events for AI skill generation.

    Yields SSE-formatted strings: 'data: {...}\\n\\n'
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

    try:
        # Call LLM API based on provider
        response_text = await _call_llm(model_config, llm_messages)

        # Parse structured response
        try:
            parsed = json.loads(response_text)
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
    provider = model_config.get("provider", "")

    if provider in ("claude", "anthropic"):
        return await _call_anthropic(model_config, messages)
    elif provider in ("zhipu", "glm"):
        return await _call_zhipu(model_config, messages)
    else:
        # Generic OpenAI-compatible API
        return await _call_openai_compatible(model_config, messages)


async def _call_anthropic(model_config: dict, messages: list[dict]) -> str:
    """Call Anthropic Claude API."""
    api_key = model_config.get("api_key", "")
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
    api_key = model_config.get("api_key", "")
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


async def _call_openai_compatible(model_config: dict, messages: list[dict]) -> str:
    """Call OpenAI-compatible API."""
    api_key = model_config.get("api_key", "")
    model_id = model_config.get("model_id", "gpt-4")
    base_url = model_config.get("base_url", "https://api.openai.com/v1")

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
```

- [ ] **Step 2: 验证模块导入**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator && python3 -c "
import sys; sys.path.insert(0, 'src/backend-py/src')
from agent_creator.services.ai_skill_generator import generate_skill_stream, _sse_event
print('Import OK')
print('SSE format:', repr(_sse_event({'type': 'message', 'content': 'hello'})))
"`
Expected: Import OK, SSE format shows `data: {...}\n\n`

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/src/agent_creator/services/ai_skill_generator.py
git commit -m "feat(service): add AI skill generation service with multi-provider LLM support"
```

---

### Task 2: 改造 /ai-generate 端点为 SSE

**Files:**
- Modify: `src/backend-py/src/agent_creator/api/skills.py`

- [ ] **Step 1: 更新 import 和请求模型**

在 `skills.py` 顶部添加导入:

```python
from fastapi.responses import StreamingResponse
from agent_creator.services.ai_skill_generator import generate_skill_stream
```

更新 `AiGenerateRequest` 模型（约第 42-49 行），添加 `step` 字段:

```python
class AiGenerateRequest(BaseModel):
    model_id: str | None = None
    messages: list[dict] = []
    current_skill: dict = {}
    step: int = 1
```

- [ ] **Step 2: 改造 ai_generate 路由处理函数**

将现有的 `/ai-generate` 路由（约第 133-139 行）替换为:

```python
@router.post("/ai-generate")
async def ai_generate(
    body: AiGenerateRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """AI-assisted skill generation via SSE stream."""
    return StreamingResponse(
        generate_skill_stream(
            db=db,
            messages=body.messages,
            current_skill=body.current_skill,
            model_id=body.model_id,
            step=body.step,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/src/agent_creator/api/skills.py
git commit -m "feat(api): convert /ai-generate to real SSE streaming endpoint"
```

---

### Task 3: 后端测试 — AI 生成 API

**Files:**
- Create: `src/backend-py/tests/test_ai_generate.py`

- [ ] **Step 1: 编写 AI 生成 API 测试**

```python
"""Tests for AI skill generation SSE endpoint."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_ai_generate_returns_sse_content_type(client: AsyncClient):
    """POST /api/v1/agent/skills/ai-generate should return SSE content type."""
    resp = await client.post(
        "/api/v1/agent/skills/ai-generate",
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
        "/api/v1/agent/skills/ai-generate",
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
        "/api/v1/agent/skills/ai-generate",
        json={"messages": [], "step": 1},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_ai_generate_accepts_all_steps(client: AsyncClient):
    """Steps 1, 2, 3 should all be accepted."""
    for step in [1, 2, 3]:
        resp = await client.post(
            "/api/v1/agent/skills/ai-generate",
            json={"messages": [{"role": "user", "content": "test"}], "step": step},
        )
        assert resp.status_code == 200
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python -m pytest tests/test_ai_generate.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/tests/test_ai_generate.py
git commit -m "test: add AI generate SSE endpoint tests"
```

---

## Chunk 2: 前端 — AIChatPanel + SSE 集成

### Task 4: SSE 请求辅助函数

**Files:**
- Modify: `src/frontend/src/services/agentCreatorApi.ts`

- [ ] **Step 1: 添加 SSE 请求辅助函数**

在 `agentCreatorApi.ts` 文件末尾添加:

```typescript
// ─── SSE Helpers ────────────────────────────────────
export interface SSEEvent {
  type: 'message' | 'form_update' | 'tools_suggest' | 'instructions_update' | 'step_complete' | 'error' | 'done';
  content?: string;
  field?: string;
  value?: string;
  tools?: string[];
  labels?: Record<string, string>;
  step?: number;
  next_step?: number;
  message?: string;
  code?: string;
}

export async function fetchSSE(
  url: string,
  body: Record<string, unknown>,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem('jwt_token');
  const resp = await fetch(`${AGENT_API_BASE}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`SSE request failed: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event: SSEEvent = JSON.parse(line.slice(6));
          onEvent(event);
        } catch {
          // Skip malformed events
        }
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/services/agentCreatorApi.ts
git commit -m "feat(frontend): add SSE fetch helper for streaming AI responses"
```

---

### Task 5: AIChatPanel 组件

**Files:**
- Create: `src/frontend/src/pages/agent-creator/components/AIChatPanel.tsx`

- [ ] **Step 1: 创建 AIChatPanel 组件**

```tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { fetchSSE, SSEEvent } from '../../../services/agentCreatorApi';
import { modelApi } from '../../../services/agentCreatorApi';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AIChatPanelProps {
  step: number;
  currentSkill: Record<string, unknown>;
  onFormUpdate: (field: string, value: string) => void;
  onToolsSuggest: (tools: string[]) => void;
  onInstructionsUpdate: (content: string) => void;
  onStepComplete: (nextStep: number) => void;
}

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

const STEP_LABELS = ['', '基本信息', '工具与资源', '技能指令'];
const STEP_HINTS = [
  '',
  '描述你想创建的技能，AI 会自动提取名称、分类等基本信息',
  '确认或调整 AI 推荐的工具列表',
  'AI 将生成完整的 Markdown 技能指令，你可以在编辑器中修改',
];

const AIChatPanel: React.FC<AIChatPanelProps> = ({
  step,
  currentSkill,
  onFormUpdate,
  onToolsSuggest,
  onInstructionsUpdate,
  onStepComplete,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    modelApi.list().then((data: ModelOption[]) => {
      setModels(data);
      if (data.length > 0 && !selectedModel) {
        setSelectedModel(data[0].id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initial greeting
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: `👋 你好！我是技能设计助手。\n\n**Step ${step}/3: ${STEP_LABELS[step]}**\n\n${STEP_HINTS[step]}`,
      }]);
    }
  }, []);

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case 'message':
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && streamingRef.current) {
            return [...prev.slice(0, -1), { ...last, content: last.content + (event.content ?? '') }];
          }
          return [...prev, { role: 'assistant', content: event.content ?? '' }];
        });
        break;
      case 'form_update':
        if (event.field && event.value !== undefined) {
          onFormUpdate(event.field, event.value);
        }
        break;
      case 'tools_suggest':
        if (event.tools) {
          onToolsSuggest(event.tools);
        }
        break;
      case 'instructions_update':
        if (event.content) {
          onInstructionsUpdate(event.content);
        }
        break;
      case 'step_complete':
        if (event.next_step) {
          onStepComplete(event.next_step);
        }
        break;
      case 'error':
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ ${event.message ?? '发生错误'}`,
        }]);
        break;
      case 'done':
        streamingRef.current = false;
        setStreaming(false);
        break;
    }
  }, [onFormUpdate, onToolsSuggest, onInstructionsUpdate, onStepComplete]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    streamingRef.current = true;
    setStreaming(true);

    // Add empty assistant message placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await fetchSSE(
        '/skills/ai-generate',
        {
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          current_skill: currentSkill,
          model_id: selectedModel || undefined,
          step,
        },
        handleSSEEvent,
        controller.signal,
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⚠️ 连接中断，请重试',
        }]);
      }
    } finally {
      streamingRef.current = false;
      setStreaming(false);
    }
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    streamingRef.current = false;
    setStreaming(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header: Model selector + Step indicator */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Step {step}/3</span>
          <span className="text-xs text-blue-600 font-medium">{STEP_LABELS[step]}</span>
        </div>
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
        >
          {models.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-800'
            }`}>
              {msg.content || (streaming && i === messages.length - 1 ? '...' : '')}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={STEP_HINTS[step]}
            className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
            disabled={streaming}
          />
          {streaming ? (
            <button
              onClick={stopStreaming}
              className="px-3 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600"
            >
              停止
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIChatPanel;
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/pages/agent-creator/components/AIChatPanel.tsx
git commit -m "feat(frontend): add AIChatPanel component with SSE streaming"
```

---

### Task 6: SkillEditor 集成 AIChatPanel

**Files:**
- Modify: `src/frontend/src/pages/agent-creator/SkillEditor.tsx`

- [ ] **Step 1: 添加 AIChatPanel 导入**

在 SkillEditor.tsx 顶部添加:

```typescript
import AIChatPanel from './components/AIChatPanel';
```

- [ ] **Step 2: 添加对话步骤状态**

在组件 state 区域添加:

```typescript
  const [aiStep, setAiStep] = useState(1);
```

- [ ] **Step 3: 添加 SSE 事件处理函数**

在 `handleTemplateSelect` 函数之后添加:

```typescript
  const handleAIFormUpdate = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleAIToolsSuggest = (tools: string[]) => {
    setForm(prev => ({ ...prev, opencode_tools: tools }));
  };

  const handleAIInstructionsUpdate = (content: string) => {
    setForm(prev => ({ ...prev, instructions: content }));
  };

  const handleAIStepComplete = (nextStep: number) => {
    setAiStep(nextStep);
  };
```

- [ ] **Step 4: 替换右侧 AI 面板内容**

找到右侧 AI 面板的 JSX（约第 370-393 行的 `skill-editor-ai-panel` div），将内部的静态占位内容替换为:

```tsx
{showAiPanel && (
  <aside className="skill-editor-ai-panel">
    <AIChatPanel
      step={aiStep}
      currentSkill={form as unknown as Record<string, unknown>}
      onFormUpdate={handleAIFormUpdate}
      onToolsSuggest={handleAIToolsSuggest}
      onInstructionsUpdate={handleAIInstructionsUpdate}
      onStepComplete={handleAIStepComplete}
    />
  </aside>
)}
```

- [ ] **Step 5: 验证前端编译**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/frontend && npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/pages/agent-creator/SkillEditor.tsx
git commit -m "feat(frontend): integrate AIChatPanel into SkillEditor with SSE event handlers"
```

---

### Task 7: 全量测试 + 构建验证

- [ ] **Step 1: 运行后端测试**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 2: 前端构建**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/frontend && npx vite build`
Expected: Build succeeds

- [ ] **Step 3: 最终 Commit**

```bash
git add src/backend-py/src/agent_creator/services/ai_skill_generator.py \
       src/backend-py/src/agent_creator/api/skills.py \
       src/backend-py/tests/test_ai_generate.py \
       src/frontend/src/services/agentCreatorApi.ts \
       src/frontend/src/pages/agent-creator/components/AIChatPanel.tsx \
       src/frontend/src/pages/agent-creator/SkillEditor.tsx
git commit -m "feat: complete sub-project 2 — conversation mode with SSE streaming"
```
