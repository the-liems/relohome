"""The isolated database runner must release its container on cancellation."""

import signal
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("signum", [signal.SIGINT, signal.SIGTERM])
def test_database_runner_cleans_up_on_signal(tmp_path, signum):
    record = tmp_path / "docker-actions.txt"
    # Intercept Docker in a child process, then deliver a real cancellation signal
    # after creation. No Docker daemon, container or database is touched.
    script = """
import os, runpy, signal, subprocess, sys
from pathlib import Path
record = Path(sys.argv[2])
def docker(args, **kwargs):
    if args[:2] == ('docker', 'run'):
        record.write_text('created')
        os.kill(os.getpid(), int(sys.argv[3]))
    elif args[:3] == ['docker', 'rm', '-f']:
        record.write_text(record.read_text() + '\\ncleaned')
    else:
        raise AssertionError('Unexpected subprocess: ' + repr(args))
subprocess.run = docker
runpy.run_path(sys.argv[1], run_name='__main__')
"""
    result = subprocess.run(
        [sys.executable, "-c", script, str(ROOT / "scripts/test-ts-database.py"), str(record), str(int(signum))],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 128 + signum, result.stderr
    assert record.read_text() == "created\ncleaned"
