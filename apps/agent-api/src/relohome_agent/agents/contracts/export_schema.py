"""Xuất JSON Schema của contract subagent ra docs/api/agent-contract/ (§6.3).

Chạy: python -m relohome_agent.agents.contracts.export_schema --output-dir docs/api/agent-contract
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from relohome_agent.agents.contracts.agent_task import AgentManifest, AgentTaskRequest, AgentTaskResult
from relohome_agent.runtime_paths import runtime_path


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
    parser.add_argument("--output-dir", type=Path, default=Path("docs/api/agent-contract"))
    for path in export(runtime_path(parser.parse_args().output_dir)):
        print(path)
