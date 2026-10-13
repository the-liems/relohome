"""Temporary compatibility import; removal gate: #115 (see python-packaging.md)."""
import importlib as _importlib
import sys as _sys

_sys.modules[__name__] = _importlib.import_module('relohome_roommate.services.profiles')
