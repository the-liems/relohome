from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID

from src.agent_services.common import ServiceError, now
from src.agent_services.orchestrator.models import Workflow


class WorkflowStore:
    """Durable single-host state; CAS prevents concurrent requests overwriting one another."""

    def __init__(self, path: str):
        self.path = path

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=5)
        try:
            yield conn
        finally:
            conn.close()

    def initialize(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("""CREATE TABLE IF NOT EXISTS workflows (
                id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL,
                request_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL,
                UNIQUE(owner_id, session_id, request_id))""")
            conn.execute("""CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY, workflow_id TEXT NOT NULL, revision INTEGER NOT NULL,
                kind TEXT NOT NULL, created_at TEXT NOT NULL)""")
            conn.commit()

    def ready(self):
        with self.connection() as conn:
            conn.execute("SELECT revision FROM workflows LIMIT 1").fetchone()

    def find(self, owner: str, session: str, request: UUID) -> Workflow | None:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT body FROM workflows WHERE owner_id=? AND session_id=? AND request_id=?",
                (owner, session, str(request)),
            ).fetchone()
        return Workflow.model_validate_json(row[0]) if row else None

    def get(self, workflow_id: UUID, owner: str) -> Workflow:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT body FROM workflows WHERE id=? AND owner_id=?", (str(workflow_id), owner)
            ).fetchone()
        if not row:
            raise ServiceError("NOT_FOUND", "Workflow not found for this owner.", 404)
        return Workflow.model_validate_json(row[0])

    def create(self, workflow: Workflow) -> Workflow:
        try:
            with self.connection() as conn:
                conn.execute(
                    "INSERT INTO workflows VALUES (?,?,?,?,?,?)",
                    (
                        str(workflow.workflow_id),
                        workflow.owner_id,
                        workflow.session_id,
                        str(workflow.request_id),
                        workflow.revision,
                        workflow.model_dump_json(),
                    ),
                )
                self._event(conn, workflow, "created")
                conn.commit()
            return workflow
        except sqlite3.IntegrityError:
            existing = self.find(workflow.owner_id, workflow.session_id, workflow.request_id)
            if existing and existing.request_hash == workflow.request_hash:
                return existing
            raise ServiceError("REQUEST_CONFLICT", "Request ID was already used for another payload.") from None

    def save(self, workflow: Workflow, expected: int, kind: str) -> Workflow:
        workflow.revision = expected + 1
        workflow.updated_at = now()
        with self.connection() as conn:
            result = conn.execute(
                "UPDATE workflows SET revision=?, body=? WHERE id=? AND revision=?",
                (workflow.revision, workflow.model_dump_json(), str(workflow.workflow_id), expected),
            )
            if result.rowcount != 1:
                raise ServiceError("REVISION_CONFLICT", "Workflow changed; reload before retrying.")
            self._event(conn, workflow, kind)
            conn.commit()
        return workflow

    def events(self, workflow_id: UUID, owner: str) -> list[dict]:
        self.get(workflow_id, owner)
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT revision, kind, created_at FROM events WHERE workflow_id=? ORDER BY id DESC LIMIT 200",
                (str(workflow_id),),
            ).fetchall()
        return [{"revision": r[0], "kind": r[1], "created_at": r[2]} for r in reversed(rows)]

    @staticmethod
    def _event(conn, workflow: Workflow, kind: str):
        conn.execute(
            "INSERT INTO events(workflow_id,revision,kind,created_at) VALUES (?,?,?,?)",
            (str(workflow.workflow_id), workflow.revision, kind, now().isoformat()),
        )
