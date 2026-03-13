"""OpenCode API gateway - proxies tool list from local OpenCode server.

Falls back to a hardcoded preset tool list when OpenCode is unavailable.
"""

import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

OPENCODE_BASE_URL = "http://localhost:9820"


@dataclass
class PresetTool:
    """A preset tool available from OpenCode."""
    id: str
    name: str
    description: str
    category: str


FALLBACK_TOOLS: list[PresetTool] = [
    PresetTool("read", "文件读取", "读取文件内容", "file"),
    PresetTool("edit", "文件编辑", "精确替换文件内容", "file"),
    PresetTool("write", "文件写入", "创建或覆盖文件", "file"),
    PresetTool("ls", "目录列表", "列出目录内容", "file"),
    PresetTool("glob", "文件搜索", "按模式匹配搜索文件", "file"),
    PresetTool("grep", "内容搜索", "基于 ripgrep 的内容搜索", "search"),
    PresetTool("codesearch", "代码搜索", "语义代码搜索", "search"),
    PresetTool("bash", "Shell 执行", "执行 Shell 命令", "execution"),
    PresetTool("webfetch", "网页抓取", "抓取网页内容", "network"),
    PresetTool("websearch", "网络搜索", "搜索引擎查询", "network"),
    PresetTool("task", "子任务", "创建并行子任务", "task"),
    PresetTool("todo", "待办管理", "管理任务清单", "task"),
    PresetTool("plan", "计划管理", "管理实现计划", "task"),
    PresetTool("batch", "批量操作", "批量执行操作", "task"),
    PresetTool("question", "用户提问", "向用户提问获取信息", "interaction"),
    PresetTool("skill", "技能调用", "调用已定义的技能", "interaction"),
    PresetTool("lsp", "语言服务", "代码语言服务（补全、诊断等）", "interaction"),
]


def _tool_to_dict(tool: PresetTool) -> dict:
    return {"id": tool.id, "name": tool.name, "description": tool.description, "category": tool.category}


async def get_available_tools() -> list[dict]:
    """Get available preset tools from OpenCode server.
    Falls back to hardcoded list if OpenCode is unreachable.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OPENCODE_BASE_URL}/agent")
            resp.raise_for_status()
            data = resp.json()
            tools = data.get("tools", [])
            if tools:
                return [
                    {
                        "id": t.get("name", t.get("id", "")),
                        "name": t.get("description", t.get("name", "")),
                        "description": t.get("description", ""),
                        "category": _categorize_tool(t.get("name", "")),
                    }
                    for t in tools
                ]
    except Exception as e:
        logger.warning("OpenCode server unavailable, using fallback tool list: %s", e)

    return [_tool_to_dict(t) for t in FALLBACK_TOOLS]


def _categorize_tool(tool_id: str) -> str:
    """Categorize a tool by its ID."""
    categories = {
        "file": {"read", "edit", "write", "ls", "glob"},
        "search": {"grep", "codesearch"},
        "execution": {"bash"},
        "network": {"webfetch", "websearch"},
        "task": {"task", "todo", "plan", "batch"},
        "interaction": {"question", "skill", "lsp"},
    }
    for cat, ids in categories.items():
        if tool_id in ids:
            return cat
    return "other"
