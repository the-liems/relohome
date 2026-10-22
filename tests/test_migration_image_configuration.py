"""Keep CI migration checks and deployment on the same accessible database image."""

import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("migration_image", ROOT / "scripts/test-migration-image.py")
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)
LEGACY = "ghcr.io/ai20k-build-phase-cohort-4/p-044/postgis:16-3.5-alpine"
NEW = "ghcr.io/the-liems/relohome/postgis:16-3.5-alpine"


class MigrationImageConfigurationTests(unittest.TestCase):
    def test_unset_and_empty_overrides_retain_legacy_image(self):
        for env in ({}, {"POSTGIS_IMAGE": ""}):
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True):
                self.assertEqual(MIGRATION.resolve_database_image("location-migrate"), LEGACY)

    def test_repository_override_reaches_database_container(self):
        class DatabaseSelectedError(Exception):
            pass

        def docker(*args, **kwargs):
            if args[0] == "run":
                self.assertEqual(args[-1], NEW)
                raise DatabaseSelectedError

        with patch.dict(os.environ, {"POSTGIS_IMAGE": NEW}, clear=True), \
                patch.object(MIGRATION, "docker", side_effect=docker), \
                patch.object(MIGRATION.subprocess, "run"), self.assertRaises(DatabaseSelectedError):
            MIGRATION.verify("location-migrate", "migration-under-test")

    def test_explicit_cli_image_takes_precedence(self):
        with patch.dict(os.environ, {"POSTGIS_IMAGE": NEW}, clear=True):
            self.assertEqual(MIGRATION.resolve_database_image("location-migrate", "custom/postgis:arm64"),
                             "custom/postgis:arm64")

    def test_moving_database_does_not_use_postgis_override(self):
        compose = yaml.safe_load((ROOT / "compose.coolify.yaml").read_text())
        with patch.dict(os.environ, {"POSTGIS_IMAGE": NEW}, clear=True):
            self.assertEqual(MIGRATION.resolve_database_image("moving-migrate"),
                             compose["services"]["moving-db"]["image"])

    def test_literal_legacy_compose_remains_supported(self):
        with patch.object(MIGRATION.yaml, "safe_load", return_value={"services": {"postgis": {"image": LEGACY}}}), \
                patch.dict(os.environ, {"POSTGIS_IMAGE": NEW}, clear=True):
            self.assertEqual(MIGRATION.resolve_database_image("location-migrate"), LEGACY)

    def test_ci_and_compose_expose_the_same_override(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/build-application-images.yml").read_text())
        migration = next(step for step in workflow["jobs"]["build"]["steps"]
                         if step.get("name") == "Validate migration SQL, schema, role access, and reruns")
        self.assertEqual(migration["env"]["POSTGIS_IMAGE"], "${{ vars.POSTGIS_IMAGE }}")
        compose = yaml.safe_load((ROOT / "compose.coolify.yaml").read_text())
        for name in ("postgis", "location-seed"):
            self.assertEqual(compose["services"][name]["image"], "${POSTGIS_IMAGE:-" + LEGACY + "}")
