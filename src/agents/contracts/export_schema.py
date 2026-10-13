"""Xuất JSON Schema của contract subagent ra docs/api/agent-contract/ (§6.3).

Chạy: python -m relohome_agent.agents.contracts.export_schema --output-dir docs/api/agent-contract
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from relohome_agent.agents.contracts.agent_task import AgentManifest, AgentTaskRequest, AgentTaskResult


def export(out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for model in (AgentManifest, AgentTaskRequest, AgentTaskResult):
        path = out_dir / f"{model.__name__}.schema.json"
        path.write_text(json.dumps(model.model_json_schema(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written.append(path)
    return written


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    for path in export(parser.parse_args().output_dir):
        print(path)
