"""Compatibility for pre-#113 callers; canonical module: relohome_gateway.server."""
import sys
from relohome_gateway import server as _implementation

sys.modules[__name__] = _implementation
