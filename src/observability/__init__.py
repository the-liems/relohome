"""Temporary compatibility import; removal gate: #115 (see python-packaging.md)."""
import importlib as _importlib
import sys as _sys

for _module in ("runtime", "privacy", "sqlite", "asgi"):
    _sys.modules[f"{__name__}.{_module}"] = _importlib.import_module(f"relohome_observability.{_module}")
_sys.modules[__name__] = _importlib.import_module("relohome_observability")
