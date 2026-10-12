"""Bounded cache of actual catalog reads, never prices, quotes or transactions.

Owned by one Moving agent/client (therefore one provider/environment/credential
scope). Exact query arguments retain pickup/city/delivery-type boundaries; no
coordinate rounding. Copies keep per-request selections from mutating shared data.
"""

import json
from collections import OrderedDict
from copy import deepcopy
from time import monotonic

from relohome_agent.services.adapters.mcp import McpToolClient


class MovingCatalogCache:
    def __init__(self, client: McpToolClient, *, ttl_seconds: float = 45, max_entries: int = 64):
        self.client = client
        self.endpoint = client.endpoint
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self.entries: OrderedDict[str, tuple[float, dict]] = OrderedDict()

    def clear(self):
        self.entries.clear()

    def invalidate(self, arguments: dict):
        # A UI refresh at a pickup also invalidates its delivery-type variants.
        for key in list(self.entries):
            query = json.loads(key)
            if all(query.get(field) == value for field, value in arguments.items()):
                self.entries.pop(key, None)

    def get(self, arguments: dict) -> dict | None:
        if self.client.endpoint != self.endpoint:
            self.clear()
            self.endpoint = self.client.endpoint
        key = json.dumps(arguments, sort_keys=True, allow_nan=False)
        entry = self.entries.get(key)
        if entry is None:
            return None
        if monotonic() >= entry[0]:
            self.entries.pop(key, None)
            return None
        self.entries.move_to_end(key)
        return deepcopy(entry[1])

    def put(self, arguments: dict, observed: dict):
        # Do not cache missing/malformed/empty catalogs or provider failures.
        if not isinstance(observed, dict) or not observed.get("services"):
            return
        if self.client.endpoint != self.endpoint:
            self.clear()
            self.endpoint = self.client.endpoint
        key = json.dumps(arguments, sort_keys=True, allow_nan=False)
        self.entries[key] = (monotonic() + self.ttl_seconds, deepcopy(observed))
        self.entries.move_to_end(key)
        while len(self.entries) > self.max_entries:
            self.entries.popitem(last=False)

    async def read(self, arguments: dict, *, refresh: bool = False) -> dict:
        if refresh:
            self.invalidate(arguments)
        observed = self.get(arguments)
        if observed is not None:
            return observed
        observed = await self.client.call("list_moving_services", arguments)
        self.put(arguments, observed)
        return observed
