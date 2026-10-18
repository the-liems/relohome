"""Real SDK fixture; provider traffic stays in httpx.MockTransport."""

import asyncio
import json

import httpx
from langfuse import get_client
from langfuse.openai import AsyncOpenAI
from langgraph.graph import END, START, StateGraph
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from pydantic import BaseModel
from relohome_agent.agents.deps import default_deps
from relohome_agent.agents.graph import run_config

provider = TracerProvider(resource=Resource.create({"service.name": "langfuse-fixture"}))
provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)


class Answer(BaseModel):
    answer: str


def respond(request):
    body = json.loads(request.content)
    if body["input"] == "fail":
        return httpx.Response(429, json={"error": {"message": "fixture rate limit", "type": "rate_limit"}})
    return httpx.Response(
        200,
        json={
            "id": "resp_fixture",
            "object": "response",
            "created_at": 1,
            "status": "completed",
            "model": "gpt-4.1-mini",
            "error": None,
            "incomplete_details": None,
            "instructions": body.get("instructions"),
            "metadata": {},
            "parallel_tool_calls": False,
            "temperature": 1,
            "tool_choice": "auto",
            "tools": [],
            "top_p": 1,
            "output": [
                {
                    "id": "msg_fixture",
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [{"type": "output_text", "text": '{"answer":"fixture answer"}', "annotations": []}],
                }
            ],
            "usage": {
                "input_tokens": 20,
                "output_tokens": 5,
                "total_tokens": 25,
                "cost": 0.001,
                "input_tokens_details": {"cached_tokens": 4},
                "output_tokens_details": {"reasoning_tokens": 0},
            },
        },
    )


async def main():
    client = AsyncOpenAI(
        api_key="fixture-only", max_retries=0, http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond))
    )

    async def model(state):
        if state.get("failure"):
            await client.responses.create(model="gpt-4.1-mini", input="fail")
        else:
            result = await client.responses.parse(
                model="gpt-4.1-mini",
                instructions="Fixture system prompt",
                input="Fixture user prompt",
                text_format=Answer,
            )
            assert result.output_parsed.answer == "fixture answer"
            await client.responses.create(model="gpt-4.1-mini", input="Fixture follow-up")
        return {"answer": "fixture answer"}

    graph = StateGraph(dict)
    graph.add_node("model", model)
    graph.add_edge(START, "model")
    graph.add_edge("model", END)
    app = graph.compile()
    deps = default_deps()

    async def run(session, failure=False):
        with trace.get_tracer("fixture-http").start_as_current_span(session):
            try:
                await app.ainvoke({"failure": failure}, run_config(session, deps))
            except Exception:
                if not failure:
                    raise

    await asyncio.gather(run("session-success"), run("session-failure", True))
    await client.close()
    get_client().flush()
    provider.force_flush()


asyncio.run(main())
