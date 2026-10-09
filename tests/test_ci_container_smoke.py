"""Failure-path coverage for resource ownership on persistent CI runners."""

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
FAKE_TOOL = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
tool = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["SMOKE_LOG"], "a") as log:
    log.write(json.dumps([tool, *args]) + "\\n")
mode = os.environ.get("SMOKE_FAILURE", "")
if tool == "docker":
    if args[0] in ("run", "create"):
        if mode == "start": sys.exit(125)
        print("container-id")
    elif args[0] == "exec":
        if mode == "health":
            print("Connection refused", file=sys.stderr)
            sys.exit(1)
        if mode == "http":
            print("HTTP Error 500", file=sys.stderr)
            sys.exit(1)
        print('{"status":"ok"}')
    elif args[0] == "cp" and mode == "copy": sys.exit(1)
'''


class MCPSmokeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        for tool in ("docker", "sleep"):
            path = self.directory / tool
            path.write_text(FAKE_TOOL)
            path.chmod(0o755)

    def start(self, run_id, failure=""):
        log = self.directory / f"{run_id}.jsonl"
        env = {
            **os.environ,
            "PATH": f"{self.directory}{os.pathsep}{os.environ['PATH']}",
            "SMOKE_LOG": str(log),
            "SMOKE_FAILURE": failure,
            "GITHUB_RUN_ID": str(run_id),
            "GITHUB_RUN_ATTEMPT": "1",
            "MCP_IMAGE_TAG": f"ci-{run_id}-1",
        }
        process = subprocess.Popen(
            ["bash", "scripts/smoke-mcp-containers.sh"],
            cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        return process, log

    def finish(self, process, log):
        output, error = process.communicate(timeout=15)
        return [json.loads(line) for line in log.read_text().splitlines()], output, error

    def assert_owned_cleanup(self, calls):
        starts = [call for call in calls if call[:2] == ["docker", "run"]]
        names = [call[call.index("--name") + 1] for call in starts]
        removals = [call[3] for call in calls if call[:3] == ["docker", "rm", "-fv"]]
        self.assertCountEqual(names, removals)
        for call in starts:
            self.assertNotIn("-p", call)
        return names

    def test_cleanup_after_partial_start_health_timeout_and_http_failure(self):
        for run_id, failure in enumerate(("start", "health", "http"), start=1):
            with self.subTest(failure=failure):
                process, log = self.start(run_id, failure)
                calls, _, error = self.finish(process, log)
                self.assertNotEqual(process.returncode, 0)
                self.assert_owned_cleanup(calls)
                self.assertTrue(any(call[:2] == ["docker", "logs"] for call in calls))
                if failure == "health":
                    self.assertIn("Last /health probe error: Connection refused", error)
                if failure == "http":
                    self.assertIn("Last /health probe error: HTTP Error 500", error)

    def test_overlapping_runs_use_separate_containers_and_images(self):
        first, first_log = self.start(101)
        second, second_log = self.start(102)
        first_calls, first_output, _ = self.finish(first, first_log)
        second_calls, second_output, _ = self.finish(second, second_log)
        self.assertEqual(first.returncode, 0)
        self.assertEqual(second.returncode, 0)
        self.assertIn('{"status":"ok"}', first_output)
        self.assertIn('{"status":"ok"}', second_output)
        first_names = self.assert_owned_cleanup(first_calls)
        second_names = self.assert_owned_cleanup(second_calls)
        self.assertTrue(set(first_names).isdisjoint(second_names))
        for run_id, calls in ((101, first_calls), (102, second_calls)):
            probes = [call for call in calls if call[:2] == ["docker", "exec"]]
            self.assertEqual(len(probes), 2)
            self.assertTrue(all("127.0.0.1" in " ".join(call) for call in probes))
            self.assertFalse(any(call[:2] == ["docker", "inspect"] for call in calls))
            for call in calls:
                if call[:2] == ["docker", "run"]:
                    self.assertTrue(call[-1].endswith(f":ci-{run_id}-1"))
                    self.assertIn(f"lifeflow.ci.mcp=ci-{run_id}-1", call)

    def test_moving_verifier_owns_network_and_cleanup_even_on_failure(self):
        for mode in ("", "start", "copy", "http"):
            with self.subTest(failure=mode):
                log = self.directory / f"moving-{mode}.jsonl"
                project = "moving-ci-301-2"
                env = {
                    **os.environ,
                    "PATH": f"{self.directory}{os.pathsep}{os.environ['PATH']}",
                    "SMOKE_LOG": str(log), "SMOKE_FAILURE": mode,
                    "COMPOSE_PROJECT_NAME": project,
                }
                result = subprocess.run(
                    ["bash", str(ROOT / "Maps VN/LifeFlow/scripts/verify-moving-ci.sh")],
                    cwd=self.directory, env=env, capture_output=True, timeout=15,
                )
                self.assertEqual(result.returncode == 0, mode == "")
                calls = [json.loads(line) for line in log.read_text().splitlines()]
                create = next(call for call in calls if call[:2] == ["docker", "create"])
                self.assertIn(f"{project}_default", create)
                self.assertNotIn("-v", create)
                self.assertIn(["docker", "rm", "-fv", f"{project}-verify"], calls)
                self.assertFalse(any(".env" in arg for call in calls for arg in call))


class AgentSmokeTests(unittest.TestCase):
    def test_termination_before_container_name_does_not_enter_cleanup(self):
        spec = importlib.util.spec_from_file_location("agent_smoke", ROOT / "scripts/smoke-agent-containers.py")
        smoke = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(smoke)
        with (
            patch.object(smoke.signal, "signal"),
            patch.object(smoke.secrets, "token_urlsafe", side_effect=SystemExit(143)),
            patch.object(smoke, "docker") as docker,
            patch.object(smoke, "remove") as cleanup,
        ):
            with self.assertRaises(SystemExit) as terminated:
                smoke.main()
        self.assertEqual(terminated.exception.code, 143)
        docker.assert_not_called()
        cleanup.assert_not_called()

    def test_partial_docker_start_is_cleaned_up_with_run_scoped_image(self):
        spec = importlib.util.spec_from_file_location("agent_smoke", ROOT / "scripts/smoke-agent-containers.py")
        smoke = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(smoke)
        failure = subprocess.CalledProcessError(125, ["docker", "run"])
        with (
            patch.dict(os.environ, {"AGENT_IMAGE_TAG": "ci-201-1"}),
            patch.object(smoke.signal, "signal"),
            patch.object(smoke, "docker", side_effect=failure) as docker,
            patch.object(smoke.subprocess, "run") as cleanup,
        ):
            cleanup.return_value.returncode = 0
            with self.assertRaises(subprocess.CalledProcessError):
                smoke.main()
        args = docker.call_args_list[0].args
        self.assertIn("lifeflow-intake:ci-201-1", args)
        self.assertIn("lifeflow.ci.agents=ci-201-1", args)
        self.assertIn("/app/data:mode=1777", args)
        self.assertEqual(cleanup.call_args.args[0], ["docker", "rm", "-fv", args[args.index("--name") + 1]])
