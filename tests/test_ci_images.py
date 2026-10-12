"""Regression coverage for selective builds and the complete release gate."""

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ci_images", ROOT / "scripts/select-ci-images.py")
IMAGES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMAGES)
CATALOG = json.loads(IMAGES.CATALOG.read_text())
ALL_SERVICES = {image["service"] for image in CATALOG}
MOVING = {"moving-api", "moving-mcp", "moving-migrate"}
TYPESCRIPT = {"platform", "location", "location-migrate", *MOVING}


class ImageSelectionTests(unittest.TestCase):
    def selected(self, *paths):
        return {image["service"] for image in IMAGES.select_images(CATALOG, paths)}

    def test_docs_and_test_only_changes_need_no_application_images(self):
        self.assertEqual(self.selected("docs/runbooks/self-hosted-ci.md", "tests/test_ci_images.py",
                                       "Frontend/tests/test_gateway.py"), set())

    def test_frontend_and_python_consumers(self):
        self.assertEqual(self.selected("Frontend/server.py"), {"web"})
        self.assertEqual(self.selected("requirements.txt", "config/agents.yaml"), {"web", "backend"})
        self.assertEqual(self.selected("src/services/storage.py"), {"web", "backend"})

    def test_flights_changes_include_python_consumers(self):
        self.assertEqual(self.selected("src/mcp_servers/flights/server.py"), {"web", "backend", "flights-mcp"})
        self.assertEqual(self.selected("src/mcp_servers/__init__.py"),
                         {"web", "backend", "flights-mcp", "payments-mcp"})

    def test_shared_http_service_rebuilds_all_consumers(self):
        self.assertEqual(self.selected("src/mcp_servers/http_service.py"),
                         {"web", "backend", "flights-mcp", "payments-mcp"})

    def test_extracted_python_domains_rebuild_their_mcp_images(self):
        self.assertEqual(self.selected("packages/python/flight/src/relohome_flight/schemas.py"),
                         {"web", "backend", "flights-mcp"})
        self.assertEqual(self.selected("packages/python/payment/src/relohome_payment/engine.py"),
                         {"web", "backend", "payments-mcp"})
        self.assertEqual(self.selected("packages/python/mcp-http/src/relohome_mcp_http/__init__.py"),
                         {"web", "backend", "flights-mcp", "payments-mcp"})

    def test_shared_mcp_core_rebuilds_location_and_moving(self):
        self.assertEqual(self.selected("Maps VN/LifeFlow/packages/mcp-core/src/index.ts"),
                         {"location", *MOVING})

    def test_shared_contracts_and_lockfile_rebuild_all_typescript_images(self):
        for path in ("packages/contracts/src/moving.ts", "package.json", "tsconfig.base.json"):
            with self.subTest(path=path):
                self.assertEqual(self.selected("Maps VN/LifeFlow/" + path), TYPESCRIPT)

    def test_root_workspace_lock_rebuilds_web_and_all_typescript_images(self):
        for path in ("package.json", "package-lock.json"):
            self.assertEqual(self.selected(path), {"web", *TYPESCRIPT})
        self.assertEqual(self.selected("scripts/docker-npm.mjs"), TYPESCRIPT)

    def test_domain_dependencies_and_migration_inputs(self):
        self.assertEqual(self.selected("Maps VN/LifeFlow/packages/housing-query/src/query.ts"),
                         {"platform", "location", "location-migrate"})
        self.assertEqual(self.selected("Maps VN/LifeFlow/moving-api/src/app.ts"), MOVING)
        self.assertEqual(self.selected("Maps VN/LifeFlow/database/moving/schema.sql"), {"moving-migrate"})
        self.assertEqual(self.selected("Maps VN/LifeFlow/database/migrations/008_moving_service.sql"),
                         {"location-migrate", "moving-migrate"})

    def test_dockerfiles_and_ignore_files_rebuild_their_consumers(self):
        self.assertEqual(self.selected("Maps VN/LifeFlow/Dockerfile.moving.dockerignore"), MOVING)
        self.assertEqual(self.selected("Maps VN/LifeFlow/platform-api/Dockerfile"), {"platform", "location-migrate"})
        self.assertEqual(self.selected("Maps VN/LifeFlow/.dockerignore"), ALL_SERVICES)
        self.assertEqual(self.selected(".dockerignore"), ALL_SERVICES)

    def test_unknown_paths_and_shared_ci_changes_rebuild_everything(self):
        for path in ("new-package/build.config", "scripts/select-ci-images.py", "config/ci/application-images.json",
                     ".github/workflows/build-application-images.yml", "scripts/check-ci-runner.sh"):
            with self.subTest(path=path):
                self.assertEqual(self.selected(path), ALL_SERVICES)

    def test_no_similarly_named_directory_matches(self):
        self.assertEqual(self.selected("Frontend-extra/build.js"), ALL_SERVICES)

    def run_selector(self, event, paths=(), base="a" * 40, diff_error=None):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            env = {"GITHUB_EVENT_NAME": event, "PR_BASE_SHA": base, "GITHUB_OUTPUT": str(output)}
            with patch.dict(os.environ, env), patch.object(IMAGES, "changed_paths", return_value=paths,
                                                          side_effect=diff_error) as diff:
                IMAGES.main()
            fields = dict(line.split("=", 1) for line in output.read_text().splitlines())
            return json.loads(fields["matrix"]), int(fields["count"]), diff.called

    def test_main_develop_and_manual_runs_always_build_the_complete_release(self):
        for event in ("push", "workflow_dispatch"):
            matrix, count, diff_called = self.run_selector(event, ["README.md"])
            self.assertEqual(count, len(CATALOG))
            self.assertEqual({image["service"] for image in matrix["include"]}, ALL_SERVICES)
            self.assertFalse(diff_called)

    def test_pr_outputs_contain_only_build_fields_and_allow_no_images(self):
        matrix, count, _ = self.run_selector("pull_request", ["Frontend/server.py"])
        self.assertEqual(count, 1)
        self.assertEqual(matrix["include"][0]["service"], "web")
        self.assertEqual(set(matrix["include"][0]), {"service", "context", "dockerfile", "target"})
        self.assertEqual(self.run_selector("pull_request", ["README.md"])[:2], ({"include": []}, 0))

    def test_missing_base_and_failed_diff_fall_back_to_all_images(self):
        error = subprocess.CalledProcessError(128, ["git", "diff"])
        self.assertEqual(self.run_selector("pull_request", diff_error=error)[1], len(CATALOG))
        self.assertEqual(self.run_selector("pull_request", base="")[1], len(CATALOG))

    def test_git_diff_tracks_deleted_and_renamed_paths_with_spaces(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

            git("init", "-q")
            git("config", "user.email", "ci-test@example.test")
            git("config", "user.name", "CI test")
            old = root / "Maps VN/LifeFlow/moving-api/old.ts"
            old.parent.mkdir(parents=True)
            old.write_text("old code\n")
            git("add", ".")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")
            new = root / "Frontend/new.ts"
            new.parent.mkdir()
            old.rename(new)
            git("add", "-A")
            git("commit", "-qm", "move")
            with patch.object(IMAGES, "ROOT", root):
                paths = IMAGES.changed_paths(base)
            self.assertCountEqual(paths, ["Maps VN/LifeFlow/moving-api/old.ts", "Frontend/new.ts"])
            self.assertEqual(self.selected(*paths), {"web", *MOVING})


class CIResultsGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
        cls.script = workflow["jobs"]["gate"]["steps"][0]["run"]

    def gate(self, **changes):
        env = {**os.environ, "SELECTION": "success", "PYTHON": "success", "MCP": "success",
               "TYPESCRIPT": "success", "IMAGES": "success", "IMAGE_COUNT": "9", "EVENT": "push", **changes}
        return subprocess.run(["bash", "-eo", "pipefail", "-c", self.script], env=env,
                              capture_output=True, timeout=5).returncode

    def test_complete_release_and_docs_only_pr_pass(self):
        self.assertEqual(self.gate(), 0)
        self.assertEqual(self.gate(EVENT="pull_request", IMAGE_COUNT="0", IMAGES="skipped"), 0)

    def test_failed_cancelled_and_skipped_requested_jobs_fail(self):
        for job in ("SELECTION", "PYTHON", "MCP", "TYPESCRIPT", "IMAGES"):
            for result in ("failure", "cancelled", "skipped"):
                with self.subTest(job=job, result=result):
                    self.assertNotEqual(self.gate(**{job: result}), 0)

    def test_release_cannot_pass_with_no_images_or_missing_count(self):
        self.assertNotEqual(self.gate(IMAGE_COUNT="0", IMAGES="skipped"), 0)
        self.assertNotEqual(self.gate(IMAGE_COUNT="", IMAGES="skipped"), 0)
        self.assertNotEqual(self.gate(IMAGE_COUNT="", IMAGES="success"), 0)
        self.assertNotEqual(self.gate(IMAGE_COUNT="invalid", IMAGES="success"), 0)


if __name__ == "__main__":
    unittest.main()
