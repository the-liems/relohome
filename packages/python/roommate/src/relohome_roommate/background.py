"""Periodic local maintenance; replicas coordinate through the database transaction."""

import asyncio
import logging

from relohome_roommate.maintenance import reconcile

logger = logging.getLogger(__name__)


class RoommateMaintenance:
    def __init__(self, runtime, interval=60):
        self.runtime = runtime
        self.interval = interval
        self.stop_event = asyncio.Event()
        self.task = None

    def _reconcile(self):
        with self.runtime.context() as ctx, ctx.transaction():
            reconcile(ctx)

    async def _run(self):
        while not self.stop_event.is_set():
            try:
                await asyncio.wait_for(self.stop_event.wait(), timeout=self.interval)
            except TimeoutError:
                try:
                    await asyncio.to_thread(self._reconcile)
                except Exception:
                    # The traceback is the only way to find why a background pass failed.
                    logger.error("roommate_maintenance_failed", exc_info=True)

    def start(self):
        self.task = asyncio.create_task(self._run())

    async def stop(self):
        self.stop_event.set()
        if self.task:
            await self.task
