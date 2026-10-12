import os
from uuid import uuid4

import pytest
from psycopg import sql

from src.roommate.postgres import PostgresPool


@pytest.fixture
def pg_store():
    url = os.getenv("ROOMMATE_TEST_DATABASE_URL")
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
