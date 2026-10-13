"""Real PostgreSQL parity tests. CI provisions ROOMMATE_TEST_DATABASE_URL."""

from relohome_roommate.connections import ContactRef
from relohome_roommate.models import RoommateSearchCriteria
from relohome_roommate.ports import Actor
from relohome_roommate.services.consent import ConsentService
from relohome_roommate.services.discovery import DiscoveryService
from relohome_roommate.services.requests import RequestService

from tests.test_roommate.test_profile_lifecycle import complete
from tests.test_roommate.test_request_lifecycle import prepare


def test_postgres_preserves_request_retry_pair_consent_and_revoke(pg_store):
    with pg_store.storage() as db:
        ctx = prepare(db)
        request = RequestService(ctx)
        payload = (Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "pg-send-operation-01")
        result = request.send(*payload)
        assert request.send(*payload) == result
        reverse = request.send(
            Actor(id="b"), "a", complete(), ContactRef(channel_id="b", version=1), True, "pg-reverse-operation1"
        )
        assert reverse["request_id"] == result["request_id"]
        consent = ConsentService(ctx)
        consent.accept(
            Actor(id="b"), result["request_id"], ContactRef(channel_id="b", version=1), True, "pg-accept-operation1"
        )
        assert ctx.connections.grant(result["request_id"]).state.value == "active"
        consent.revoke(Actor(id="a"), result["request_id"], "pg-revoke-operation1")
        assert ctx.connections.grant(result["request_id"]).state.value == "revoked"


def test_postgres_read_search_does_not_block_while_another_replica_writes(pg_store):
    with pg_store.storage() as db:
        ctx = prepare(db)
        with pg_store.storage() as writer, writer.transaction():
            writer.connection.execute("INSERT INTO restrictions VALUES ('irrelevant',1)")
            found = DiscoveryService(ctx).search(Actor(id="a"), RoommateSearchCriteria(city="hcm"))
            assert found["total"] == 1


def test_existing_schema_runs_with_dedicated_non_superuser_role(pg_store):
    from uuid import uuid4

    from psycopg import sql
    from psycopg.conninfo import make_conninfo
    from relohome_roommate.postgres import PostgresPool

    role = "rmtest_roommate_" + uuid4().hex
    password = uuid4().hex
    app_pool = None
    with pg_store.pool.connection() as admin:
        admin.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(role), sql.Literal(password)))
        try:
            admin.execute(
                sql.SQL("GRANT USAGE,CREATE ON SCHEMA {} TO {}").format(
                    sql.Identifier(pg_store.schema), sql.Identifier(role)
                )
            )
            admin.execute(
                sql.SQL("GRANT ALL ON ALL TABLES IN SCHEMA {} TO {}").format(
                    sql.Identifier(pg_store.schema), sql.Identifier(role)
                )
            )
            url = make_conninfo(admin.info.dsn, user=role, password=password)
            app_pool = PostgresPool(url, pg_store.schema)
            app_pool.initialize()
            with app_pool.storage() as db, db.transaction():
                assert not db.connection.execute("SELECT rolsuper FROM pg_roles WHERE rolname=current_user").fetchone()[
                    0
                ]
                db.connection.execute("INSERT INTO restrictions VALUES ('test-user',1)")
        finally:
            if app_pool:
                app_pool.close()
            admin.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role)))
            admin.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))
