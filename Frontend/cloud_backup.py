"""Compatibility for pre-#113 callers; canonical module: relohome_gateway.cloud_backup."""
import sys
from relohome_gateway import cloud_backup as _implementation

if __name__ == "__main__":
    _implementation.main()
else:
    sys.modules[__name__] = _implementation
