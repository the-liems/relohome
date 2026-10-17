"""Provision real archives and volumes with a local aws-cli stub."""

import hashlib
import io
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS_PATH = os.environ.get("PATH", "") + os.pathsep + "/sbin"
TOOLS_AVAILABLE = all(shutil.which(tool, path=TOOLS_PATH) for tool in ("sh", "tar", "sha256sum"))


@unittest.skipUnless(TOOLS_AVAILABLE, "sh, tar and sha256sum required")
class ProvisionerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bucket = self.root / "bucket"
        self.cache = self.root / "cache"
        self.volumes = self.root / "volumes"
        self.target = self.volumes / "sample-data"
        self.bin = self.root / "bin"
        self.calls = self.root / "calls"
        for directory in (self.bucket, self.cache, self.target, self.bin):
            directory.mkdir(parents=True)
        self.old = self.target / "old.txt"
        self.old.write_text("old contents")
        aws = self.bin / "aws"
        aws.write_text('''#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$TEST_AWS_CALLS"
if [ "$1" = --endpoint-url ]; then
    [ "$2" = https://s3.example.test ]
    shift 2
fi
[ "$1" = s3 ] && [ "$2" = cp ]
case "$3" in s3://bucket/*) ;; *) exit 1 ;; esac
cp "$TEST_BUCKET/${3#s3://bucket/}" "$4"
''')
        aws.chmod(0o755)
        self.env = os.environ | {"PATH": str(self.bin) + os.pathsep + TOOLS_PATH,
                                 "DATA_S3_BUCKET": "bucket", "DATA_S3_ENDPOINT": "",
                                 "PROVISION_CACHE_DIR": str(self.cache), "PROVISION_VOLUMES_DIR": str(self.volumes),
                                 "TEST_BUCKET": str(self.bucket), "TEST_AWS_CALLS": str(self.calls),
                                 "SYNC_TARGETS": ""}

    def archive(self, files=None):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w:gz") as archive:
            for name, content in (files or {"city/profile/graph": b"graph", ".metadata": b"hidden"}).items():
                entry = tarfile.TarInfo(name)
                entry.size = len(content)
                archive.addfile(entry, io.BytesIO(content))
        blob = hashlib.sha256(data.getvalue()).hexdigest() + ".tar.gz"
        (self.bucket / blob).write_bytes(data.getvalue())
        return blob

    def run_provisioner(self, blob=None, **env):
        settings = self.env | ({"SYNC_TARGETS": "sample-data=" + blob} if blob else {}) | env
        return subprocess.run(["sh", str(ROOT / "deploy/provisioner/provision.sh")], env=settings,
                              text=True, capture_output=True, timeout=10)

    def test_miss_downloads_verifies_and_replaces_only_target_contents(self):
        blob = self.archive()
        result = self.run_provisioner(blob, DATA_S3_ENDPOINT="https://s3.example.test")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(blob + ": downloaded and verified", result.stdout)
        self.assertEqual((self.cache / blob).read_bytes(), (self.bucket / blob).read_bytes())
        self.assertFalse((self.cache / (blob + ".partial")).exists())
        self.assertIn("--endpoint-url https://s3.example.test s3 cp s3://bucket/" + blob, self.calls.read_text())
        self.assertEqual(sorted(str(path.relative_to(self.target)) for path in self.target.rglob("*")),
                         [".metadata", "city", "city/profile", "city/profile/graph"])
        self.assertEqual((self.target / "city/profile/graph").read_bytes(), b"graph")
        self.assertEqual((self.target / ".metadata").read_bytes(), b"hidden")

    def test_cache_hit_avoids_aws_but_reextracts_every_time(self):
        blob = self.archive()
        shutil.copyfile(self.bucket / blob, self.cache / blob)
        for _ in range(2):
            self.old.write_text("changed")
            result = self.run_provisioner(blob)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), blob + ": cache hit")
            self.assertFalse(self.old.exists())
        self.assertFalse(self.calls.exists())

    def test_hash_mismatch_removes_partial_and_preserves_old_volume(self):
        blob = self.archive()
        wrong = "f" * 64 + ".tar.gz"
        (self.bucket / blob).rename(self.bucket / wrong)
        result = self.run_provisioner(wrong)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Checksum mismatch", result.stderr)
        self.assertEqual(list(self.cache.iterdir()), [])
        self.assertEqual(list(self.target.iterdir()), [self.old])
        self.assertEqual(self.old.read_text(), "old contents")

    def test_stale_partial_is_overwritten(self):
        blob = self.archive()
        (self.cache / (blob + ".partial")).write_bytes(b"stale")
        result = self.run_provisioner(blob)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.cache / blob).read_bytes(), (self.bucket / blob).read_bytes())
        self.assertFalse((self.cache / (blob + ".partial")).exists())
        self.assertEqual(len(self.calls.read_text().splitlines()), 1)

    def test_unsafe_archive_paths_are_rejected_before_swap(self):
        for name in ("../escaped", "nested/../../escaped", "/absolute"):
            with self.subTest(name=name):
                result = self.run_provisioner(self.archive({name: b"unsafe"}))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Unsafe archive paths", result.stderr)
                self.assertEqual(list(self.target.iterdir()), [self.old])
        self.assertFalse((self.volumes / "escaped").exists())

    def test_extraction_failure_cleans_staging_and_preserves_old_volume(self):
        blob = self.archive()
        real_tar = shutil.which("tar", path=TOOLS_PATH)
        tar = self.bin / "tar"
        tar.write_text('#!/bin/sh\nif [ "$1" = -xzf ]; then exit 1; fi\nexec "' + real_tar + '" "$@"\n')
        tar.chmod(0o755)
        result = self.run_provisioner(blob)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.target.iterdir()), [self.old])

    def test_invalid_blob_and_volume_names_are_rejected(self):
        blob = self.archive()
        invalid = [{"SYNC_TARGETS": volume + "=" + blob} for volume in ("../bad", "Bad", "-bad", "bad.name", "*")]
        invalid += [{"SYNC_TARGETS": "sample-data=" + blob + "=extra"}, {"SYNC_TARGETS": "sample-data"}]
        for settings in invalid:
            with self.subTest(settings=settings):
                result = self.run_provisioner(**settings)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Invalid", result.stderr)
        self.assertFalse(self.calls.exists())
        self.assertEqual(list(self.target.iterdir()), [self.old])

    def test_target_mount_must_already_exist(self):
        result = self.run_provisioner(SYNC_TARGETS="missing=" + self.archive())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Target mount does not exist", result.stderr)
        self.assertFalse(self.calls.exists())
