"""Agent Orchestrator — 管理 Agent 并发和调度"""
import asyncio
import json
import logging

from .base import AgentRuntime, AgentResponse
from .claude_runtime import ClaudeRuntime
from .glm_runtime import GLMRuntime
from .tool_executor import ToolExecutor, tool_executor

logger = logging.getLogger(__name__)


class AgentOrchestrator:
    """Agent 编排器

    职责：
    1. 根据模型配置创建对应的 Runtime
    2. 管理并发（Semaphore 限制同时运行的 Agent 数）
    3. 执行 tool calls 并将结果回传 Agent
    4. 模型降级处理（同等级 Claude <-> GLM）
    """

    def __init__(self, max_concurrent: int = 5):
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._active_agents: dict[str, AgentRuntime] = {}
        self._tool_executor = tool_executor

    def create_runtime(
        self, provider: str, api_key: str, model_id: str
    ) -> AgentRuntime:
        """根据 provider 创建对应的 Runtime"""
        if provider == "claude":
            return ClaudeRuntime(api_key=api_key, model_id=model_id)
        elif provider == "glm":
            return GLMRuntime(api_key=api_key, model_id=model_id)
        else:
            raise ValueError(f"Unsupported provider: {provider}")

    async def run_agent(
        self,
        persona_id: str,
        runtime: AgentRuntime,
        prompt: str,
        system_prompt: str | None = None,
        tools: list[dict] | None = None,
        context: list[dict] | None = None,
        mcp_connections: list[dict] | None = None,
        max_tool_rounds: int = 5,
    ) -> AgentResponse:
        """运行 Agent（带并发控制和 tool 执行循环）

        完整流程：
        1. 获取 semaphore 许可
        2. 调用 runtime.execute
        3. 如果有 tool_calls，执行工具，将结果追加到 context 继续对话
        4. 重复 2-3 直到无 tool_calls 或达到最大轮次
        """
        async with self._semaphore:
            self._active_agents[persona_id] = runtime
            try:
                current_context = list(context or [])
                response: AgentResponse | None = None

                for round_num in range(max_tool_rounds):
                    response = await runtime.execute(
                        prompt=prompt if round_num == 0 else "",
                        system_prompt=system_prompt,
                        tools=tools,
                        context=current_context if round_num > 0 else context,
                    )

                    if not response.tool_calls:
                        return response

                    # 执行 tool calls
                    tool_results = await self._tool_executor.execute_tool_calls(
                        response.tool_calls, mcp_connections
                    )

                    # 构建 tool 结果消息，追加到上下文
                    # Claude 格式
                    if isinstance(runtime, ClaudeRuntime):
                        # 添加 assistant 的 tool_use 回复
                        assistant_content: list[dict] = []
                        for tc in response.tool_calls:
                            assistant_content.append(
                                {
                                    "type": "tool_use",
                                    "id": tc["id"],
                                    "name": tc["name"],
                                    "input": tc["input"],
                                }
                            )
                        if response.content:
                            assistant_content.insert(
                                0, {"type": "text", "text": response.content}
                            )
                        current_context.append(
                            {"role": "assistant", "content": assistant_content}
                        )

                        # 添加 tool_result
                        tool_result_content: list[dict] = []
                        for tr in tool_results:
                            tool_result_content.append(
                                {
                                    "type": "tool_result",
                                    "tool_use_id": tr["tool_call_id"],
                                    "content": str(
                                        tr.get("result", tr.get("error", ""))
                                    ),
                                }
                            )
                        current_context.append(
                            {"role": "user", "content": tool_result_content}
                        )

                    # GLM 格式
                    elif isinstance(runtime, GLMRuntime):
                        # 添加 assistant 的 tool_calls 回复
                        current_context.append(
                            {
                                "role": "assistant",
                                "content": response.content or "",
                                "tool_calls": [
                                    {
                                        "id": tc["id"],
                                        "type": "function",
                                        "function": {
                                            "name": tc["name"],
                                            "arguments": json.dumps(
                                                tc["input"]
                                            ),
                                        },
                                    }
                                    for tc in response.tool_calls
                                ],
                            }
                        )

                        # 添加 tool 结果
                        for tr in tool_results:
                            current_context.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tr["tool_call_id"],
                                    "content": str(
                                        tr.get("result", tr.get("error", ""))
                                    ),
                                }
                            )

                    # 继续下一轮对话（prompt 已在 context 中）
                    prompt = ""
                    logger.info(
                        f"Agent {persona_id} tool round {round_num + 1}: "
                        f"{len(response.tool_calls)} tools called"
                    )

                # 达到最大轮次，返回最后的响应
                assert response is not None
                return response

            finally:
                self._active_agents.pop(persona_id, None)

    @property
    def active_count(self) -> int:
        return len(self._active_agents)

    @property
    def available_slots(self) -> int:
        # semaphore._value 是当前剩余许可数
        return self._semaphore._value


# 全局单例
orchestrator = AgentOrchestrator(max_concurrent=5)
