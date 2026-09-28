"""Xuất JSON Schema của contract subagent ra docs/api/agent-contract/ (§6.3).

Chạy: python -m src.agents.contracts.export_schema
"""

from __future__ import annotations

import json
from pathlib import Path

from src.agents.contracts.agent_task import AgentManifest, AgentTaskRequest, AgentTaskResult

OUT_DIR = Path(__file__).resolve().parents[3] / "docs" / "api" / "agent-contract"


def export(out_dir: Path = OUT_DIR) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for model in (AgentManifest, AgentTaskRequest, AgentTaskResult):
        path = out_dir / f"{model.__name__}.schema.json"
        path.write_text(json.dumps(model.model_json_schema(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written.append(path)
    return written


if __name__ == "__main__":
    for path in export():
        print(path)
