"""Shared test fixtures."""

import pytest
from httpx import ASGITransport, AsyncClient

from agent_creator.main import app


@pytest.fixture
async def client() -> AsyncClient:
    """Create an async test client for the FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
