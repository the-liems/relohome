import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('wheel_check', ROOT / 'scripts/check-python-packages.py')
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def test_deleted_modules_cannot_return_from_previous_build_output(tmp_path):
    source = tmp_path / 'project'
    module = source / 'src/example/removed.py'
    module.parent.mkdir(parents=True)
    module.write_text('VALUE = 1\n')
    stale = source / 'build/lib/example/removed.py'
    stale.parent.mkdir(parents=True)
    stale.write_text(module.read_text())
    metadata = source / 'src/example.egg-info/SOURCES.txt'
    metadata.parent.mkdir()
    metadata.write_text('src/example/removed.py\n')
    module.unlink()
    (source / 'src/example/current.py').write_text('VALUE = 2\n')
    destination = tmp_path / 'fresh-build'
    CHECK.copy_project(source, destination)
    assert not list(destination.rglob('removed.py'))
    assert not list(destination.rglob('*.egg-info'))
    assert (destination / 'src/example/current.py').read_text() == 'VALUE = 2\n'
