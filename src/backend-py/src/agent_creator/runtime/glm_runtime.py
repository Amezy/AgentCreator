"""GLM Agent Runtime — 基于智谱 zhipuai SDK

zhipuai SDK 是同步的，所有调用通过 asyncio.to_thread 包装为异步。
GLM 支持 function calling，但不支持并行 tool calls 和 streaming tool use。
"""

import asyncio
import json
import logging
import queue
import threading
from typing import AsyncIterator

from zhipuai import ZhipuAI

from agent_creator.runtime.base import AgentResponse, AgentRuntime

logger = logging.getLogger(__name__)

# Tool 调用循环最大迭代次数
_MAX_TOOL_ITERATIONS = 10
_DEFAULT_MAX_TOKENS = 4096


class GLMRuntime(AgentRuntime):
    """智谱 GLM 模型的 Agent Runtime 实现。

    GLM 支持 function calling，但不支持：
    - 并行 tool calls
    - streaming tool use
    - hooks 系统

    Runtime 内部不执行 tool，而是将 tool_calls 返回给调用方，
    由调用方执行后通过 context 传回结果继续对话（与 ClaudeRuntime 行为一致）。
    """

    def __init__(
        self,
        api_key: str,
        model_id: str = "glm-4",
        max_tokens: int = _DEFAULT_MAX_TOKENS,
    ):
        self.client = ZhipuAI(api_key=api_key)
        self.model_id = model_id
        self.max_tokens = max_tokens

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def execute(
        self,
        prompt: str,
        system_prompt: str | None = None,
        tools: list[dict] | None = None,
        context: list[dict] | None = None,
    ) -> AgentResponse:
        """执行单次对话（含 tool 调用循环）。

        GLM 的 function calling 流程：
        1. 发送消息 + tools 定义
        2. 如果返回 tool_calls，收集后返回给调用方
        3. 调用方执行 tool 后，将结果通过 context 传回继续对话
        """
        messages = self._build_messages(prompt, system_prompt, context)

        kwargs: dict = {
            "model": self.model_id,
            "messages": messages,
            "max_tokens": self.max_tokens,
        }
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        total_usage = {"input_tokens": 0, "output_tokens": 0}
        all_tool_calls: list[dict] = []
        final_content = ""

        for _ in range(_MAX_TOOL_ITERATIONS):
            # zhipuai SDK 是同步的，放到线程池执行
            response = await asyncio.to_thread(
                self.client.chat.completions.create, **kwargs
            )

            # 累计 token 用量
            if response.usage:
                total_usage["input_tokens"] += response.usage.prompt_tokens
                total_usage["output_tokens"] += response.usage.completion_tokens

            choice = response.choices[0]
            message = choice.message

            # 有 tool calls → 收集后返回，由调用方执行
            if message.tool_calls:
                for tc in message.tool_calls:
                    tool_call_data = {
                        "id": tc.id,
                        "name": tc.function.name,
                        "input": self._parse_arguments(tc.function.arguments),
                    }
                    all_tool_calls.append(tool_call_data)

                if message.content:
                    final_content = message.content
                # MVP: 不在 runtime 内部继续循环，交由调用方处理
                break

            # 无 tool calls，提取文本
            if message.content:
                final_content = message.content

            if choice.finish_reason in ("stop", "length"):
                break

        return AgentResponse(
            content=final_content,
            tool_calls=all_tool_calls or None,
            usage={
                "input_tokens": total_usage["input_tokens"],
                "output_tokens": total_usage["output_tokens"],
                "total_tokens": total_usage["input_tokens"] + total_usage["output_tokens"],
            },
        )

    async def stream(
        self,
        prompt: str,
        system_prompt: str | None = None,
        tools: list[dict] | None = None,
        context: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        """流式输出对话。

        zhipuai 的流式返回是同步迭代器，通过 queue + daemon thread
        桥接为 async iterator。
        """
        messages = self._build_messages(prompt, system_prompt, context)

        kwargs: dict = {
            "model": self.model_id,
            "messages": messages,
            "max_tokens": self.max_tokens,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        # zhipuai 同步流式调用，放到线程池
        response = await asyncio.to_thread(
            self.client.chat.completions.create, **kwargs
        )

        # 用 queue 把同步迭代器桥接为异步
        q: queue.Queue[str | None] = queue.Queue()

        def _consume() -> None:
            try:
                for chunk in response:
                    if (
                        chunk.choices
                        and chunk.choices[0].delta
                        and chunk.choices[0].delta.content
                    ):
                        q.put(chunk.choices[0].delta.content)
            except Exception as exc:
                logger.error("GLM stream error: %s", exc)
            finally:
                q.put(None)  # 结束信号

        thread = threading.Thread(target=_consume, daemon=True)
        thread.start()

        while True:
            try:
                text = await asyncio.to_thread(q.get, timeout=30)
            except Exception:
                break
            if text is None:
                break
            yield text

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_messages(
        prompt: str,
        system_prompt: str | None,
        context: list[dict] | None,
    ) -> list[dict]:
        """组装 messages 列表。"""
        messages: list[dict] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        if context:
            messages.extend(context)
        messages.append({"role": "user", "content": prompt})
        return messages

    @staticmethod
    def _convert_tools(tools: list[dict]) -> list[dict]:
        """将内部 tool 格式转换为 GLM function calling 格式。

        内部格式可能使用 ``input_schema`` 或 ``parameters`` 来描述参数 schema，
        统一转为 OpenAI 兼容的 ``parameters`` 字段。
        """
        converted = []
        for tool in tools:
            parameters = tool.get(
                "input_schema",
                tool.get("parameters", {"type": "object", "properties": {}}),
            )
            converted.append({
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": parameters,
                },
            })
        return converted

    @staticmethod
    def _parse_arguments(raw: str | None) -> dict:
        """安全解析 tool call 的 arguments JSON。"""
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return {"raw": raw}
