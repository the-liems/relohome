"""Regression coverage for runner tool prerequisites."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASH = shutil.which("bash")


class RunnerPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        (self.directory / "bash").symlink_to(BASH)
        tools = {
            "git": 'printf "git fixture\\n"',
            "uname": 'if [ "$1" = -s ]; then printf "%s\\n" "${TEST_OS:-Linux}"; else printf "aarch64\\n"; fi',
            "openssl": 'printf "OpenSSL fixture\\n"',
            "docker": 'if [ "$*" = "compose version --short" ]; then printf "%s\\n" "$TEST_COMPOSE_VERSION"; elif [ "$*" = "buildx version" ] && [ "${TEST_BUILDX_MISSING:-}" = 1 ]; then exit 1; else printf "Docker fixture\\n"; fi',
            "node": 'if [ "$1" = -p ]; then printf "%s\\n" "$TEST_NODE_MAJOR"; else printf "v%s.0.0\\n" "$TEST_NODE_MAJOR"; fi',
            "npm": 'printf "npm fixture\\n"',
        }
        for name, body in tools.items():
            path = self.directory / name
            path.write_text("#!/bin/sh\n" + body + "\n")
            path.chmod(0o755)

    def run_check(self, *capabilities, **settings):
        return subprocess.run(
            [BASH, str(ROOT / "scripts/check-ci-runner.sh"), *capabilities],
            env={**os.environ, "PATH": str(self.directory), **settings},
            text=True, capture_output=True, timeout=10,
        )

    def test_compose_rejects_every_version_below_required_boundary(self):
        for version in ("1.29.2", "2.20.0", "2.23.9", "2.24.0", "2.24.1", "2.24.2", "2.24.3"):
            with self.subTest(version=version):
                result = self.run_check("compose", TEST_COMPOSE_VERSION=version)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Docker Compose >= 2.24.4 required", result.stderr)
                self.assertIn(version, result.stderr)

    def test_compose_accepts_boundary_and_newer_versions(self):
        for version in ("2.24.4", "v2.24.4", "2.25.0", "2.40.0-desktop.1", "3.0.0", "5.0.0"):
            with self.subTest(version=version):
                result = self.run_check("compose", TEST_COMPOSE_VERSION=version)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_compose_rejects_unrecognized_versions(self):
        for version in ("", "2.24", "garbage", "2.24.rc1"):
            with self.subTest(version=version):
                result = self.run_check("compose", TEST_COMPOSE_VERSION=version)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Unrecognized Docker Compose version", result.stderr)

    def test_base_and_docker_checks_do_not_require_mcp_build_tools(self):
        self.assertEqual(self.run_check().returncode, 0)
        self.assertEqual(self.run_check("docker").returncode, 0)
        result = self.run_check("mcp")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing required tool: make", result.stderr)
        for name in ("make", "awk", "basename", "dirname", "xargs"):
            tool = self.directory / name
            tool.write_text("#!/bin/sh\nexit 0\n")
            tool.chmod(0o755)
        self.assertEqual(self.run_check("mcp").returncode, 0)
        result = self.run_check("mcp", TEST_BUILDX_MISSING="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Docker Buildx is required", result.stderr)
        self.assertEqual(self.run_check("buildx").returncode, 0)
        result = self.run_check("buildx", TEST_BUILDX_MISSING="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Docker Buildx is required", result.stderr)

    def test_wrong_os_and_node_version_explain_required_capabilities(self):
        result = self.run_check(TEST_OS="Darwin")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("CI requires Linux, found Darwin", result.stderr)
        result = self.run_check("node", TEST_NODE_MAJOR="22")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Node.js 24 required, found v22.0.0", result.stderr)
        self.assertEqual(self.run_check("node22", TEST_NODE_MAJOR="22").returncode, 0)
