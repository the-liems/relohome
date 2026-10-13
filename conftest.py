"""Repository-wide pytest setup: tests never inherit application configuration from the shell."""

import os

from tests import live


def pytest_addoption(parser):
    live.add_options(parser)


def pytest_configure(config):
    # Runs before any test module is imported, so cached settings never see the shell.
    live.clean_environment(os.environ)
    os.environ["RELOHOME_RUNTIME_ROOT"] = str(live.ROOT)
    live.configure(config)
