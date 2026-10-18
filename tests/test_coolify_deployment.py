"""Pinned Application rollout and Compose deployment contracts."""

import importlib.util
import io
import json
import os
import re
import shutil
import ssl
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import yaml

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("deploy_coolify", ROOT / "scripts/deploy-coolify.py")
DEPLOY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEPLOY)
SHA = "a" * 40
ENV = {"COOLIFY_URL": "https://coolify.example.test", "COOLIFY_APP_UUID": "staging-app",
       "COOLIFY_TOKEN": "private-test-token", "DEPLOY_SHA": SHA}
COMPOSE = {"services": {"app": {"image": DEPLOY.IMAGE_PREFIX + "app:${SOURCE_COMMIT}"},
                        "worker": {"image": DEPLOY.IMAGE_PREFIX + "worker:${SOURCE_COMMIT}"},
                        "db": {"image": "postgres:16"}}}
QUEUED = {"deployments": [{"resource_uuid": "other-app", "deployment_uuid": "other"},
                          {"resource_uuid": "staging-app", "deployment_uuid": "deployment-1"}]}
FINISHED = {"status": "finished", "commit": SHA}


class DeploymentTests(unittest.TestCase):
    def invoke(self, responses, *, image_error=None, compose=COMPOSE, **settings):
        self.requests = []
        self.output = io.StringIO()

        def respond(request, **kwargs):
            self.requests.append((request, kwargs))
            response = next(responses)
            if isinstance(response, Exception):
                raise response
            return io.BytesIO(json.dumps(response).encode())

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "compose.yaml"
            source.write_text(yaml.safe_dump(compose))
            with patch.dict(os.environ, ENV, clear=True), \
                    patch.object(DEPLOY, "urlopen", side_effect=respond), \
                    patch.object(DEPLOY.subprocess, "run", side_effect=image_error) as inspect, \
                    patch("sys.stdout", self.output):
                DEPLOY.deploy(source, interval=0, **settings)
        return inspect

    @staticmethod
    def prefix():
        return [{}, {"git_commit_sha": SHA}, QUEUED]

    def test_preview_checks_its_own_health_without_changing_parent(self):
        self.invoke(iter([{'deployment_uuid': 'preview-1'}, FINISHED,
                          {'status': 'running:unhealthy'}, {'status': 'running:healthy'}]), preview_id=200)
        request = self.requests[0][0]
        self.assertEqual(request.get_method(), 'POST')
        self.assertTrue(request.full_url.endswith('/applications/staging-app/previews'))
        self.assertEqual(json.loads(request.data), {'pull_request_id': 200, 'git_type': 'github', 'commit': SHA})
        self.assertTrue(all(r.get_method() != 'PATCH' for r, _ in self.requests))
        self.assertTrue(self.requests[-1][0].full_url.endswith('/previews/200'))

    def test_preview_rejects_wrong_commit(self):
        with self.assertRaisesRegex(RuntimeError, 'commit mismatch'):
            self.invoke(iter([{'deployment_uuid': 'preview-1'},
                              {'status': 'finished', 'commit': 'b' * 40}]), preview_id=200)

    def test_preview_rejects_invalid_id_before_network(self):
        for number in (0, -1, 2147483648):
            with self.subTest(number=number), self.assertRaisesRegex(ValueError, 'Preview ID'):
                self.invoke(iter([]), preview_id=number)
            self.assertEqual(self.requests, [])

    def test_success_waits_for_deployment_and_application_health(self):
        inspect = self.invoke(iter(self.prefix() + [{"status": "queued"}, {"status": "in_progress"},
                                                   FINISHED, {"status": "running:unhealthy"},
                                                   {"status": "running:healthy"}]))
        self.assertEqual([call.args[0] for call in inspect.call_args_list], [
            ["docker", "manifest", "inspect", DEPLOY.IMAGE_PREFIX + "app:" + SHA],
            ["docker", "manifest", "inspect", DEPLOY.IMAGE_PREFIX + "worker:" + SHA],
        ])
        request = self.requests[0][0]
        self.assertEqual(request.get_method(), "PATCH")
        self.assertEqual(json.loads(request.data), {"git_commit_sha": SHA, "is_auto_deploy_enabled": False,
                                                  "include_source_commit_in_build": True,
                                                  "is_container_label_escape_enabled": False})
        self.assertTrue(request.full_url.endswith("/applications/staging-app"))
        self.assertTrue(self.requests[2][0].full_url.endswith("/deploy?uuid=staging-app"))
        self.assertEqual(self.requests[2][0].get_method(), "POST")
        self.assertTrue(self.requests[3][0].full_url.endswith("/deployments/deployment-1"))
        self.assertTrue(all(kwargs["context"].check_hostname and kwargs["context"].verify_mode == ssl.CERT_REQUIRED
                            for _, kwargs in self.requests))
        self.assertEqual(len(self.output.getvalue().splitlines()), 1)
        self.assertIn(SHA, self.output.getvalue())
        self.assertNotIn(ENV["COOLIFY_TOKEN"], self.output.getvalue())

    def test_missing_images_are_all_listed_before_api_access(self):
        error = subprocess.CalledProcessError(1, "docker", stderr=b"private registry response")
        with self.assertRaisesRegex(RuntimeError, "app:" + SHA + ".*worker:" + SHA):
            self.invoke(iter([]), image_error=error)
        self.assertEqual(self.requests, [])

    def test_commits_without_git_pinned_images_fail_before_api_access(self):
        for images in ([], [DEPLOY.IMAGE_PREFIX + "app:old-tag"], ["other/app:${SOURCE_COMMIT}"]):
            with self.subTest(images=images), self.assertRaises(ValueError) as error:
                self.invoke(iter([]), compose={"services": {str(i): {"image": image}
                                                           for i, image in enumerate(images)}})
            self.assertEqual(str(error.exception),
                             "This commit predates Git-pinned deploys (its Compose file does not use ${SOURCE_COMMIT}); "
                             "deploy a commit at or after the Git-pinned deployment merge.")
            self.assertEqual(self.requests, [])

    def test_patch_must_retain_commit(self):
        with self.assertRaisesRegex(RuntimeError, "did not retain git_commit_sha"):
            self.invoke(iter([{}, {"git_commit_sha": "b" * 40}]))
        self.assertEqual(len(self.requests), 2)

    def test_failed_deployment_prints_only_last_40_non_hidden_lines(self):
        logs = [{"output": "\n".join(f"line {i}" for i in range(50))}, {"output": "secret", "hidden": True}]
        with self.assertRaisesRegex(RuntimeError, "status: failed"):
            self.invoke(iter(self.prefix() + [{"status": "failed", "commit": SHA, "logs": json.dumps(logs)}]))
        self.assertEqual(self.output.getvalue().splitlines(), [f"line {i}" for i in range(10, 50)])

    def test_cancelled_and_timed_out_deployments_fail(self):
        for status in ("cancelled-by-user", "in_progress"):
            with self.subTest(status=status), self.assertRaises(RuntimeError):
                self.invoke(iter(self.prefix() + [{"status": status}]), deployment_timeout=0)

    def test_finished_commit_must_match(self):
        with self.assertRaisesRegex(RuntimeError, "commit mismatch"):
            self.invoke(iter(self.prefix() + [{"status": "finished", "commit": "b" * 40}]))

    def test_running_without_healthcheck_is_accepted(self):
        self.invoke(iter(self.prefix() + [FINISHED, {"status": "running:unknown"}]))
        self.assertIn("running:unknown", self.output.getvalue())
        self.invoke(iter([{'deployment_uuid': 'preview-1'}, FINISHED,
                          {'status': 'running:unknown'}]), preview_id=200)
        self.assertIn("running:unknown", self.output.getvalue())

    def test_unhealthy_stopped_and_missing_statuses_are_rejected(self):
        for status in ("running:unhealthy", "degraded:unhealthy", "exited:unhealthy",
                       "starting:unknown", "exited", None):
            with self.subTest(status=status), self.assertRaisesRegex(RuntimeError, "last status:"):
                self.invoke(iter(self.prefix() + [FINISHED, {"status": status}]), health_timeout=0)

    def test_already_queued_missing_deployment_has_clear_error(self):
        queued = {"deployments": [QUEUED["deployments"][1] | {"message": "Deployment already queued for this commit."}]}
        error = HTTPError("https://coolify.example.test", 404, "Not found", {}, io.BytesIO())
        with self.assertRaisesRegex(RuntimeError, "UUID that no longer exists.*already be queued"):
            self.invoke(iter([{}, {"git_commit_sha": SHA}, queued, error]))


class ComposeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "compose.coolify.yaml").read_text()
        cls.compose = yaml.safe_load(cls.source)
        cls.services = cls.compose["services"]

    def test_release_images_match_catalog_in_both_directions(self):
        builds = json.loads((ROOT / "config/ci/application-images.json").read_text())
        images = {service["image"][len(DEPLOY.IMAGE_PREFIX):].split(":")[0]
                  for service in self.services.values()
                  if service["image"].startswith(DEPLOY.IMAGE_PREFIX)
                  and service["image"].endswith(":${SOURCE_COMMIT}")}
        self.assertEqual(images, {build["service"] for build in builds})
        self.assertTrue(all("build" not in service for service in self.services.values()))
        for obsolete in ("${IMAGE_PREFIX}", "${RELEASE_TAG}", "${DEPLOY_"):
            self.assertNotIn(obsolete, self.source)
        self.assertEqual(self.compose["x-telemetry"]["RELEASE_SHA"], "${SOURCE_COMMIT}")

    def test_volumes_and_credentials_are_scoped(self):
        writers, credentials = [], []
        for name, service in self.services.items():
            for volume in service.get("volumes", []):
                self.assertNotIn("${", volume.split(":", 1)[0])
                if volume.startswith("routing-data:") and not volume.endswith(":ro"):
                    writers.append(name)
            if any(key.startswith(("DATA_S3_", "AWS_")) for key in service.get("environment", {})):
                credentials.append(name)
        self.assertEqual(writers, ["provisioner"])
        self.assertEqual(credentials, ["provisioner"])
        self.assertEqual(self.services["location-seed"]["volumes"], ["location-seed-data:/seed-data:ro"])
        self.assertIn("blob-cache", self.compose["volumes"])
        self.assertIn("location-seed-data", self.compose["volumes"])

    def test_osrm_mounts_and_dependency_chain(self):
        osrm = [name for name in self.services if re.match(r"^(hcm|hanoi|danang)-", name)]
        self.assertEqual(len(osrm), 9)
        for name in osrm:
            self.assertEqual(self.services[name]["volumes"], ["routing-data:/data:ro"])
            self.assertEqual(self.services[name]["depends_on"], {"provisioner": {"condition": "service_completed_successfully"}})
        self.assertEqual(self.services["location-seed"]["depends_on"], {
            "postgis": {"condition": "service_healthy"}, "provisioner": {"condition": "service_completed_successfully"}})
        self.assertEqual(self.services["location-migrate"]["depends_on"], {
            "postgis": {"condition": "service_healthy"}, "location-seed": {"condition": "service_completed_successfully"}})

    def test_one_shots_and_blob_pins(self):
        for name in ("provisioner", "location-seed", "location-migrate", "moving-migrate"):
            self.assertEqual(self.services[name]["restart"], "no")
            self.assertIs(self.services[name]["exclude_from_hc"], True)
        env = self.services["provisioner"]["environment"]
        sync_targets = dict(target.split("=", 1) for target in env["SYNC_TARGETS"].split())
        for pin in sync_targets.values():
            self.assertRegex(pin, r"^[0-9a-f]{64}\.tar\.gz$")
        seed_blob = self.services["location-seed"]["environment"]["SEED_BLOB"]
        self.assertEqual(sync_targets["location-seed-data"], seed_blob)
        self.assertEqual(seed_blob, self.compose["x-blobs"]["location-dump"])
        self.assertEqual(self.services["provisioner"]["security_opt"], ["no-new-privileges:true"])
        self.assertIs(self.services["provisioner"]["init"], True)
        self.assertNotIn("cap_drop", self.services["provisioner"])

    def test_internal_web_labels(self):
        router = "traefik.http.routers.p044-${COMPOSE_PROJECT_NAME}-internal"
        self.assertEqual(self.services["web"]["labels"], [
            router + ".rule=Host(`${SERVICE_FQDN_WEB}`) && (Path(`/health`) || PathPrefix(`/docs`) || Path(`/redoc`) || Path(`/openapi.json`))",
            router + ".entrypoints=https", router + ".tls=true", router + ".service=noop@internal",
        ])

    def test_seed_uses_single_transaction_and_removes_upstream_extensions(self):
        script = self.services["location-seed"]["entrypoint"][2]
        self.assertIn("select to_regclass('public.lifeflow_schema_migrations') is not null", script)
        self.assertIn("Location database already initialized; skipping seed", script)
        self.assertIn('pg_restore --single-transaction --exit-on-error --no-owner --no-privileges -d "$$PGDATABASE" /seed-data/lifeflow.dump', script)
        self.assertIn("DROP EXTENSION IF EXISTS postgis_tiger_geocoder, postgis_topology, fuzzystrmatch, postgis CASCADE;", script)
        self.assertIn("DROP SCHEMA IF EXISTS tiger, tiger_data, topology CASCADE;", script)
        self.assertIn("-c ANALYZE", script)

    @unittest.skipUnless(shutil.which("sh"), "sh is required")
    def test_seed_initialization_check_fails_closed(self):
        shell = shutil.which("sh")
        script = self.services["location-seed"]["entrypoint"][2].replace("$$", "$")
        for status, output, succeeds, restores in ((2, "", False, False), (0, "t", True, False),
                                                   (0, "f", True, True), (0, "", False, False)):
            with self.subTest(status=status, output=output), tempfile.TemporaryDirectory() as directory:
                calls_file = Path(directory) / "calls"
                for name in ("psql", "pg_restore"):
                    stub = Path(directory) / name
                    stub.write_text(f"""#!{shell}
{{
  printf '%s' '{name}'
  printf '\\t%s' "$@"
  printf '\\n'
}} >> "$CALLS_FILE"
""" + ("""case "$*" in
  *to_regclass*)
    if [ "$CHECK_STATUS" != 0 ]; then exit "$CHECK_STATUS"; fi
    printf '%s\\n' "$CHECK_RESULT"
    ;;
esac
""" if name == "psql" else "") + "exit 0\n")
                    stub.chmod(0o755)
                result = subprocess.run([shell, "-ec", script], text=True, capture_output=True, timeout=10,
                                        env=os.environ | {"PATH": directory, "CALLS_FILE": str(calls_file),
                                                          "CHECK_STATUS": str(status), "CHECK_RESULT": output,
                                                          "SEED_BLOB": "test.tar.gz", "PGDATABASE": "test"})
                self.assertEqual(result.returncode == 0, succeeds, result.stderr)
                calls = calls_file.read_text().splitlines()
                self.assertIn("to_regclass", calls[0])
                if restores:
                    self.assertEqual([call.split("\t")[0] for call in calls],
                                     ["psql", "psql", "pg_restore", "psql"])
                    self.assertIn("DROP EXTENSION", calls[1])
                    self.assertTrue(calls[3].endswith("\t-c\tANALYZE"))
                else:
                    self.assertEqual(len(calls), 1)

    def test_tester_payment_control_is_limited_to_configured_accounts(self):
        # payment-design D10: the tester "paid" control never ships to production and
        # only listed gateway accounts see it. An unset list means nobody.
        backend = self.compose["services"]["backend"]["environment"]
        self.assertNotEqual(backend["APP_ENV"], "production")
        self.assertEqual(backend["PAYMENT_TESTER_CONFIRM_ENABLED"], "${PAYMENT_TESTER_CONFIRM_ENABLED:-true}")
        self.assertEqual(backend["PAYMENT_TESTER_USER_IDS"], "${PAYMENT_TESTER_USER_IDS:-}")
        payment = self.compose["services"]["payments-mcp"]
        self.assertEqual(payment["environment"]["PAYMENT_ZALOPAY_ENDPOINT"], "https://sb-openapi.zalopay.vn/v2")
        self.assertEqual(backend["PAYMENT_MCP_URL"], "http://${SERVICE_NAME_PAYMENTS_MCP}:8766/mcp")
        self.assertNotIn("PAYMENT_ZALOPAY_KEY1", backend)
        self.assertNotIn("PAYMENT_ZALOPAY_KEY2", backend)
        self.assertNotIn("PAYMENT_MCP_STDIO", backend)
        self.assertNotIn("ports", payment)
        self.assertEqual(payment["volumes"], ["payments-data:/app/data"])
        self.assertEqual(backend["HOUSING_VIEWING_ENABLED"], "true")
        # Simulated booking tools stay on the internal network.
        flights = self.compose["services"]["flights-mcp"]
        self.assertNotIn("ports", flights)
        self.assertNotIn("labels", flights)
        exposed = [name for name, service in self.compose["services"].items()
                   if "ports" in service or "expose" in service]
        self.assertEqual(exposed, ["web"])


class WorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / ".github/workflows/deploy.yml").read_text()
        cls.workflow = yaml.load(cls.source, Loader=yaml.BaseLoader)

    def test_triggers_inputs_and_runner(self):
        triggers = self.workflow["on"]
        self.assertEqual(triggers["workflow_run"], {"workflows": ["CI"], "types": ["completed"], "branches": ["main"]})
        inputs = triggers["workflow_dispatch"]["inputs"]
        self.assertEqual(inputs["environment"]["options"], ["staging", "production"])
        self.assertEqual(inputs["environment"]["type"], "choice")
        self.assertEqual(inputs["sha"]["required"], "false")
        job = self.workflow["jobs"]["deploy"]
        self.assertEqual(job["runs-on"], ["self-hosted", "linux", "team-44"])
        self.assertEqual(job["timeout-minutes"], "75")
        self.assertIn("coolify-", job["concurrency"]["group"])
        self.assertIn("inputs.environment", job["concurrency"]["group"])
        self.assertEqual(job["concurrency"]["cancel-in-progress"], "false")
        for condition in ("conclusion == 'success'", "event == 'push'", "github.ref == 'refs/heads/main'"):
            self.assertIn(condition, job["if"])
        self.assertEqual(self.workflow["permissions"], {"contents": "read", "packages": "read", "actions": "read"})

    def test_environment_settings_and_pinned_compose(self):
        for environment in ("STAGING", "PRODUCTION"):
            for setting in ("URL", "APP_UUID"):
                self.assertIn(f"vars.COOLIFY_{environment}_{setting}", self.source)
            self.assertIn(f"secrets.COOLIFY_{environment}_TOKEN", self.source)
        self.assertIn('git merge-base --is-ancestor "$SHA" origin/main', self.source)
        self.assertIn('git show "$SHA:compose.coolify.yaml" > release-compose.yaml', self.source)
        self.assertIn("pip install PyYAML==6.0.3", self.source)
        self.assertIn("fetch-depth: 0", self.source)
        self.assertIn("GITHUB_STEP_SUMMARY", self.source)
        for name in ("deploy-staging.yml", "deploy-production.yml", "deploy-coolify.yml"):
            self.assertFalse((ROOT / ".github/workflows" / name).exists())

    def select(self, *, event="workflow_run", main=SHA, run_sha=SHA, automatic="", environment="production", sha=""):
        job = self.workflow["jobs"]["deploy"]
        script = next(step["with"]["script"] for step in job["steps"] if step.get("id") == "release")
        harness = """
          const fs = require('node:fs');
          const data = JSON.parse(fs.readFileSync(0, 'utf8'));
          const outputs = {}, notices = [];
          let calls = 0;
          const github = {rest: {repos: {getBranch: async () => {
            calls++; return {data: {commit: {sha: data.main}}};
          }}}};
          const context = {eventName: data.event, repo: {}, payload: {workflow_run: {head_sha: data.run_sha}}};
          const core = {setOutput: (key, value) => outputs[key] = value, notice: value => notices.push(value)};
          const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
          (async () => {
            let error = null;
            try { await new AsyncFunction('github', 'context', 'core', data.script)(github, context, core); }
            catch (e) { error = e.message; }
            process.stdout.write(JSON.stringify({outputs, notices, calls, error}));
          })();
        """
        result = subprocess.run(["node", "-e", harness], text=True, capture_output=True, check=True,
                                input=json.dumps({"script": script, "event": event, "main": main, "run_sha": run_sha}),
                                env=os.environ | {"STAGING_AUTO_DEPLOY": automatic, "DEPLOY_ENVIRONMENT": environment,
                                                  "REQUESTED_SHA": sha})
        return json.loads(result.stdout)

    def test_automatic_current_main_deploys_to_staging(self):
        result = self.select()
        self.assertIsNone(result["error"])
        self.assertEqual(result["outputs"], {"deploy": "true", "environment": "staging", "sha": SHA})

    def test_disabled_and_superseded_automatic_runs_skip_with_notice(self):
        for settings in ({"automatic": "false"}, {"main": "b" * 40}):
            result = self.select(**settings)
            self.assertIsNone(result["error"])
            self.assertEqual(result["outputs"], {})
            self.assertEqual(len(result["notices"]), 1)

    def test_manual_commit_defaults_to_main_and_accepts_explicit_sha(self):
        for sha in ("", "b" * 40):
            result = self.select(event="workflow_dispatch", sha=sha)
            self.assertIsNone(result["error"])
            self.assertEqual(result["outputs"], {"deploy": "true", "environment": "production", "sha": sha or SHA})

    def test_invalid_commit_and_main_lookup_fail(self):
        for settings in ({"sha": "main", "event": "workflow_dispatch"}, {"main": ""}):
            result = self.select(**settings)
            self.assertIsNotNone(result["error"])
            self.assertEqual(result["outputs"], {})
