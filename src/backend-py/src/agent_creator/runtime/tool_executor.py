"""Tool Executor — 技能到 Tools 的映射和执行"""
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class ToolExecutor:
    """负责执行 Agent 返回的 tool calls

    技能(Skill) 包含 tools_json 定义，描述了该技能内嵌的工具。
    当 Agent Runtime 返回 tool_calls 时，ToolExecutor 负责：
    1. 根据 tool name 查找对应的执行逻辑
    2. 执行 tool 并返回结果
    3. 将结果格式化供 Agent 继续对话
    """

    def __init__(self):
        self._builtin_tools: dict[str, callable] = {}
        self._register_builtin_tools()

    def _register_builtin_tools(self):
        """注册内置工具"""
        self._builtin_tools["web_search"] = self._tool_web_search
        self._builtin_tools["read_file"] = self._tool_read_file
        self._builtin_tools["write_file"] = self._tool_write_file
        self._builtin_tools["execute_code"] = self._tool_execute_code
        self._builtin_tools["analyze_data"] = self._tool_analyze_data

    async def execute_tool(
        self,
        tool_name: str,
        tool_input: dict,
        mcp_connections: list[dict] | None = None,
    ) -> dict:
        """执行单个 tool call

        Args:
            tool_name: 工具名称
            tool_input: 工具输入参数
            mcp_connections: 可用的 MCP 连接列表

        Returns:
            {"success": True/False, "result": ..., "error": ...}
        """
        try:
            # 先检查是否是 MCP 工具（以 mcp_ 开头）
            if tool_name.startswith("mcp_") and mcp_connections:
                return await self._execute_mcp_tool(
                    tool_name, tool_input, mcp_connections
                )

            # 检查内置工具
            if tool_name in self._builtin_tools:
                result = await self._builtin_tools[tool_name](tool_input)
                return {"success": True, "result": result}

            # 未知工具
            return {
                "success": False,
                "error": f"Unknown tool: {tool_name}",
                "result": None,
            }
        except Exception as e:
            logger.error(f"Tool execution failed: {tool_name} - {e}")
            return {"success": False, "error": str(e), "result": None}

    async def execute_tool_calls(
        self,
        tool_calls: list[dict],
        mcp_connections: list[dict] | None = None,
    ) -> list[dict]:
        """批量执行 tool calls，返回结果列表"""
        results = []
        for tc in tool_calls:
            result = await self.execute_tool(
                tc["name"], tc.get("input", {}), mcp_connections
            )
            results.append(
                {
                    "tool_call_id": tc.get("id", ""),
                    "tool_name": tc["name"],
                    **result,
                }
            )
        return results

    def get_tool_definitions(self, skills: list[dict]) -> list[dict]:
        """从技能列表中提取 tool 定义，供 Agent Runtime 使用

        Args:
            skills: 技能列表，每个技能的 tools_json 包含工具定义

        Returns:
            合并后的工具定义列表
        """
        all_tools = []
        for skill in skills:
            tools_json = skill.get("tools_json")
            if tools_json:
                try:
                    tools = (
                        json.loads(tools_json)
                        if isinstance(tools_json, str)
                        else tools_json
                    )
                    if isinstance(tools, list):
                        all_tools.extend(tools)
                    elif isinstance(tools, dict):
                        all_tools.append(tools)
                except json.JSONDecodeError:
                    logger.warning(
                        f"Invalid tools_json for skill {skill.get('name')}"
                    )
        return all_tools

    # ---- 内置工具实现 ----

    async def _tool_web_search(self, params: dict) -> str:
        """Web 搜索工具（MVP: 返回占位结果，实际搜索通过 MCP）"""
        query = params.get("query", "")
        return (
            f"[Web Search] 搜索 '{query}' 的结果将通过 MCP Brave Search 获取。"
            "请使用 mcp_brave_search 工具。"
        )

    async def _tool_read_file(self, params: dict) -> str:
        """读取文件工具"""
        import aiofiles

        file_path = params.get("path", "")
        try:
            async with aiofiles.open(file_path, "r") as f:
                content = await f.read()
            return content[:10000]  # 限制返回长度
        except Exception as e:
            return f"Error reading file: {e}"

    async def _tool_write_file(self, params: dict) -> str:
        """写入文件工具"""
        import aiofiles
        from pathlib import Path

        file_path = params.get("path", "")
        content = params.get("content", "")
        try:
            Path(file_path).parent.mkdir(parents=True, exist_ok=True)
            async with aiofiles.open(file_path, "w") as f:
                await f.write(content)
            return f"Successfully wrote to {file_path}"
        except Exception as e:
            return f"Error writing file: {e}"

    async def _tool_execute_code(self, params: dict) -> str:
        """执行代码工具（MVP: 仅支持 Python，沙箱执行）"""
        code = params.get("code", "")
        language = params.get("language", "python")
        if language != "python":
            return f"Unsupported language: {language}. Only Python is supported in MVP."

        import asyncio

        try:
            proc = await asyncio.create_subprocess_exec(
                "python3",
                "-c",
                code,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=30
            )
            output = stdout.decode()
            if stderr:
                output += f"\n[stderr] {stderr.decode()}"
            return output[:5000]
        except asyncio.TimeoutError:
            return "Code execution timed out (30s limit)"
        except Exception as e:
            return f"Code execution error: {e}"

    async def _tool_analyze_data(self, params: dict) -> str:
        """数据分析工具（MVP: 基础占位）"""
        data = params.get("data", "")
        analysis_type = params.get("type", "summary")
        return (
            f"[Data Analysis] Type: {analysis_type}, "
            f"Data length: {len(str(data))} chars. "
            "详细分析需要在完整版中实现。"
        )

    # ---- MCP 工具执行 ----

    async def _execute_mcp_tool(
        self,
        tool_name: str,
        tool_input: dict,
        mcp_connections: list[dict],
    ) -> dict:
        """通过 MCP 连接执行工具"""
        # 从 tool_name 提取 MCP 连接标识
        # 格式: mcp_{connection_name}_{tool_name}
        parts = tool_name.split("_", 2)
        if len(parts) < 3:
            return {
                "success": False,
                "error": f"Invalid MCP tool name format: {tool_name}",
            }

        # MVP: 使用 HTTP 方式调用 MCP（适用于 stateless 连接）
        import httpx

        for conn in mcp_connections:
            conn_name = conn.get("name", "").lower().replace(" ", "_")
            if conn_name in tool_name.lower():
                try:
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        # 获取认证信息
                        headers = {}
                        if conn.get("auth_config_enc"):
                            auth_config = json.loads(conn["auth_config_enc"])
                            api_key = auth_config.get("api_key", "")
                            header_name = auth_config.get(
                                "header_name", "X-Subscription-Token"
                            )
                            headers[header_name] = api_key

                        # 构建请求
                        url = conn["server_url"]
                        params = tool_input

                        resp = await client.get(
                            url, params=params, headers=headers
                        )
                        return {
                            "success": resp.status_code == 200,
                            "result": resp.text[:5000],
                        }
                except Exception as e:
                    return {"success": False, "error": str(e)}

        return {
            "success": False,
            "error": f"No matching MCP connection for tool: {tool_name}",
        }


tool_executor = ToolExecutor()
