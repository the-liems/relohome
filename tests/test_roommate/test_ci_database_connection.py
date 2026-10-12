import json
import subprocess

import psycopg

from tests.test_roommate.database_connection import resolve_database_url


def test_local_database_url_is_never_rewritten(monkeypatch):
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.setattr(
        subprocess,
        "check_output",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Docker must not be queried locally")),
    )
    assert (
        resolve_database_url("postgresql://user:test@127.0.0.1:15433/test")
        == "postgresql://user:test@127.0.0.1:15433/test"
    )


def test_containerized_ci_resolves_only_its_published_port_and_preserves_credentials(monkeypatch):
    from psycopg.conninfo import conninfo_to_dict

    monkeypatch.setenv("CI", "true")
    calls = []
    networks = [
        {
            "Ports": {"5432/tcp": [{"HostPort": "40000"}]},
            "Networks": {"other": {"Gateway": "172.20.0.1", "Aliases": ["roommate-postgres"]}},
        },
        {
            "Ports": {"5432/tcp": [{"HostPort": "33087"}]},
            "Networks": {"own": {"Gateway": "172.21.0.1", "Aliases": ["roommate-postgres"], "IPAddress": "172.21.0.2"}},
        },
    ]

    def command(args, **_kwargs):
        calls.append(args)
        return "other\nown" if args[1] == "ps" else json.dumps(networks[0 if args[-1] == "other" else 1])

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query):
            assert query == "SELECT 1"

    tried = []

    def connect(url, **_kwargs):
        params = conninfo_to_dict(url)
        tried.append(params)
        if params["host"] == "172.21.0.1":
            return Connection()
        raise psycopg.OperationalError("synthetic connection refused")

    monkeypatch.setattr(subprocess, "check_output", command)
    monkeypatch.setattr(psycopg, "connect", connect)
    url = resolve_database_url("postgresql://postgres:test-password@127.0.0.1:33087/roommate_test")
    assert conninfo_to_dict(url) == {
        "user": "postgres",
        "password": "test-password",
        "host": "172.21.0.1",
        "port": "33087",
        "dbname": "roommate_test",
    }
    assert not any(item["host"] == "172.20.0.1" for item in tried)
    assert all("--mount" not in args and "network" not in args for args in calls)


def test_ci_connection_failure_stays_a_failure_without_skipping_pg_tests(monkeypatch):
    monkeypatch.setenv("CI", "true")
    monkeypatch.setattr(
        psycopg, "connect", lambda *_args, **_kwargs: (_ for _ in ()).throw(psycopg.OperationalError("refused"))
    )
    monkeypatch.setattr(subprocess, "check_output", lambda *_args, **_kwargs: "")
    url = "postgresql://user:test@127.0.0.1:33087/test"
    assert resolve_database_url(url) == url
