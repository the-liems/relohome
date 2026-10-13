"""Explicit synthetic playground, not a profile repository or consent ledger.

Only the generator writes this dataset. Real discovery, contact and connection
services never read it. Housing links are illustrations, not occupancy claims.
"""

from datetime import datetime
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, model_validator

from relohome_roommate.eligibility import eligible
from relohome_roommate.models import RoommateModel, RoommateSearchCriteria
from relohome_roommate.policy import ProfileState
from relohome_roommate.ports import ProfileRecord
from relohome_roommate.ranking import ranked


class DemoDataset(RoommateModel):
    source_kind: Literal["demo"] = "demo"
    generated_at: datetime
    profiles: tuple[ProfileRecord, ...] = Field(min_length=30, max_length=100)

    @model_validator(mode="after")
    def synthetic_only(self) -> Self:
        ids = [p.owner_id for p in self.profiles]
        if len(set(ids)) != len(ids) or any(
            not p.owner_id.startswith("demo_") or not (p.content.display_name or "").startswith("DEMO ")
            for p in self.profiles
        ):
            raise ValueError("Demo data must contain distinct, explicitly labeled synthetic people")
        return self

    @classmethod
    def load(cls, path: Path):
        if path.stat().st_size > 2_000_000:
            raise ValueError("Demo dataset size limit")
        return cls.model_validate_json(path.read_text(encoding="utf-8"))

    def search(self, actor_id: str, criteria: RoommateSearchCriteria, now: datetime, offset: int, limit: int):
        records = [p for p in self.profiles if eligible(actor_id, criteria, p, now).passed]
        ordered = ranked(criteria, records)
        bindings = {p.owner_id: p.content.room for p in records}
        return {
            "source_kind": "demo",
            "connections_enabled": False,
            "notice": f"{len(self.profiles)} hồ sơ giả để trải nghiệm; liên kết nhà chỉ minh họa, không xác nhận người đang ở đó.",
            "items": [
                {
                    **item.model_dump(mode="json"),
                    "room_listing_id": bindings[item.profile.profile_id].listing_id
                    if bindings[item.profile.profile_id]
                    else None,
                }
                for item in ordered[offset : offset + limit]
            ],
            "total": len(ordered),
            "offset": offset,
            "limit": limit,
        }

    def room_profiles(self, listing_ids: set[str], now: datetime):
        return [
            p
            for p in self.profiles
            if p.state is ProfileState.ACTIVE
            and p.expires_at
            and now < p.expires_at
            and p.content.room
            and p.content.room.listing_id in listing_ids
        ]
