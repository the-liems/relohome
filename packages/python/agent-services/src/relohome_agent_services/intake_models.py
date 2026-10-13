from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import Field

from relohome_agent_services.common import Model

Intent = Literal[
    "housing_search",
    "location_lookup",
    "route",
    "moving_quote",
    "moving_create",
    "moving_status",
    "moving_cancel",
    "moving_update",
    "moving_catalog",
    "flight_search",
    "flight_booking",
    "payment",
    "information",
    "out_of_scope",
    "unknown",
]


class Fact(Model):
    name: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=2000)
    source: Literal["message", "history", "confirmed_context"]
    evidence: str = Field(min_length=1, max_length=2000)


class Turn(Model):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class IntakeRequest(Model):
    request_id: UUID
    session_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=8000)
    history: list[Turn] = Field(default_factory=list, max_length=20)
    confirmed_context: dict[str, str] = Field(default_factory=dict, max_length=50)


class Understanding(Model):
    normalized_goal: str = Field(min_length=1, max_length=4000)
    intents: list[Intent] = Field(min_length=1, max_length=16)
    entities: list[Fact] = Field(max_length=80)
    constraints: list[Fact] = Field(max_length=40)
    missing_fields: list[str] = Field(max_length=40)
    conflicts: list[str] = Field(max_length=20)
    clarification_questions: list[str] = Field(max_length=8)
    confidence: float = Field(ge=0, le=1)


class IntakeResult(Model):
    contract_version: Literal["1.0.0"] = "1.0.0"
    request_id: UUID
    session_id: str = Field(min_length=1, max_length=128)
    understanding: Understanding
    status: Literal["ready", "needs_clarification", "out_of_scope"]
    # Facts in this field come only from the trusted caller, never from model assertions.
    user_confirmed_facts: dict[str, str] = Field(default_factory=dict)
    model: str
