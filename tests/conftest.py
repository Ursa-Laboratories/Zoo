"""Shared pytest fixtures for the Zoo backend test suite."""

import pytest

from zoo.config import get_settings
from zoo.routers import gantry as gantry_router


@pytest.fixture(autouse=True)
def _reset_gantry_run_state():
    """Ensure the protocol-run-in-progress gate never leaks between tests."""
    gantry_router.end_run()
    yield
    gantry_router.end_run()


@pytest.fixture(autouse=True)
def _allow_testserver_host():
    """Allow the ASGI test client's Host header through the Origin/Host
    middleware (zoo.app._origin_host_middleware).

    httpx's ``ASGITransport`` with ``base_url="http://testserver"`` sends
    ``Host: testserver`` on every request. Production stays strict —
    ``trusted_hosts`` defaults to empty — but tests need this one extra
    hostname allowed so the DNS-rebinding guard doesn't 400 every request.
    """
    settings = get_settings()
    original = list(settings.trusted_hosts)
    settings.trusted_hosts = list(set(original) | {"testserver"})
    yield
    settings.trusted_hosts = original
