"""Tests for persona persistent memory service."""

import tempfile

import pytest

from agent_creator.services.persona_memory import PersonaMemory


@pytest.fixture
def memory():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield PersonaMemory(base_dir=tmpdir)


@pytest.mark.asyncio
async def test_empty_memory(memory: PersonaMemory):
    """New persona should have empty memory."""
    content = await memory.get_memory("persona-1")
    assert content == ""
    entries = await memory.get_memory_entries("persona-1")
    assert entries == []


@pytest.mark.asyncio
async def test_add_memory_entry(memory: PersonaMemory):
    """Adding a memory entry should create a file."""
    filename = await memory.add_memory_entry(
        persona_id="persona-1",
        name="代码审查偏好",
        entry_type="preference",
        description="偏好使用 ESLint 而非 Prettier",
        content="团队的代码审查标准要求使用 ESLint 进行格式检查。",
    )
    assert filename.endswith(".md")
    assert "preference" in filename

    entries = await memory.get_memory_entries("persona-1")
    assert len(entries) == 1
    assert "代码审查标准" in entries[0]["body"]


@pytest.mark.asyncio
async def test_add_multiple_entries(memory: PersonaMemory):
    """Multiple entries should all be persisted."""
    await memory.add_memory_entry("p1", "entry1", "skill", "desc1", "content1")
    await memory.add_memory_entry("p1", "entry2", "knowledge", "desc2", "content2")
    entries = await memory.get_memory_entries("p1")
    assert len(entries) == 2


@pytest.mark.asyncio
async def test_remove_memory_entry(memory: PersonaMemory):
    """Removing an entry should delete the file."""
    filename = await memory.add_memory_entry("p1", "temp", "knowledge", "temp", "temp content")
    assert await memory.remove_memory_entry("p1", filename)
    entries = await memory.get_memory_entries("p1")
    assert len(entries) == 0


@pytest.mark.asyncio
async def test_remove_nonexistent(memory: PersonaMemory):
    """Removing nonexistent entry should return False."""
    assert not await memory.remove_memory_entry("p1", "nonexistent.md")


@pytest.mark.asyncio
async def test_index_updated(memory: PersonaMemory):
    """INDEX.md should be updated when entries change."""
    await memory.add_memory_entry("p1", "item1", "skill", "first item", "content")
    index_path = memory._memory_dir("p1") / "INDEX.md"
    assert index_path.exists()
    index_content = index_path.read_text()
    assert "item1" in index_content
    assert "first item" in index_content


@pytest.mark.asyncio
async def test_memory_prompt_section(memory: PersonaMemory):
    """Prompt section should contain all memory entries."""
    await memory.add_memory_entry("p1", "auth-pattern", "pattern", "认证模式", "使用 JWT + Redis session")
    prompt = await memory.get_memory_prompt_section("p1")
    assert "持久记忆" in prompt
    assert "JWT" in prompt


@pytest.mark.asyncio
async def test_memory_prompt_section_empty(memory: PersonaMemory):
    """Empty memory should return empty prompt section."""
    prompt = await memory.get_memory_prompt_section("p1")
    assert prompt == ""


@pytest.mark.asyncio
async def test_path_traversal_rejected(memory: PersonaMemory):
    """Path traversal attempts in filename should be rejected."""
    await memory.add_memory_entry("p1", "target", "skill", "desc", "content")
    # Attempt to escape with ../
    assert not await memory.remove_memory_entry("p1", "../p2/skill_target.md")
    # Attempt with absolute-style path
    assert not await memory.remove_memory_entry("p1", "../../etc/passwd")
    # Backslash variant
    assert not await memory.remove_memory_entry("p1", "..\\p2\\skill_target.md")
    # Original file should still exist
    entries = await memory.get_memory_entries("p1")
    assert len(entries) == 1


@pytest.mark.asyncio
async def test_personas_have_isolated_memory(memory: PersonaMemory):
    """Different personas should have separate memory spaces."""
    await memory.add_memory_entry("p1", "entry1", "skill", "p1 only", "p1 content")
    await memory.add_memory_entry("p2", "entry2", "skill", "p2 only", "p2 content")
    p1_entries = await memory.get_memory_entries("p1")
    p2_entries = await memory.get_memory_entries("p2")
    assert len(p1_entries) == 1
    assert len(p2_entries) == 1
    assert p1_entries[0]["file"] != p2_entries[0]["file"]
