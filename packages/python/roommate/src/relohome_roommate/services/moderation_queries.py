"""Bounded, read-only Admin projections; private criteria/contact/chat stay private."""

from relohome_roommate.access import RoommateError


def profile_view(ctx, record):
    state = record.state.value
    if state == "active" and record.expires_at and record.expires_at <= ctx.clock.now():
        state = "expired"
    return {
        "profile_id": record.owner_id,
        "state": state,
        "version": record.version,
        "display_name": record.content.display_name,
        "introduction": record.content.introduction,
        "facts": record.content.facts.model_dump(mode="json"),
        "avatar_id": record.avatar_id,
        "updated_at": record.updated_at.isoformat(),
        "expires_at": record.expires_at.isoformat() if record.expires_at else None,
    }


def profile_page(
    ctx, *, status, offset, limit, q="", city=None, need=None, min_budget=None, max_budget=None, sort="updated_desc"
):
    db = ctx.storage.connection
    postgres = hasattr(db, "raw")

    def field(path):
        return (
            f"(p.content::jsonb #>> '{{{path.replace('.', ',')}}}')"
            if postgres
            else f"json_extract(p.content,'$.{path}')"
        )

    if not postgres:
        db.create_function("rm_casefold", 1, lambda value: str(value or "").casefold(), deterministic=True)
    lower = "LOWER" if postgres else "rm_casefold"
    effective_state = "CASE WHEN p.state='active' AND p.expires<=? THEN 'expired' ELSE p.state END"
    where = ["p.state NOT IN ('draft','deleted')"]
    params = []
    if status:
        if status not in ("active", "paused", "resolved", "expired", "restricted"):
            raise RoommateError("invalid_input", status=422)
        where.append(f"({effective_state})=?")
        params.extend((ctx.clock.now().timestamp(), status))
    if q:
        if len(q) > 100:
            raise RoommateError("invalid_input", status=422)
        pattern = "%" + q.strip().casefold().replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
        where.append(
            f"({lower}(p.owner) LIKE ? ESCAPE '!' OR {lower}({field('content.display_name')}) LIKE ? ESCAPE '!' OR {lower}({field('content.introduction')}) LIKE ? ESCAPE '!')"
        )
        params.extend((pattern, pattern, pattern))
    if city:
        if city not in ("hcm", "hanoi", "danang"):
            raise RoommateError("invalid_input", status=422)
        where.append("p.city=?")
        params.append(city)
    if need:
        if need not in ("has_room", "looking_together"):
            raise RoommateError("invalid_input", status=422)
        where.append(field("content.facts.need.kind") + "=?")
        params.append(need)
    low = f"CAST({field('content.facts.budget.min_vnd')} AS BIGINT)"
    high = f"CAST({field('content.facts.budget.max_vnd')} AS BIGINT)"
    if min_budget is not None:
        where.append(high + ">=?")
        params.append(min_budget)
    if max_budget is not None:
        where.append(low + "<=?")
        params.append(max_budget)
    if any(v is not None and not 0 <= v <= 1000000000 for v in (min_budget, max_budget)) or (
        min_budget is not None and max_budget is not None and min_budget > max_budget
    ):
        raise RoommateError("invalid_input", status=422)
    orders = {
        "updated_desc": field("updated_at") + " DESC",
        "updated_asc": field("updated_at") + " ASC",
        "budget_asc": f"({high} IS NULL) ASC, {high} ASC",
        "budget_desc": f"({high} IS NULL) ASC, {high} DESC",
    }
    if sort not in orders:
        raise RoommateError("invalid_input", status=422)
    predicate = " AND ".join(where)
    total = db.execute("SELECT COUNT(*) FROM profiles p WHERE " + predicate, params).fetchone()[0]
    rows = db.execute(
        "SELECT p.content FROM profiles p WHERE "
        + predicate
        + " ORDER BY "
        + orders[sort]
        + ",p.owner LIMIT ? OFFSET ?",
        (*params, limit, offset),
    )
    from relohome_roommate.ports import ProfileRecord

    return {
        "items": [profile_view(ctx, ProfileRecord.model_validate_json(row[0])) for row in rows],
        "total": total,
        "offset": offset,
        "limit": limit,
    }
