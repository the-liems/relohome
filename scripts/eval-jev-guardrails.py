"""Explicit opt-in live smoke evaluation; outputs synthetic IDs and metrics only.

Run with installed repo packages:
python scripts/eval-jev-guardrails.py --live --env-file .env.test --timeout 1.5
No application traffic, mutations, private thread data, retries or automatic activation.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
from pathlib import Path
from statistics import median
from time import perf_counter

from dotenv import dotenv_values
from relohome_agent.agents.guardrails.jev import JevClient, JevError, openrouter_key
from relohome_agent.agents.guardrails.policy import ASSESSMENT_QUESTIONS, PLAN_QUESTIONS, POLICY_VERSION

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eval.jev_guardrail_cases import cases  # noqa: E402


async def evaluate(key, timeout):
    client = JevClient(key, timeout_s=timeout)
    rows = []
    try:
        for case in cases():
            started = perf_counter()
            try:
                decision = await client.decide(
                    case["state"], PLAN_QUESTIONS if case["point"] == "plan" else ASSESSMENT_QUESTIONS
                )
                row = {
                    "case": case["id"],
                    "served_model": decision.served_model,
                    "status": "completed",
                    "answers": decision.answers,
                    "expected": case["expected"],
                    "matches": {
                        name: decision.answers[name]["choice"] == expected
                        for name, expected in case["expected"].items()
                    },
                    "input_tokens": decision.input_tokens,
                    "output_tokens": decision.output_tokens,
                    "cost": decision.cost,
                }
            except JevError as exc:
                row = {"case": case["id"], "status": "unavailable", "code": str(exc)}
            row["elapsed_ms"] = round((perf_counter() - started) * 1000, 2)
            rows.append(row)
            print(json.dumps(row), flush=True)
    finally:
        await client.close()
    completed = [row for row in rows if row["status"] == "completed"]
    latency = sorted(row["elapsed_ms"] for row in completed)
    labelled = [match for row in completed for match in row["matches"].values()]
    print(
        json.dumps(
            {
                "summary": True,
                "policy": POLICY_VERSION,
                "timeout_s": timeout,
                "cases": len(rows),
                "completed": len(completed),
                "unavailable": len(rows) - len(completed),
                "label_matches": sum(labelled),
                "labelled_answers": len(labelled),
                "p50_ms": median(latency) if latency else None,
                "p95_ms": latency[math.ceil(len(latency) * 0.95) - 1] if latency else None,
                "input_tokens": sum(row.get("input_tokens", 0) for row in rows),
                "cost_reported_usd": sum(row.get("cost", 0) for row in rows),
                "note": "Small synthetic smoke set, not accuracy calibration. Timeouts may still be billed by provider.",
            }
        )
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Explicitly authorize the synthetic paid API calls")
    parser.add_argument("--env-file", type=Path, required=True, help="Ignored credential file; never printed")
    parser.add_argument("--timeout", type=float, default=1.5)
    args = parser.parse_args()
    if not args.live or not 0.1 <= args.timeout <= 5:
        parser.error("Pass --live and timeout between 0.1 and 5 seconds")
    if not args.env_file.is_file():
        parser.error("Credential file not found")
    values = dotenv_values(args.env_file)
    try:
        key = openrouter_key(values.get("OPENROUTER_API_KEY") or "", values.get("OPENAI_API_KEY") or "")
    except JevError:
        parser.error("Invalid OpenRouter credential format (value never logged)")
    if not key:
        parser.error("OpenRouter key missing (never use an ordinary OpenAI key)")
    asyncio.run(evaluate(key, args.timeout))


if __name__ == "__main__":
    main()
