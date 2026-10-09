from src.roommate.access import RoommateContext
from src.roommate.services.lifecycle import reconcile_profiles


def reconcile(context: RoommateContext) -> None:
    """Called inside the caller's transaction; reads also enforce deadlines independently."""
    reconcile_profiles(context)
    context.connections.expire(context.clock.now())
