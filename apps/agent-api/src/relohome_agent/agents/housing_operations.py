"""Operation identity: analysing listings is not searching or choosing a home."""

from relohome_agent.agents.models import AgentName


def is_housing_comparison(agent: AgentName | str, inputs: dict) -> bool:
    return agent == AgentName.PROPERTY and inputs.get("housing_mode") == "compare"


def same_housing_operation(agent: AgentName | str, left: dict, right: dict) -> bool:
    return is_housing_comparison(agent, left) == is_housing_comparison(agent, right)
