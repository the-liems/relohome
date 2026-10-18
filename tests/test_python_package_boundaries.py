"""Keep the ADR dependency direction enforceable including supported examples."""

import ast
import importlib
import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def discover_projects():
    projects = []
    patterns = ("packages/python/*/pyproject.toml", "apps/*/pyproject.toml", "examples/*/pyproject.toml")
    for pattern in patterns:
        for path in sorted(ROOT.glob(pattern)):
            metadata = tomllib.loads(path.read_text())
            directory = path.parent
            setuptools = metadata["tool"]["setuptools"]
            if isinstance(setuptools["packages"], list):
                ((namespace, base),) = setuptools["package-dir"].items()
                files = []
                for package in setuptools["packages"]:
                    package_directory = directory / base / Path(*package.split(".")[1:])
                    files.extend(package_directory.glob("*.py"))
            else:
                source = directory / "src"
                namespace = next(path.name for path in source.iterdir() if (path / "__init__.py").is_file())
                files = list(source.rglob("*.py"))
            projects.append(
                {
                    "name": metadata["project"]["name"],
                    "namespace": namespace,
                    "application": not directory.is_relative_to(ROOT / "packages"),
                    "dependencies": {value.split("==")[0] for value in metadata["project"]["dependencies"]},
                    "files": files,
                }
            )
    return projects


PROJECTS = discover_projects()


def test_every_project_is_discovered():
    assert len(PROJECTS) == 12
    assert all(project["files"] for project in PROJECTS)


def test_internal_imports_have_declared_dependencies_and_no_app_to_app_edges():
    names = {project["namespace"]: project["name"] for project in PROJECTS}
    applications = {project["name"] for project in PROJECTS if project["application"]}
    for project in PROJECTS:
        for source in project["files"]:
            for node in ast.walk(ast.parse(source.read_text())):
                imports = (
                    [node.module]
                    if isinstance(node, ast.ImportFrom) and node.level == 0
                    else ([alias.name for alias in node.names] if isinstance(node, ast.Import) else [])
                )
                for module in imports:
                    namespace = (module or "").split(".")[0]
                    assert namespace not in {"src", "Frontend"}, (source, module)
                    dependency = names.get(namespace)
                    if dependency and dependency != project["name"]:
                        assert dependency in project["dependencies"], (project["name"], module)
                        assert dependency not in applications, (project["name"], module)


def test_only_persisted_checkpoint_alias_remains():
    from relohome_agent.agents.graph import checkpoint_serde

    checkpoint_serde()
    aliases = json.loads((ROOT / "packages/python/compatibility.json").read_text())
    assert aliases == {"src.agents.models": "relohome_agent.agents.models"}
    assert not (ROOT / "src").exists()
    assert not list((ROOT / "Frontend").glob("*.py"))
    for old, new in aliases.items():
        assert importlib.import_module(old) is importlib.import_module(new), old
