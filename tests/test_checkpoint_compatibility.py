from pathlib import Path

from tests.checkpoint_compatibility_smoke import verify


def test_pre_relohome_sqlite_checkpoint_resumes_as_models(tmp_path):
    verify(tmp_path, Path(__file__).parent / 'fixtures/pre-relohome-checkpoint.json')
