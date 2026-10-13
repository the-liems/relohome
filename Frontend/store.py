"""Compatibility for pre-#113 callers; canonical module: relohome_gateway.store."""
import sys
from relohome_gateway import store as _implementation

sys.modules[__name__] = _implementation
