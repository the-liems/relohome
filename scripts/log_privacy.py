"""Privacy filters shared by AI log collection and submission."""
import re
from pathlib import Path


def redact_transcript_path(value: object) -> str:
    """Replace home-directory prefixes without reading the referenced file."""
    if not isinstance(value, str):
        return ""
    if not value:
        return value

    # Also handle custom home directories on the machine collecting the log.
    home = str(Path.home()).rstrip("/\\")
    if home and (value == home or value.startswith((home + "/", home + "\\"))):
        return "[HOME]" + value[len(home):]

    # Handle queued logs from other users/platforms, preserving the suffix.
    return re.sub(
        r"^(?:[A-Za-z]:[/\\]Users[/\\]|/(?:Users|home)/)[^/\\]+",
        "[HOME]",
        value,
        flags=re.IGNORECASE,
    )
