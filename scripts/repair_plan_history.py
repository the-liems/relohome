"""Restore plan-panel history from earlier checkpoints after an old new_goal reset.

This only appends a corrected checkpoint for the specified thread. Run without
--apply to inspect the proposed task/selection counts first.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from relohome_agent.agents.graph import build_graph, checkpoint_serde, run_config
from relohome_agent.agents.progress import plan_progress, record_selections
from relohome_agent.agents.wiring import AgentService
from relohome_agent.config import Settings


def selected_count(values: dict) -> int:
    intake = values.get("intake")
    return sum(key.startswith("selected:") for key in intake.user_confirmed_facts) if intake else 0


async def repair(database: Path, thread_id: str, *, apply: bool) -> None:
    service = AgentService.create(services=Settings(_env_file=None, agent_subagents="fake"))
    async with AsyncSqliteSaver.from_conn_string(str(database)) as saver:
        saver.serde = checkpoint_serde()
        graph = build_graph(service.deps, saver)
        config = run_config(thread_id, service.deps)
        history = [snapshot async for snapshot in graph.aget_state_history(config)]
        if not history:
            raise ValueError("Thread has no checkpoints")
        latest = history[0].values
        prior = next((snap.values for snap in history[1:] if selected_count(snap.values) > 0), None)
        if prior is None:
            raise ValueError("No earlier confirmed selections to restore")
        previous_tasks = {
            key: task for key, task in (prior.get("goal_tasks") or {}).items() if not key.startswith("pending:")
        }
        proposed_tasks = {**previous_tasks, **(latest.get("goal_tasks") or {})}
        proposed_choices = {**record_selections(prior), **(latest.get("goal_selections") or {})}
        additions = set(proposed_tasks) - set(latest.get("goal_tasks") or {})
        print("Additional steps:", sorted(additions))
        print("Remembered choices:", len(proposed_choices))
        if not additions and proposed_choices == (latest.get("goal_selections") or {}):
            print("No repair needed")
            return
        if not apply:
            print("Dry run only; pass --apply to append a corrected checkpoint")
            return
        await graph.aupdate_state(
            config,
            {"goal_tasks": proposed_tasks, "goal_selections": proposed_choices},
            as_node="respond",
        )
        current = (await graph.aget_state(config)).values
        progress = plan_progress(current)
        print("Visible steps:", [(item["task_id"], item["state"]) for item in progress["items"]])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("thread_id")
    parser.add_argument("--db", type=Path, default=Path("data/agent-runtime/checkpoints.sqlite3"))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    asyncio.run(repair(args.db, args.thread_id, apply=args.apply))
