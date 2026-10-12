"""Keep the ADR dependency direction enforceable while physical app moves are pending."""
import ast
import importlib
import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = json.loads((ROOT / "packages/python/manifest.json").read_text())


def test_internal_imports_have_declared_dependencies_and_no_app_to_app_edges():
    names = {project["namespace"]: project["name"] for project in PROJECTS}
    applications = {project["name"] for project in PROJECTS if not project["path"].startswith("packages/")}
    for project in PROJECTS:
        directory = ROOT / project["path"]
        metadata = tomllib.loads((directory / "pyproject.toml").read_text())
        dependencies = {value.split("==")[0] for value in metadata["project"]["dependencies"]}
        for filename in project["files"]:
            if not filename.endswith(".py"):
                continue
            relative = Path(filename)
            source = directory / "src" / relative if project["path"].startswith("packages/") else directory.joinpath(*relative.parts[1:])
            for node in ast.walk(ast.parse(source.read_text())):
                imports = [node.module] if isinstance(node, ast.ImportFrom) and node.level == 0 else (
                    [alias.name for alias in node.names] if isinstance(node, ast.Import) else []
                )
                for module in imports:
                    namespace = (module or "").split(".")[0]
                    assert namespace not in {"src", "Frontend"}, (source, module)
                    dependency = names.get(namespace)
                    if dependency and dependency != project["name"]:
                        assert dependency in dependencies, (project["name"], module)
                        assert dependency not in applications, (project["name"], module)


def test_shared_compatibility_modules_preserve_type_identity():
    aliases = json.loads((ROOT / "packages/python/compatibility.json").read_text())
    package_aliases = {"src.models", "src.mcp_servers.flights.search", "src.mcp_servers.payments.gateways"}
    for old, new in aliases.items():
        if old in package_aliases:
            continue
        assert importlib.import_module(old) is importlib.import_module(new), old
