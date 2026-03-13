"""SKILL.md file parser - extracts YAML frontmatter and Markdown instructions."""

import re
from dataclasses import dataclass, field

import yaml


@dataclass
class SkillMdResult:
    """Parsed result from a SKILL.md file."""
    name: str = ""
    description: str = ""
    category: str = "general"
    complexity: str = "basic"
    recommended_model_tier: str = "basic"
    opencode_tools: list[str] = field(default_factory=list)
    applicable_min_level: str = "junior"
    instructions: str = ""


_FIELD_MAP = {
    "name": "name",
    "description": "description",
    "category": "category",
    "complexity": "complexity",
    "recommended-model-tier": "recommended_model_tier",
    "allowed-tools": "opencode_tools",
    "min-level": "applicable_min_level",
}


def parse_skillmd(content: str) -> SkillMdResult:
    """Parse a SKILL.md file content into structured data.

    Raises:
        ValueError: If frontmatter is missing, malformed, or required fields absent.
    """
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)", content, re.DOTALL)
    if not match:
        raise ValueError("SKILL.md 格式错误：缺少 YAML frontmatter（需要 --- 分隔符）")

    frontmatter_str = match.group(1)
    body = match.group(2).strip()

    try:
        frontmatter = yaml.safe_load(frontmatter_str)
    except yaml.YAMLError as e:
        raise ValueError(f"SKILL.md frontmatter YAML 解析失败: {e}")

    if not isinstance(frontmatter, dict):
        raise ValueError("SKILL.md frontmatter 格式错误：应为键值对")

    if "name" not in frontmatter:
        raise ValueError("SKILL.md 缺少必填字段: name")
    if "description" not in frontmatter:
        raise ValueError("SKILL.md 缺少必填字段: description")

    desc = str(frontmatter["description"])
    if len(desc) > 1024:
        raise ValueError("description 不能超过 1024 字符")

    result = SkillMdResult()
    result.instructions = body

    for yaml_key, attr_name in _FIELD_MAP.items():
        if yaml_key in frontmatter:
            value = frontmatter[yaml_key]
            if attr_name == "opencode_tools":
                if isinstance(value, list):
                    value = [str(v) for v in value]
                elif isinstance(value, str):
                    value = [v.strip() for v in value.split(",") if v.strip()]
                else:
                    value = []
            setattr(result, attr_name, value)

    return result
