import pytest
from relohome_agent.config import Settings
from relohome_agent.roommate_runtime import RoommateRuntime


def test_disabled_never_bootstraps_or_calls_provider(tmp_path):
    settings = Settings(_env_file=None, roommate_enabled=False, roommate_state_dir=tmp_path / "private")
    assert RoommateRuntime.open(settings) is None
    assert not (tmp_path / "private").exists()


def test_runtime_requires_private_path_token_and_moderators(tmp_path):
    with pytest.raises(ValueError, match="token"):
        RoommateRuntime.open(
            Settings(
                _env_file=None,
                roommate_enabled=True,
                agent_api_token="",
                roommate_moderators="",
                housing_moderator_ids="",
                roommate_state_dir=tmp_path,
            )
        )
    with pytest.raises(ValueError, match="moderator"):
        RoommateRuntime.open(
            Settings(
                _env_file=None,
                roommate_enabled=True,
                agent_api_token="test-token",
                roommate_moderators="",
                housing_moderator_ids="",
                roommate_state_dir=tmp_path,
            )
        )


@pytest.mark.parametrize("legacy", ["", " legacy, housing-admin, "])
def test_runtime_reuses_housing_admin_ids_without_roommate_configuration(tmp_path, monkeypatch, legacy):
    monkeypatch.setenv("HOUSING_MODERATOR_IDS", " housing-admin, second-admin, housing-admin, ")
    runtime = RoommateRuntime.open(
        Settings(
            _env_file=None,
            roommate_enabled=True,
            agent_api_token="test-token",
            roommate_moderators=legacy,
            roommate_state_dir=tmp_path,
        )
    )
    try:
        assert runtime.moderators == frozenset({"housing-admin", "second-admin"} | ({"legacy"} if legacy else set()))
    finally:
        runtime.close()


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


def test_configured_root_preserves_private_paths_from_unrelated_cwd(tmp_path, monkeypatch):
    root = tmp_path / "runtime"
    root.mkdir()
    unrelated = tmp_path / "unrelated"
    unrelated.mkdir()
    monkeypatch.chdir(unrelated)
    monkeypatch.setenv("RELOHOME_RUNTIME_ROOT", str(root))
    settings = Settings(
        _env_file=None,
        roommate_enabled=True,
        agent_api_token="test-token",
        roommate_moderators="mod",
        roommate_state_dir="private-roommate",
    )
    runtime = RoommateRuntime.open(settings)
    assert runtime.path == root / "private-roommate/roommate.sqlite3"
    runtime.close()
    assert not list(unrelated.iterdir())
    for public in ("data", "Frontend/public", "apps/web/public", "apps/web/dist"):
        with pytest.raises(ValueError, match="outside public"):
            RoommateRuntime.open(settings.model_copy(update={"roommate_state_dir": root / public}))
    monkeypatch.delenv("RELOHOME_RUNTIME_ROOT")
    with pytest.raises(ValueError, match="RELOHOME_RUNTIME_ROOT"):
        RoommateRuntime.open(settings)
