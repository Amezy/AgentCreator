"""Subagent isolation executor — each workflow step runs in independent session.

Each step gets its own OpenCode session. Only the structured summary
(key_findings, artifacts, context_for_next) is passed to the next step.
"""

import logging

from agent_creator.services.execution_logger import execution_logger

logger = logging.getLogger(__name__)

SUMMARY_SCHEMA_PROMPT = """
在完成任务后，你必须输出以下 JSON 格式的结构化摘要:

```json
{
  "key_findings": ["发现1", "发现2"],
  "artifacts": [
    {
      "type": "report|code|data|config",
      "content": "完整内容（不压缩）"
    }
  ],
  "context_for_next": "下一步应重点关注的信息"
}
```

规则:
- artifacts 的 content 必须完整保留，不做任何压缩
- key_findings 提炼关键发现，每条不超过 100 字
- context_for_next 给出下一步的指引
"""


class SubagentExecutor:
    """Executes workflow steps in isolated subagent sessions."""

    def assemble_step_prompt(
        self,
        skill_instructions: str,
        tools: list[str],
        previous_summaries: list[dict],
        input_context: str = "",
    ) -> str:
        """Assemble the complete prompt for a subagent step."""
        parts = []

        if input_context:
            parts.append(f"## 任务上下文\n{input_context}\n")

        if previous_summaries:
            parts.append("## 前序步骤结果\n")
            for i, summary in enumerate(previous_summaries, 1):
                parts.append(f"### 步骤 {i} 结果")
                if summary.get("key_findings"):
                    parts.append("关键发现:")
                    for finding in summary["key_findings"]:
                        parts.append(f"- {finding}")
                if summary.get("artifacts"):
                    for artifact in summary["artifacts"]:
                        parts.append(f"\n**{artifact.get('type', 'output')}:**")
                        parts.append(artifact.get("content", ""))
                if summary.get("context_for_next"):
                    parts.append(f"\n指引: {summary['context_for_next']}")
                parts.append("")

        parts.append(f"## 技能指令\n{skill_instructions}\n")

        if tools:
            parts.append(f"## 可用工具\n{', '.join(tools)}\n")

        parts.append(SUMMARY_SCHEMA_PROMPT)

        return "\n".join(parts)

    async def execute_step(
        self,
        execution_id: str,
        step_number: int,
        prompt: str,
    ) -> dict:
        """Execute a single step in an isolated session (placeholder)."""
        execution_logger.append_main(execution_id, {
            "type": "step_start",
            "step_number": step_number,
        })

        # TODO: Create OpenCode session and run
        summary = {
            "key_findings": [f"步骤 {step_number} 已提交执行"],
            "artifacts": [],
            "context_for_next": f"步骤 {step_number} 的结果将在执行完成后可用",
        }

        return summary


subagent_executor = SubagentExecutor()
