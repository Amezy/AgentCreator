"""Shared Pydantic models for API request / response contracts."""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """Unified API response envelope."""

    success: bool = True
    data: T | None = None
    error: str | None = None
    message: str | None = None


class PaginatedData(BaseModel, Generic[T]):
    """Wrapper for paginated list responses."""

    items: list[T]
    total: int
    page: int = 1
    page_size: int = 20
