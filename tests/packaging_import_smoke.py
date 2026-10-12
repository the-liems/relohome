"""Import only one wheel's modules and check its function-local dependencies."""
import ast
import importlib
import importlib.util
import json
import sys
from pathlib import Path

project = json.loads(Path(sys.argv[1]).read_text())
for filename in project['files']:
    if not filename.endswith('.py') or filename.endswith('/__main__.py'):
        continue
    module = importlib.import_module(filename[:-3].replace('/', '.').removesuffix('.__init__'))
    source = Path(module.__file__)
    assert source.is_relative_to(Path(sys.prefix)), (module.__name__, source)
    # Imports inside route handlers (e.g. segno) are invisible to module-import smoke tests.
    for node in ast.walk(ast.parse(source.read_text())):
        modules = [node.module] if isinstance(node, ast.ImportFrom) and node.level == 0 else (
            [alias.name for alias in node.names] if isinstance(node, ast.Import) else [])
        for name in modules:
            assert importlib.util.find_spec(name.split('.')[0]) is not None, (project['name'], name)
print(project['name'] + ': independently installed imports and lazy dependencies passed')
