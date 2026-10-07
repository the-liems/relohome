import pytest

from src.config import Settings
from src.roommate.runtime import RoommateRuntime


def test_disabled_never_bootstraps_or_calls_provider(tmp_path):
    settings = Settings(_env_file=None, roommate_enabled=False, roommate_state_dir=tmp_path / "private")
    assert RoommateRuntime.open(settings) is None
    assert not (tmp_path / "private").exists()


def test_runtime_requires_private_path_token_and_moderators(tmp_path):
    with pytest.raises(ValueError, match="token"):
        RoommateRuntime.open(Settings(_env_file=None, roommate_enabled=True, roommate_state_dir=tmp_path))
    with pytest.raises(ValueError, match="moderator"):
        RoommateRuntime.open(
            Settings(_env_file=None, roommate_enabled=True, agent_api_token="test-token", roommate_state_dir=tmp_path)
        )


def test_runtime_context_restart_and_missing_key(tmp_path):
    settings = Settings(
        _env_file=None,
        roommate_enabled=True,
        agent_api_token="test-token",
        roommate_moderators="mod",
        roommate_state_dir=tmp_path,
    )
    runtime = RoommateRuntime.open(settings)
    with runtime.context() as ctx:
        assert ctx.vault is not None and ctx.moderators == frozenset({"mod"})
    runtime.close()
    assert RoommateRuntime.open(settings) is not None
    (tmp_path / "contact.key").unlink()
    with pytest.raises(FileNotFoundError):
        RoommateRuntime.open(settings)
