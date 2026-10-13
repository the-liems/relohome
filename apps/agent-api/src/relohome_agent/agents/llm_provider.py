"""Resolve the configured OpenAI-compatible LLM endpoint without logging secrets."""

from __future__ import annotations


def provider_name(api_key: str) -> str:
    return "openrouter" if api_key.startswith("sk-or-v1-") else "openai"


def client_options(api_key: str) -> dict[str, str]:
    """OpenRouter keys must never be sent to the default OpenAI endpoint."""
    if provider_name(api_key) == "openrouter":
        return {"base_url": "https://openrouter.ai/api/v1"}
    return {}


def provider_model(api_key: str, model: str) -> str:
    if provider_name(api_key) == "openrouter" and "/" not in model:
        return f"openai/{model}"
    return model
