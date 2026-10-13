"""Compatibility for pre-#113 callers; canonical module: relohome_gateway.admin_provision."""
import sys
from relohome_gateway import admin_provision as _implementation

if __name__ == "__main__":
    _implementation.main()
else:
    sys.modules[__name__] = _implementation
