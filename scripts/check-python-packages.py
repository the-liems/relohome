"""Build exact wheel manifests and import them in a fresh environment outside the checkout."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import venv
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args, cwd, env=None):
    subprocess.run([str(arg) for arg in args], cwd=cwd, env=env, check=True)


def main():
    projects = json.loads((ROOT / "packages/python/manifest.json").read_text())
    with tempfile.TemporaryDirectory(prefix="relohome-wheels-") as temporary:
        scratch = Path(temporary)
        wheels = scratch / "wheels"
        wheels.mkdir()
        for project in projects:
            run(sys.executable, "-m", "pip", "wheel", "--no-deps", "--wheel-dir", wheels,
                ROOT / project["path"], cwd=scratch)
        for project in projects:
            wheel = next(wheels.glob(project["name"].replace("-", "_") + "-*.whl"))
            with zipfile.ZipFile(wheel) as archive:
                files = sorted(name for name in archive.namelist() if ".dist-info/" not in name)
                if files != project["files"]:
                    raise AssertionError(f"{project['name']} manifest drift: {set(files) ^ set(project['files'])}")
        environment = scratch / "venv"
        venv.EnvBuilder(with_pip=True).create(environment)
        python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        env = {key: value for key, value in os.environ.items() if key not in {"PYTHONPATH", "PYTHONHOME"}}
        env["RELOHOME_RUNTIME_ROOT"] = str(scratch / "runtime")
        registry = scratch / "runtime/config/agent-services/registry.json"
        registry.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "config/agent-services/registry.json", registry)
        run(python, "-m", "pip", "install", *sorted(wheels.glob("*.whl")), cwd=scratch, env=env)
        run(python, "-m", "pip", "check", cwd=scratch, env=env)
        run(python, ROOT / "tests/packaging_smoke.py", ROOT / "packages/python/manifest.json",
            cwd=scratch, env=env)
    print("All wheel manifests, dependencies, imports, resources and persistent paths passed.")


if __name__ == "__main__":
    main()
