"""Persona persistent memory — cross-session experience accumulation.

Each persona maintains a MEMORY.md file (inspired by Claude Code's mechanism).
"""

import os
import time
from pathlib import Path

from agent_creator.config import settings


class PersonaMemory:
    """Manages persistent memory files for personas."""

    def __init__(self, base_dir: str | None = None):
        self.base_dir = Path(base_dir or os.path.join(settings.UPLOAD_DIR, "..", "persona-memories"))

    def _memory_dir(self, persona_id: str) -> Path:
        d = self.base_dir / persona_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _memory_file(self, persona_id: str) -> Path:
        return self._memory_dir(persona_id) / "MEMORY.md"

    def _index_file(self, persona_id: str) -> Path:
        return self._memory_dir(persona_id) / "INDEX.md"

    async def get_memory(self, persona_id: str) -> str:
        """Read the persona's full MEMORY.md content."""
        f = self._memory_file(persona_id)
        if not f.exists():
            return ""
        return f.read_text(encoding="utf-8")

    async def get_memory_entries(self, persona_id: str) -> list[dict]:
        """Read individual memory entry files."""
        mem_dir = self._memory_dir(persona_id)
        entries = []
        for f in sorted(mem_dir.glob("*.md")):
            if f.name in ("MEMORY.md", "INDEX.md"):
                continue
            content = f.read_text(encoding="utf-8")
            entry = {"file": f.name, "content": content}
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    entry["frontmatter"] = parts[1].strip()
                    entry["body"] = parts[2].strip()
            entries.append(entry)
        return entries

    async def add_memory_entry(
        self, persona_id: str, name: str, entry_type: str, description: str, content: str,
    ) -> str:
        """Add a new memory entry file and update the index."""
        mem_dir = self._memory_dir(persona_id)
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
        filename = f"{entry_type}_{safe_name}.md"

        entry_content = f"""---
name: {name}
description: {description}
type: {entry_type}
created: {time.strftime('%Y-%m-%d %H:%M:%S')}
---

{content}
"""
        (mem_dir / filename).write_text(entry_content, encoding="utf-8")
        await self._update_index(persona_id)
        return filename

    async def remove_memory_entry(self, persona_id: str, filename: str) -> bool:
        """Remove a memory entry file."""
        # Path traversal defense: reject filenames with path separators or parent refs
        if "/" in filename or "\\" in filename or ".." in filename:
            return False
        mem_dir = self._memory_dir(persona_id)
        filepath = mem_dir / filename
        # Ensure resolved path stays within the persona's memory directory
        if not filepath.resolve().parent == mem_dir.resolve():
            return False
        if filepath.exists() and filepath.name not in ("MEMORY.md", "INDEX.md"):
            filepath.unlink()
            await self._update_index(persona_id)
            return True
        return False

    async def _update_index(self, persona_id: str) -> None:
        """Rebuild INDEX.md from existing entry files."""
        mem_dir = self._memory_dir(persona_id)
        lines = [f"# {persona_id} 记忆索引\n"]
        for f in sorted(mem_dir.glob("*.md")):
            if f.name in ("MEMORY.md", "INDEX.md"):
                continue
            content = f.read_text(encoding="utf-8")
            desc = f.name
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    for line in parts[1].split("\n"):
                        if line.startswith("description:"):
                            desc = line.split(":", 1)[1].strip()
                            break
            lines.append(f"- [{f.name}]({f.name}) — {desc}")
        (mem_dir / "INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    async def get_memory_prompt_section(self, persona_id: str) -> str:
        """Generate a prompt section containing the persona's memories."""
        entries = await self.get_memory_entries(persona_id)
        if not entries:
            return ""
        lines = ["## 持久记忆（来自历史执行经验）\n"]
        for entry in entries:
            body = entry.get("body", entry["content"])
            lines.append(f"### {entry['file']}")
            lines.append(body)
            lines.append("")
        return "\n".join(lines)


persona_memory = PersonaMemory()
