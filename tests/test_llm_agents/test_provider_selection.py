"""Provider routing and explicit user correction use only real configuration rules."""

from relohome_agent.agents.llm_provider import client_options, provider_model, provider_name
from relohome_agent.agents.nodes.intake import explicitly_changed_fact


def test_openrouter_key_uses_openrouter_endpoint_and_model():
    assert provider_name("sk-or-v1-secret") == "openrouter"
    assert provider_name("sk-openai-secret") == "openai"
    assert client_options("sk-or-v1-secret") == {"base_url": "https://openrouter.ai/api/v1"}
    assert provider_model("sk-or-v1-secret", "gpt-6-luna") == "openai/gpt-6-luna"
    assert provider_model("sk-or-v1-secret", "anthropic/claude-sonnet-4") == "anthropic/claude-sonnet-4"
    assert client_options("sk-openai-secret") == {}
    assert provider_model("sk-openai-secret", "gpt-6-luna") == "gpt-6-luna"


def test_explicit_time_change_is_not_a_conflict():
    assert explicitly_changed_fact("move_time", "Đổi giờ xe đến thành 10:00")
    assert not explicitly_changed_fact("move_time", "Xe đến 10:00 hay 11:00?")
    assert not explicitly_changed_fact("move_date", "Đổi giờ xe đến thành 10:00")
