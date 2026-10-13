"""Minimal synchronous MCP stdio client used by the Streamlit demo.

The project already owns a TypeScript MCP server.  Keeping this client small
lets the demo use that real server without introducing a second tool layer.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
from collections import deque
from pathlib import Path
from typing import Any

from dotenv import dotenv_values


class McpClientError(RuntimeError):
    """Raised when the local MCP process cannot satisfy a request."""


class ReloHomeMcpClient:
    def __init__(self, relohome_root: Path) -> None:
        self.relohome_root = relohome_root.resolve()
        self.server_path = self.relohome_root / "apps" / "location-mcp" / "dist" / "server.js"
        self.env_path = self.relohome_root / ".env.local"
        self._request_id = 0
        self._stderr: deque[str] = deque(maxlen=30)

        if not self.server_path.exists():
            raise McpClientError(
                f"MCP server chưa được build: {self.server_path}. Chạy `npm run build` trong ReloHome."
            )
        if not self.env_path.exists():
            raise McpClientError(f"Thiếu cấu hình ReloHome: {self.env_path}")

        child_env = {**{k: v for k, v in dotenv_values(self.env_path).items() if v is not None}, **os.environ}

        self.process = subprocess.Popen(
            ["node", str(self.server_path)],
            cwd=self.relohome_root,
            env=child_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if self.process.stdin is None or self.process.stdout is None or self.process.stderr is None:
            raise McpClientError("Không thể mở stdio cho MCP server.")

        threading.Thread(target=self._drain_stderr, daemon=True).start()
        self._initialize()

    def _drain_stderr(self) -> None:
        assert self.process.stderr is not None
        for line in self.process.stderr:
            self._stderr.append(line.rstrip())

    def _send(self, payload: dict[str, Any]) -> None:
        if self.process.poll() is not None:
            details = "\n".join(self._stderr) or "MCP process đã dừng."
            raise McpClientError(details)
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        self.process.stdin.flush()

    def _request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._request_id += 1
        request_id = self._request_id
        self._send(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params or {},
            }
        )

        assert self.process.stdout is not None
        while True:
            line = self.process.stdout.readline()
            if not line:
                details = "\n".join(self._stderr) or "MCP server đóng stdout đột ngột."
                raise McpClientError(details)
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get("id") != request_id:
                continue
            if "error" in message:
                error = message["error"]
                raise McpClientError(error.get("message", json.dumps(error, ensure_ascii=False)))
            return message.get("result", {})

    def _initialize(self) -> None:
        self._request(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "lifeflow-streamlit", "version": "0.1.0"},
            },
        )
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    def list_tools(self) -> list[dict[str, Any]]:
        return self._request("tools/list").get("tools", [])

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        result = self._request("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError"):
            text = next(
                (item.get("text", "") for item in result.get("content", []) if item.get("type") == "text"),
                "MCP tool trả về lỗi.",
            )
            raise McpClientError(text)

        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            return structured
        for item in result.get("content", []):
            if item.get("type") == "text":
                try:
                    parsed = json.loads(item.get("text", ""))
                    if isinstance(parsed, dict):
                        return parsed
                except json.JSONDecodeError:
                    return {"text": item.get("text", "")}
        return {}

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()

