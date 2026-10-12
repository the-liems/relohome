import os
from pathlib import Path

os.environ.setdefault("RELOHOME_RUNTIME_ROOT", str(Path(__file__).resolve().parents[1]))

from unittest.mock import AsyncMock

import pytest


@pytest.fixture
def mock_llm():
    """Mock LLM to avoid calling OpenAI during tests.

    Usage in test:
        def test_something(mock_llm):
            # LLM calls will return mock response instead of hitting OpenAI
            ...
    """
    mock = AsyncMock()
    mock.ainvoke.return_value = AsyncMock(content="Mocked LLM response")
    return mock
