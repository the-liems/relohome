"""Compatibility for pre-#113 callers; canonical module: relohome_gateway.roommate_gateway."""
import sys
from relohome_gateway import roommate_gateway as _implementation

sys.modules[__name__] = _implementation
