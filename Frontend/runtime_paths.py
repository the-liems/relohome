"""Compatibility for pre-#113 callers; canonical module: relohome_gateway.runtime_paths."""
import sys
from relohome_gateway import runtime_paths as _implementation

sys.modules[__name__] = _implementation
