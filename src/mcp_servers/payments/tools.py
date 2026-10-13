"""Temporary compatibility alias; removal gate #115 (agent-app-relocation.md)."""
import importlib
import sys

sys.modules[__name__] = importlib.import_module("relohome_payments_mcp.tools")
