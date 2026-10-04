"""Resolve the configured OpenAI-compatible LLM endpoint without logging secrets."""

from __future__ import annotations


def client_options(api_key: str) -> dict[str, str]:
    """OpenRouter keys must never be sent to the default OpenAI endpoint."""
    if api_key.startswith("sk-or-v1-"):
        return {"base_url": "https://openrouter.ai/api/v1"}
    return {}


def provider_model(api_key: str, model: str) -> str:
    if api_key.startswith("sk-or-v1-") and "/" not in model:
        return f"openai/{model}"
    return model
