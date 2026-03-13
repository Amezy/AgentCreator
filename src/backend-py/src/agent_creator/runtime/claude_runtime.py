"""Claude Agent Runtime — 基于 Anthropic Python SDK"""

import logging
from typing import AsyncIterator

import anthropic

from agent_creator.runtime.base import AgentResponse, AgentRuntime

logger = logging.getLogger(__name__)

_MAX_TOOL_ITERATIONS = 10
_DEFAULT_MAX_TOKENS = 4096


class ClaudeRuntime(AgentRuntime):
    """Claude 模型的 Agent Runtime 实现。

    使用 Anthropic AsyncAnthropic 客户端，支持：
    - 单次对话（含 tool use 循环）
    - 流式输出
    """

    def __init__(self, api_key: str, model_id: str = "claude-sonnet-4-20250514"):
        self.client = anthropic.AsyncAnthropic(api_key=api_key)
        self.model_id = model_id

    # ------------------------------------------------------------------
    # execute — 单次对话（含 tool use 循环）
    # ------------------------------------------------------------------

    async def execute(
        self,
        prompt: str,
        system_prompt: str | None = None,
        tools: list[dict] | None = None,
        context: list[dict] | None = None,
    ) -> AgentResponse:
        """执行单次对话，如果模型返回 tool_use 则收集后返回。

        tool use 循环最多 ``_MAX_TOOL_ITERATIONS`` 次以防止无限调用。
        当前 MVP 阶段不会在 runtime 内部执行 tool，而是将 tool_calls
        返回给调用方，由 Tool Executor 负责实际执行。
        """
        messages: list[dict] = []

        # 历史上下文
        if context:
            messages.extend(context)

        # 当前用户消息
        messages.append({"role": "user", "content": prompt})

        # 构建请求公共参数
        kwargs: dict = {
            "model": self.model_id,
            "max_tokens": _DEFAULT_MAX_TOKENS,
            "messages": messages,
        }
        if system_prompt:
            kwargs["system"] = system_prompt
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        total_input_tokens = 0
        total_output_tokens = 0
        all_tool_calls: list[dict] = []

        response: anthropic.types.Message | None = None

        for _ in range(_MAX_TOOL_ITERATIONS):
            response = await self.client.messages.create(**kwargs)

            total_input_tokens += response.usage.input_tokens
            total_output_tokens += response.usage.output_tokens

            tool_use_blocks = [b for b in response.content if b.type == "tool_use"]

            if tool_use_blocks:
                for tu in tool_use_blocks:
                    all_tool_calls.append({
                        "id": tu.id,
                        "name": tu.name,
                        "input": tu.input,
                    })

                # 将 assistant 回复加入 messages 以保持上下文连续
                messages.append({"role": "assistant", "content": response.content})

                # MVP：不在 runtime 内执行 tool，直接返回 tool_calls
                break

            # 模型正常结束
            if response.stop_reason == "end_turn" or not tool_use_blocks:
                break

        # 提取文本内容
        final_text = ""
        if response is not None:
            for block in response.content:
                if hasattr(block, "text"):
                    final_text += block.text

        return AgentResponse(
            content=final_text,
            tool_calls=all_tool_calls if all_tool_calls else None,
            usage={
                "input_tokens": total_input_tokens,
                "output_tokens": total_output_tokens,
                "total_tokens": total_input_tokens + total_output_tokens,
            },
        )

    # ------------------------------------------------------------------
    # stream — 流式输出
    # ------------------------------------------------------------------

    async def stream(
        self,
        prompt: str,
        system_prompt: str | None = None,
        tools: list[dict] | None = None,
        context: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        """流式输出对话内容（仅返回 text delta）。"""
        messages: list[dict] = []
        if context:
            messages.extend(context)
        messages.append({"role": "user", "content": prompt})

        kwargs: dict = {
            "model": self.model_id,
            "max_tokens": _DEFAULT_MAX_TOKENS,
            "messages": messages,
        }
        if system_prompt:
            kwargs["system"] = system_prompt
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        async with self.client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text

    # ------------------------------------------------------------------
    # 内部工具格式转换
    # ------------------------------------------------------------------

    @staticmethod
    def _convert_tools(tools: list[dict]) -> list[dict]:
        """将内部 tool 格式转换为 Anthropic API 格式。

        内部格式可能使用 ``parameters`` 或 ``input_schema`` 作为 key，
        此方法统一转换为 Anthropic 要求的 ``input_schema``。
        """
        converted: list[dict] = []
        for tool in tools:
            converted.append({
                "name": tool["name"],
                "description": tool.get("description", ""),
                "input_schema": tool.get(
                    "input_schema",
                    tool.get("parameters", {"type": "object", "properties": {}}),
                ),
            })
        return converted
