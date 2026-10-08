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
    def invoke(self, responses, **settings):
        requests = []

        def respond(request, **kwargs):
            requests.append((request, kwargs))
            value = next(responses)
            if isinstance(value, Exception):
                raise value
            return io.BytesIO(json.dumps(value).encode())

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "compose.yaml"
            with patch.dict(os.environ, ENV | settings, clear=True), \
                    patch.object(DEPLOY, "urlopen", side_effect=respond), \
                    patch("sys.stdout", new_callable=io.StringIO):
                DEPLOY.deploy(COMPOSE, output)
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

    def test_superseded_release_guard_and_lookup_failure(self):
        workflow = yaml.safe_load((SCRIPTS.parent / ".github/workflows/ci.yml").read_text())
        steps = workflow["jobs"]["deploy-staging"]["steps"]
        guard = next(step["run"] for step in steps if step.get("id") == "current")
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            git = directory / "git"
            git.write_text('#!/bin/sh\n[ "$FAIL_LOOKUP" = true ] && exit 1\nprintf "%s\\trefs/heads/main\\n" "$REMOTE_SHA"\n')
            git.chmod(0o755)
            for head, fail, expected in ((SHA, "false", "true"), ("b" * 40, "false", "false"),
                                         ("", "true", None), ("", "false", None)):
                with self.subTest(head=head, fail=fail):
                    output = directory / "output"
                    output.write_text("")
                    result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", guard],
                                            env=os.environ | {"PATH": str(directory) + os.pathsep + os.environ["PATH"],
                                                              "GITHUB_SHA": SHA, "REMOTE_SHA": head,
                                                              "FAIL_LOOKUP": fail, "GITHUB_OUTPUT": str(output)},
                                            capture_output=True, text=True)
                    if expected is None:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertEqual(output.read_text(), "")
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertEqual(output.read_text(), f"deploy={expected}\n")
