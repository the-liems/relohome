"""Release submission: preserve infrastructure and hand rollout to Coolify."""

import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import yaml

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DEPLOY = load_script("deploy-coolify")
SHA = "a" * 40
REPOSITORY = "ai20k-build-phase-cohort-4/p-044"
COMPOSE = Path(__file__).parent / "fixtures/coolify-compose.yaml"
TAG = SHA + "-123-1"
ENV = {"COOLIFY_URL": "https://coolify.example.test",
       "COOLIFY_SERVICE_UUID": "staging-service", "COOLIFY_TOKEN": "private-test-token",
       "RELEASE_TAG": TAG, "IMAGE_PREFIX": "ghcr.io/" + REPOSITORY}


class DeploymentTests(unittest.TestCase):
    def invoke(self, responses, image_error=None, compose_text=None, **settings):
        requests = []

        def respond(request, **kwargs):
            requests.append((request, kwargs))
            value = next(responses)
            if isinstance(value, Exception):
                raise value
            return io.BytesIO(json.dumps(value).encode())

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "compose.yaml"
            source = Path(directory) / "source.yaml"
            source.write_text(compose_text if compose_text is not None else COMPOSE.read_text())
            with patch.dict(os.environ, ENV | settings, clear=True), \
                    patch.object(DEPLOY, "urlopen", side_effect=respond), \
                    patch.object(DEPLOY.subprocess, "run", side_effect=image_error), \
                    patch("sys.stdout", new_callable=io.StringIO):
                DEPLOY.deploy(source, output)
        return requests

    @staticmethod
    def saved():
        return {"docker_compose_raw": DEPLOY.render(COMPOSE.read_text(), ENV["IMAGE_PREFIX"], TAG)}

    @staticmethod
    def variables():
        return [{"key": "API_TOKEN", "value": "private-test-token"},
                {"key": "DB_PASSWORD", "value": "private-test-password"},
                {"key": "AHAMOVE_USER_TOKEN", "value": "private-test-ahamove-token"}]

    def test_running_service_restarts_without_polling(self):
        requests = self.invoke(iter([self.saved(), {}, self.saved(), self.variables(),
                                     {"message": "Service restarting request queued."}]))
        self.assertEqual([(request.get_method(), request.full_url) for request, _ in requests], [
            ("GET", "https://coolify.example.test/api/v1/services/staging-service"),
            ("PATCH", "https://coolify.example.test/api/v1/services/staging-service"),
            ("GET", "https://coolify.example.test/api/v1/services/staging-service"),
            ("GET", "https://coolify.example.test/api/v1/services/staging-service/envs"),
            ("POST", "https://coolify.example.test/api/v1/services/staging-service/restart?latest=true"),
        ])
        self.assertTrue(all(kwargs["context"].check_hostname for _, kwargs in requests))

    def test_ahamove_accepts_either_complete_credential_form(self):
        for credentials in ({"AHAMOVE_USER_TOKEN": " token "},
                            {"AHAMOVE_API_KEY": " key ", "AHAMOVE_MOBILE": " mobile "}):
            with self.subTest(keys=list(credentials)):
                variables = [item for item in self.variables() if not item["key"].startswith("AHAMOVE_")]
                variables.extend({"key": key, "value": value} for key, value in credentials.items())
                requests = self.invoke(iter([self.saved(), {}, self.saved(), variables, {}]))
                self.assertTrue(requests[-1][0].full_url.endswith("/restart?latest=true"))

    def test_incomplete_ahamove_credentials_stop_before_restart(self):
        for credentials in ({}, {"AHAMOVE_API_KEY": "private-key"}, {"AHAMOVE_MOBILE": "mobile"},
                            {"AHAMOVE_USER_TOKEN": " ", "AHAMOVE_API_KEY": "private-key", "AHAMOVE_MOBILE": " "}):
            with self.subTest(keys=list(credentials)):
                variables = [item for item in self.variables() if not item["key"].startswith("AHAMOVE_")]
                variables.extend({"key": key, "value": value} for key, value in credentials.items())
                # No restart response is supplied: attempting it would fail the test.
                with self.assertRaisesRegex(RuntimeError, "Set AHAMOVE_USER_TOKEN or both AHAMOVE_API_KEY"):
                    self.invoke(iter([self.saved(), {}, self.saved(), variables]))

    def test_empty_resolved_ahamove_token_stops_before_restart(self):
        variables = self.variables()
        variables[-1].update(value="{{environment.AHAMOVE_USER_TOKEN}}", real_value="")
        with self.assertRaisesRegex(RuntimeError, "Set AHAMOVE_USER_TOKEN or both AHAMOVE_API_KEY"):
            self.invoke(iter([self.saved(), {}, self.saved(), variables]))

    def test_missing_or_unreadable_image_stops_before_any_coolify_request(self):
        for error in (subprocess.CalledProcessError(1, "docker", stderr=b"private-registry-response"),
                      subprocess.TimeoutExpired("docker", 30), FileNotFoundError("docker")):
            with self.subTest(error=type(error).__name__), self.assertRaisesRegex(RuntimeError, "Cannot read image manifest"):
                self.invoke(iter([]), image_error=error)

    def test_every_distinct_image_is_checked_before_coolify(self):
        calls = []

        def inspect(command, **kwargs):
            calls.append((command, kwargs))

        self.invoke(iter([self.saved(), {}, self.saved(), self.variables(), {}]), image_error=inspect)
        self.assertEqual([command for command, _ in calls], [
            ["docker", "manifest", "inspect", ENV["IMAGE_PREFIX"] + "/app:" + TAG],
            ["docker", "manifest", "inspect", "postgres:16-bookworm"],
        ])
        self.assertTrue(all(kwargs["check"] and kwargs["timeout"] == 30 for _, kwargs in calls))

    def test_older_compose_without_ahamove_does_not_require_its_credentials(self):
        definition = yaml.safe_load(COMPOSE.read_text())
        environment = definition["services"]["app"]["environment"]
        for key in list(environment):
            if key.startswith("AHAMOVE_"):
                del environment[key]
        # An unused extension must not impose credentials on the actual services.
        definition["x-unused"] = {"AHAMOVE_USER_TOKEN": "${AHAMOVE_USER_TOKEN:-}"}
        source = yaml.safe_dump(definition)
        saved = {"docker_compose_raw": DEPLOY.render(source, ENV["IMAGE_PREFIX"], TAG)}
        variables = [item for item in self.variables() if not item["key"].startswith("AHAMOVE_")]
        requests = self.invoke(iter([saved, {}, saved, variables, {}]), compose_text=source)
        self.assertTrue(requests[-1][0].full_url.endswith("/restart?latest=true"))

    def test_rejected_restart_request_fails_the_job(self):
        error = HTTPError("https://coolify.example.test", 503, "Unavailable", {}, io.BytesIO())
        with self.assertRaisesRegex(RuntimeError, r"POST /services/staging-service/restart\?latest=true returned HTTP 503"):
            self.invoke(iter([self.saved(), {}, self.saved(), self.variables(), error]))

    def test_wrong_image_references_stop_before_start(self):
        with self.assertRaisesRegex(RuntimeError, "did not retain"):
            self.invoke(iter([self.saved(), {}, {"docker_compose_raw": "services: {}"}]))

    def test_infrastructure_changes_must_be_retained_before_start(self):
        for change in ("volume", "environment", "service"):
            saved = yaml.safe_load(self.saved()["docker_compose_raw"])
            if change == "volume":
                saved["services"]["db"]["volumes"] = ["wrong-data:/var/lib/postgresql/data"]
            elif change == "environment":
                saved["services"]["app"]["environment"]["API_TOKEN"] = "wrong-value"
            else:
                saved["services"].pop("app")
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, "did not retain"):
                self.invoke(iter([self.saved(), {}, {"docker_compose_raw": yaml.safe_dump(saved)}]))

    def test_missing_required_variable_stops_before_service_start(self):
        variables = [item for item in self.variables() if item["key"] != "API_TOKEN"]
        with self.assertRaisesRegex(RuntimeError, "Set required Coolify variables.*API_TOKEN"):
            self.invoke(iter([self.saved(), {}, self.saved(), variables]))

    def test_empty_resolved_shared_variable_is_not_treated_as_configured(self):
        variables = self.variables()
        for item in variables:
            if item["key"] == "API_TOKEN":
                item.update(value="{{environment.API_TOKEN}}", real_value="")
        with self.assertRaisesRegex(RuntimeError, "Set required Coolify variables.*API_TOKEN"):
            self.invoke(iter([self.saved(), {}, self.saved(), variables]))

    def test_missing_read_sensitive_stops_before_mutation(self):
        with self.assertRaisesRegex(RuntimeError, "read:sensitive"):
            self.invoke(iter([{}]))

    def test_api_error_does_not_disclose_response_body_or_token(self):
        error = HTTPError("https://coolify.example.test", 403, "private-test-token", {}, io.BytesIO(b"secret-body"))
        with self.assertRaises(RuntimeError) as raised:
            self.invoke(iter([error]))
        self.assertIn("HTTP 403", str(raised.exception))
        self.assertNotIn("private-test-token", str(raised.exception))
        self.assertNotIn("secret-body", str(raised.exception))

    def test_unencrypted_control_url_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            self.invoke(iter([]), COOLIFY_URL="http://coolify.example.test")

    def test_render_preserves_infrastructure_labels_and_runtime_variables(self):
        source = COMPOSE.read_text()
        expected = yaml.safe_load(source)
        expected["services"]["app"]["image"] = ENV["IMAGE_PREFIX"] + "/app:" + TAG
        rendered = DEPLOY.render(source, ENV["IMAGE_PREFIX"], TAG)
        self.assertEqual(yaml.safe_load(rendered), expected)
        self.assertIn("# Minimal stack", rendered)


class RepositoryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.compose = yaml.safe_load((SCRIPTS.parent / "compose.coolify.yaml").read_text())

    def test_every_release_image_has_a_workflow_build(self):
        workflow = yaml.safe_load((SCRIPTS.parent / ".github/workflows/ci.yml").read_text())
        builds = workflow["jobs"]["application-images"]["strategy"]["matrix"]["include"]
        expected = {service["image"].split("/")[-1].split(":")[0]
                    for service in self.compose["services"].values()
                    if service["image"].startswith("${IMAGE_PREFIX}/")}
        self.assertEqual({build["service"] for build in builds}, expected)
        self.assertTrue(all("build" not in service for service in self.compose["services"].values()))

    def test_volume_sources_do_not_use_coolify_unsupported_interpolation(self):
        for name, service in self.compose["services"].items():
            for volume in service.get("volumes", []):
                source = volume.split(":", 1)[0] if isinstance(volume, str) else volume.get("source", "")
                with self.subTest(service=name, source=source):
                    self.assertNotIn("${", source)

    def test_internal_web_paths_are_blocked_at_the_proxy(self):
        labels = self.compose["services"]["web"]["labels"]
        rule = next(label.split("=", 1)[1] for label in labels
                    if label.startswith("traefik.http.routers.p044-internal.rule="))
        self.assertIn("Host(`staging.c4-app-044.io.vn`)", rule)
        for path in ("/health", "/docs", "/redoc", "/openapi.json"):
            self.assertIn(f"(`{path}`)", rule)
        self.assertIn("traefik.http.routers.p044-internal.service=noop@internal", labels)

    def test_tester_payment_control_is_limited_to_configured_accounts(self):
        # payment-design D10: the tester "paid" control never ships to production and
        # only listed gateway accounts see it. An unset list means nobody.
        backend = self.compose["services"]["backend"]["environment"]
        self.assertNotEqual(backend["APP_ENV"], "production")
        self.assertEqual(backend["PAYMENT_TESTER_USER_IDS"], "${PAYMENT_TESTER_USER_IDS:-}")
        self.assertEqual(backend["PAYMENT_ZALOPAY_ENDPOINT"], "https://sb-openapi.zalopay.vn/v2")
        # Simulated booking tools stay on the internal network.
        flights = self.compose["services"]["flights-mcp"]
        self.assertNotIn("ports", flights)
        self.assertNotIn("labels", flights)
        exposed = [name for name, service in self.compose["services"].items()
                   if "ports" in service or "expose" in service]
        self.assertEqual(exposed, ["web"])



class ReleaseSelectionTests(unittest.TestCase):
    """Execute the workflow's selector against GitHub API responses without network access."""

    @classmethod
    def setUpClass(cls):
        workflow = yaml.safe_load((SCRIPTS.parent / ".github/workflows/deploy-staging.yml").read_text())
        cls.script = next(step["with"]["script"] for step in workflow["jobs"]["deploy-staging"]["steps"]
                          if step.get("id") == "release")

    def select(self, run_id="123", trigger="workflow_dispatch", main_sha=SHA, branch_error=False, **changes):
        repository = "AI20K-Build-Phase-Cohort-4/P-044"
        run = {"id": 123, "head_sha": SHA, "path": ".github/workflows/ci.yml",
               "repository": {"full_name": repository}, "head_repository": {"full_name": repository},
               "head_branch": "main", "event": "push", "status": "completed", "conclusion": "success"} | changes
        harness = """
            const fs = require('node:fs');
            const {script, run, trigger, main_sha, branch_error} = JSON.parse(fs.readFileSync(0, 'utf8'));
            const outputs = {}, requests = [];
            const github = {rest: {actions: {getWorkflowRun: async args => {
              requests.push(args); return {data: run};
            }}, repos: {getBranch: async args => {
              requests.push(args);
              if (branch_error) throw new Error('Branch lookup failed');
              return {data: {commit: {sha: main_sha}}};
            }}}};
            const context = {eventName: trigger, repo: {owner: 'AI20K-Build-Phase-Cohort-4', repo: 'P-044'}};
            const core = {setOutput: (key, value) => outputs[key] = value, info: () => {}};
            const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
            (async () => {
              let error = null;
              try { await new AsyncFunction('github', 'context', 'core', script)(github, context, core); }
              catch (e) { error = e.message; }
              process.stdout.write(JSON.stringify({outputs, requests, error}));
            })();
        """
        result = subprocess.run(["node", "-e", harness], input=json.dumps({"script": self.script, "run": run,
                                                                                "trigger": trigger, "main_sha": main_sha,
                                                                                "branch_error": branch_error}),
                                env=os.environ | {"CI_RUN_ID": run_id}, text=True, capture_output=True, check=True)
        return json.loads(result.stdout)

    def test_selects_the_source_ci_tag_for_push_and_manual_ci(self):
        for event in ("push", "workflow_dispatch"):
            with self.subTest(event=event):
                result = self.select(event=event)
                self.assertIsNone(result["error"])
                self.assertEqual(result["outputs"], {"deploy": "true", "sha": SHA, "tag": SHA + "-123"})
                self.assertEqual(result["requests"][0]["run_id"], 123)

    def test_rejects_unpublished_or_untrusted_runs(self):
        for changes in ({"path": ".github/workflows/moving.yml"}, {"head_branch": "develop"},
                        {"event": "pull_request"}, {"event": "pull_request_target"},
                        {"status": "in_progress"}, {"conclusion": "failure"}, {"conclusion": "cancelled"},
                        {"repository": {"full_name": "someone/P-044"}},
                        {"head_repository": {"full_name": "someone/P-044"}},
                        {"head_repository": None}, {"head_sha": "main"}):
            with self.subTest(changes=changes):
                result = self.select(**changes)
                self.assertIn("successful, completed main CI run", result["error"])
                self.assertEqual(result["outputs"], {})

    def test_rejects_invalid_ids_before_api_access(self):
        for run_id in ("", "0", "-1", "1.2", "123/attempts/1", "9007199254740992"):
            with self.subTest(run_id=run_id):
                result = self.select(run_id=run_id)
                self.assertIn("numeric CI run ID", result["error"])
                self.assertEqual(result["requests"], [])
                self.assertEqual(result["outputs"], {})


    def test_superseded_automatic_release_skips_before_setup(self):
        result = self.select(trigger="workflow_run", main_sha="b" * 40)
        self.assertIsNone(result["error"])
        self.assertEqual(result["outputs"], {"deploy": "false"})

    def test_current_automatic_release_can_deploy(self):
        result = self.select(trigger="workflow_run")
        self.assertIsNone(result["error"])
        self.assertEqual(result["outputs"], {"deploy": "true", "sha": SHA, "tag": SHA + "-123"})
        self.assertEqual(result["requests"][-1]["branch"], "main")

    def test_automatic_branch_lookup_failure_stops_release(self):
        for settings in ({"branch_error": True}, {"main_sha": ""}):
            with self.subTest(settings=settings):
                result = self.select(trigger="workflow_run", **settings)
                self.assertIsNotNone(result["error"])
                self.assertEqual(result["outputs"], {})

    def test_manual_older_release_does_not_need_current_main(self):
        result = self.select(main_sha="b" * 40, branch_error=True)
        self.assertIsNone(result["error"])
        self.assertEqual(result["outputs"]["deploy"], "true")
        self.assertEqual(len(result["requests"]), 1)
