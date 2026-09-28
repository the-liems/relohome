"""Wrapper LLM cho `Intake` và `Planner` thật (agent-graph.md §3.3, §7.5 — Q20: OpenAI cho mọi agent).

Lấy từ `src/agent_services/llm.py` của nhánh `khoa`: một call có giới hạn, structured output, không
fallback giả, lỗi có mã rõ ràng. Model chọn theo tầng `light` / `heavy` ở `GraphSettings.llm_models`.
"""

from __future__ import annotations

from typing import Literal, TypeVar

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI, RateLimitError
from pydantic import BaseModel, ValidationError

from src.agents.common import canonical

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code, self.message, self.retryable = code, message, retryable


class StructuredLLM:
    """`parse(instructions, data, schema)`: dữ liệu đầu vào đi dạng JSON, không phải chỉ dẫn."""

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        tier: Literal["light", "heavy"] = "light",
        timeout_s: float = 45,
        max_output_tokens: int = 6000,
    ):
        self.api_key, self.model, self.tier = api_key, model, tier
        self.timeout_s, self.max_output_tokens = timeout_s, max_output_tokens
        self.client: AsyncOpenAI | None = None
        self.last_usage: tuple[int, int] = (0, 0)  # (tokens_in, tokens_out) để node ghi vào UsageMeter

    def ready(self) -> bool:
        return bool(self.api_key) and not self.api_key.startswith(("sk-your", "your-", "test-"))

    async def parse(self, instructions: str, data: dict, schema: type[T]) -> T:
        if not self.ready():
            raise LLMError("LLM_NOT_CONFIGURED", "Cần cấu hình OPENAI_API_KEY.")
        if self.client is None:
            self.client = AsyncOpenAI(api_key=self.api_key, timeout=self.timeout_s, max_retries=0)
        try:
            result = await self.client.responses.parse(
                model=self.model,
                instructions=instructions,
                input=canonical(data),
                text_format=schema,
                max_output_tokens=self.max_output_tokens,
                store=False,
            )
        except (APITimeoutError, APIConnectionError, RateLimitError) as exc:
            raise LLMError("LLM_UNAVAILABLE", "LLM không phản hồi hoặc quá hạn.", True) from exc
        except APIStatusError as exc:
            raise LLMError("LLM_PROVIDER_ERROR", "LLM từ chối request; kiểm tra model và tài khoản.") from exc
        except (ValidationError, ValueError) as exc:
            raise LLMError("LLM_INVALID_OUTPUT", "Kết quả LLM không đúng schema.") from exc
        if result.status != "completed" or result.output_parsed is None:
            raise LLMError("LLM_NO_RESULT", "LLM từ chối hoặc không hoàn tất structured output.")
        usage = getattr(result, "usage", None)
        self.last_usage = (getattr(usage, "input_tokens", 0) or 0, getattr(usage, "output_tokens", 0) or 0)
        return result.output_parsed

    async def close(self) -> None:
        if self.client is not None:
            await self.client.close()
