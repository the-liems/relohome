"""Real OTLP fixture: fake Jev only, never external model or business services."""

import asyncio
from types import SimpleNamespace

from relohome_agent.agents.guardrails.shadow import ShadowGuardrail
from relohome_observability import generation, initialize

initialize("guardrail-fixture")


async def main():
    class Client:
        async def decide(self, *args):
            return SimpleNamespace(answers=["uncertain"], input_tokens=1, output_tokens=1,
                                   served_model="fixture", cost=None)

        async def close(self):
            pass

    observer = ShadowGuardrail(Client())
    observer._observe("plan", {"thread_id": "SYNTHETIC_PRIVATE_THREAD", "request_id": "SYNTHETIC_PRIVATE_REQUEST"},
                      lambda: {}, [])
    observer._observe("plan", {}, lambda: {}, [])
    await asyncio.gather(*observer._tasks)
    await observer.close()

    async def fake_model(**kwargs):
        return SimpleNamespace(usage=SimpleNamespace(input_tokens=2, output_tokens=3), model="fixture",
                               output=[{"text": "SYNTHETIC_PRIVATE_OUTPUT_NAME at SYNTHETIC_PRIVATE_ADDRESS"}])

    await generation(fake_model, provider="fixture", model="fixture",
                     instructions="SYNTHETIC_PRIVATE_INSTRUCTIONS", input="SYNTHETIC_PRIVATE_INPUT_NAME")


if __name__ == "__main__":
    asyncio.run(main())
