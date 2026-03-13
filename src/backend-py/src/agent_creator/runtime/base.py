"""Abstract base class for agent runtimes."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class AgentResponse:
    """Unified response from any agent runtime."""

    content: str
    tool_calls: list[dict] | None = None
    usage: dict | None = field(default=None)  # {"input_tokens": x, "output_tokens": y}


class AgentRuntime(ABC):
    """Unified interface that every LLM runtime must implement."""

    @abstractmethod
    async def execute(
        self,
        prompt: str,
        system_prompt: str | None = None,
        tools: list[dict] | None = None,
        context: list[dict] | None = None,
    ) -> AgentResponse:
        """Run a single turn and return the full response."""
        ...

    @abstractmethod
    async def stream(
        self,
        prompt: str,
        system_prompt: str | None = None,
        tools: list[dict] | None = None,
        context: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        """Stream response tokens as they arrive."""
        ...
