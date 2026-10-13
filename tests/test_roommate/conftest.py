import os
from uuid import uuid4

import pytest
from psycopg import sql
from relohome_roommate.postgres import PostgresPool

from tests.test_roommate.database_connection import resolve_database_url


@pytest.fixture(scope="session")
def pg_database_url():
    url = os.getenv("ROOMMATE_TEST_DATABASE_URL")
    return resolve_database_url(url) if url else None


@pytest.fixture
def pg_store(pg_database_url):
    url = pg_database_url
    if not url:
        pytest.skip("ROOMMATE_TEST_DATABASE_URL requires an isolated PostgreSQL test database")
    pool = PostgresPool(url, "rmtest_" + uuid4().hex)
    try:
        pool.initialize()
        yield pool
    finally:
        with pool.pool.connection() as raw:
            raw.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(pool.schema)))
        pool.close()
