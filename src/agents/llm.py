"""Wrapper LLM cho `Intake` và `Planner` thật (agent-graph.md §3.3, §7.5 — Q20: OpenAI cho mọi agent).

Lấy từ `src/agent_services/llm.py` của nhánh `khoa`: một call có giới hạn, structured output, không
fallback giả, lỗi có mã rõ ràng. Model chọn theo tầng `light` / `heavy` ở `GraphSettings.llm_models`.
"""

from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Literal, TypeVar

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI, RateLimitError
from pydantic import BaseModel, ValidationError

from src.agents.common import canonical

T = TypeVar("T", bound=BaseModel)
logger = logging.getLogger(__name__)


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
        self._usage: ContextVar[tuple[int, int]] = ContextVar(f"llm_usage_{id(self)}", default=(0, 0))

    @property
    def last_usage(self) -> tuple[int, int]:
        return self._usage.get()

    def ready(self) -> bool:
        return bool(self.api_key) and not self.api_key.startswith(("sk-your", "your-", "test-"))

    async def parse(self, instructions: str, data: dict, schema: type[T]) -> T:
        self._usage.set((0, 0))
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
                **({"temperature": 0} if self.model.startswith(("gpt-4.1", "gpt-4o")) else {}),
            )
        except APITimeoutError as exc:
            raise LLMError(
                "LLM_TIMEOUT", "OpenAI phản hồi quá thời gian chờ. Kiểm tra trạng thái hiện tại trước khi thử lại.", True
            ) from exc
        except APIConnectionError as exc:
            cause = exc.__cause__
            logger.warning("LLM connection failure cause=%s detail=%s", type(cause).__name__, str(cause)[:200])
            raise LLMError(
                "LLM_CONNECTION_ERROR",
                "Không kết nối được OpenAI. Kiểm tra mạng/DNS/proxy của máy chạy API; không phải do câu hỏi của bạn.",
                True,
            ) from exc
        except RateLimitError as exc:
            raise LLMError(
                "LLM_RATE_LIMIT",
                "OpenAI đang giới hạn lượt gọi hoặc tài khoản hết hạn mức; kiểm tra tài khoản API.",
                True,
            ) from exc
        except APIStatusError as exc:
            raise LLMError("LLM_PROVIDER_ERROR", "LLM từ chối request; kiểm tra model và tài khoản.") from exc
        except (ValidationError, ValueError) as exc:
            raise LLMError("LLM_INVALID_OUTPUT", "Kết quả LLM không đúng schema.") from exc
        usage = getattr(result, "usage", None)
        self._usage.set((getattr(usage, "input_tokens", 0) or 0, getattr(usage, "output_tokens", 0) or 0))
        if result.status != "completed" or result.output_parsed is None:
            raise LLMError("LLM_NO_RESULT", "LLM từ chối hoặc không hoàn tất structured output.")
        return result.output_parsed

    async def close(self) -> None:
        if self.client is not None:
            await self.client.close()
