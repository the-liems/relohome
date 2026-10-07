from typing import Annotated

from pydantic import Field, StrictBool, StrictInt, StringConstraints

from src.roommate.models import RoommateModel, RoommateSearchCriteria
from src.roommate.views import DiscoveryItem

OperationKey = Annotated[str, StringConstraints(strict=True, min_length=16, max_length=128)]


class AccessAcceptance(RoommateModel):
    adult: StrictBool
    terms_version: str


class SearchInput(RoommateModel):
    criteria: RoommateSearchCriteria
    offset: StrictInt = Field(default=0, ge=0)
    limit: StrictInt = Field(default=20, ge=1, le=50)


class DiscoveryPage(RoommateModel):
    items: tuple[DiscoveryItem, ...]
    total: int
    offset: int
    limit: int
