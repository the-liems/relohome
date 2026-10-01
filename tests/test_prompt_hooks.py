"""Hook regressions using synthetic logs and mocked network requests only."""

import importlib
import io
import json
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
with patch.object(sys, "path", [str(SCRIPTS), *sys.path]):
    log_hook = importlib.import_module("log_hook")
    log_privacy = importlib.import_module("log_privacy")
    # Importing the production submission script must not read a developer's .env.
    with patch("dotenv.load_dotenv"):
        submit_log = importlib.import_module("submit_log")


class PromptHookTests(unittest.TestCase):
    def test_home_redaction_across_platforms(self):
        cases = {
            "/Users/alice/.codex/session.jsonl": "[HOME]/.codex/session.jsonl",
            "/home/alice/log.jsonl": "[HOME]/log.jsonl",
            r"C:\Users\alice\log.jsonl": r"[HOME]\log.jsonl",
            "D:/Users/alice/log.jsonl": "[HOME]/log.jsonl",
            "/custom/home/log.jsonl": "[HOME]/log.jsonl",
            "/custom/home": "[HOME]",
            "/custom/home-other/log.jsonl": "/custom/home-other/log.jsonl",
            "/var/log/session.jsonl": "/var/log/session.jsonl",
            "relative/session.jsonl": "relative/session.jsonl",
            "[HOME]/log.jsonl": "[HOME]/log.jsonl",
            "": "",
        }
        with patch.object(log_privacy.Path, "home", return_value=Path("/custom/home")):
            for value, expected in cases.items():
                with self.subTest(value=value):
                    self.assertEqual(log_privacy.redact_transcript_path(value), expected)

    def test_hook_output_and_local_redaction(self):
        for tool, event in [
            ("codex", "UserPromptSubmit"),
            ("codex", "Stop"),
            ("claude", "UserPromptSubmit"),
            ("gemini", "BeforeAgent"),
            ("cursor", "beforeSubmitPrompt"),
            ("copilot", "userPromptSubmitted"),
        ]:
            with self.subTest(tool=tool, event=event), tempfile.TemporaryDirectory() as directory:
                payload = {
                    "hook_event_name": event,
                    "prompt": "hello 🌏" if event != "Stop" else "",
                    "transcript_path": "/Users/alice/.codex/session.jsonl",
                }
                stdin = io.TextIOWrapper(io.BytesIO(json.dumps(payload).encode()))
                output = io.StringIO()
                with (
                    patch.object(sys, "stdin", stdin),
                    patch.object(sys, "argv", ["log_hook.py", f"--tool={tool}"]),
                    patch.dict("os.environ", {"AI_LOG_DIR": directory}),
                    patch.object(log_hook, "git", return_value="https://example.test/team/repo.git"),
                    redirect_stdout(output),
                ):
                    log_hook.main()
                self.assertEqual(json.loads(output.getvalue()), {} if tool == "codex" else {"status": "logged"})
                entry = json.loads((Path(directory) / "session.jsonl").read_text())
                self.assertEqual(entry["prompt"], payload["prompt"])
                if tool == "codex":
                    self.assertEqual(entry["transcript_path"], "[HOME]/.codex/session.jsonl")

    def test_codex_stop_tolerates_non_string_transcript_paths(self):
        for value in [None, 0, 42, True, [], ["/Users/alice/log.jsonl"], {"path": "/Users/alice/log.jsonl"}]:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                payload = {"hook_event_name": "Stop", "transcript_path": value}
                stdin = io.TextIOWrapper(io.BytesIO(json.dumps(payload).encode()))
                output = io.StringIO()
                with (
                    patch.object(sys, "stdin", stdin),
                    patch.object(sys, "argv", ["log_hook.py", "--tool=codex"]),
                    patch.dict("os.environ", {"AI_LOG_DIR": directory}),
                    patch.object(log_hook, "git", return_value="https://example.test/team/repo.git"),
                    redirect_stdout(output),
                ):
                    log_hook.main()
                self.assertEqual(json.loads(output.getvalue()), {})
                entry = json.loads((Path(directory) / "session.jsonl").read_text())
                self.assertEqual(entry["transcript_path"], "")

    def test_submission_redacts_old_logs_and_restores_failed_batch(self):
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                logfile = root / "session.jsonl"
                original = (
                    "\n".join(
                        [
                            "null",
                            "[]",
                            "42",
                            '"text"',
                            "invalid",
                            json.dumps({"prompt": "hello", "transcript_path": "/home/alice/log.jsonl"}),
                        ]
                    )
                    + "\n"
                )
                logfile.write_text(original)
                response = MagicMock()
                response.__enter__.return_value.status = 200
                with (
                    patch.multiple(
                        submit_log,
                        SERVER_URL="https://example.test/logs",
                        API_KEY="",
                        LOG_FILE=logfile,
                        LOG_DIR=root,
                        ARCHIVE_DIR=root / "archive",
                    ),
                    patch.object(submit_log.urllib.request, "urlopen", return_value=response) as send,
                ):
                    if fail:
                        send.side_effect = urllib.error.URLError("synthetic failure")
                        with self.assertRaises(SystemExit) as error:
                            submit_log.main()
                        self.assertEqual(error.exception.code, 0)
                        self.assertEqual(logfile.read_text(), original)
                    else:
                        submit_log.main()
                        self.assertFalse(logfile.exists())
                        self.assertEqual(len(list((root / "archive").glob("*.jsonl"))), 1)
                    payload = json.loads(send.call_args.args[0].data)
                    self.assertEqual(payload, {"entries": [{"prompt": "hello", "transcript_path": "[HOME]/log.jsonl"}]})
                    self.assertFalse(list(root.glob("session.pending.*")))


if __name__ == "__main__":
    unittest.main()
