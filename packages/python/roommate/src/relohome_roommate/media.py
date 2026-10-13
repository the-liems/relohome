import hashlib
import io
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError

from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.policy import ProfileState
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.limits import fingerprint, operation_key

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000


def sanitized_image(body: bytes) -> bytes:
    if not 1 <= len(body) <= MAX_IMAGE_BYTES:
        raise RoommateError("image_size_limit", status=413)
    try:
        with Image.open(io.BytesIO(body), formats=("JPEG", "PNG")) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS or getattr(image, "n_frames", 1) != 1:
                raise RoommateError("image_dimension_limit", status=422)
            image.load()
            corrected = ImageOps.exif_transpose(image).convert("RGB")
            corrected.thumbnail((1024, 1024))
            clean = Image.new("RGB", corrected.size)
            clean.paste(corrected)
            output = io.BytesIO()
            clean.save(output, format="PNG")
            return output.getvalue()
    except RoommateError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise RoommateError("invalid_image", status=422) from None


class MediaService:
    def __init__(self, context: RoommateContext):
        self.ctx = context
        self.access = AccessService(context)

    def upload(self, actor: Actor, body: bytes, key: str) -> dict:
        operation_key(key)
        self.access.require(actor)
        signature = fingerprint("upload", {"sha256": hashlib.sha256(body).hexdigest()})
        clean = sanitized_image(body)
        with self.ctx.transaction():
            self.access.require(actor)
            cached = self.ctx.connections.operation(actor.id, key, signature)
            if cached:
                return cached
            count = self.ctx.storage.connection.execute(
                "SELECT COUNT(*) FROM media WHERE owner=?", (actor.id,)
            ).fetchone()[0]
            if count >= 10:
                raise RoommateError("image_count_limit", status=429)
            identifier = uuid4().hex
            self.ctx.storage.connection.execute(
                "INSERT INTO media VALUES (?,?,?,?,'pending',?)",
                (identifier, actor.id, clean, "image/png", self.ctx.clock.now().timestamp()),
            )
            result = {"media_id": identifier, "status": "pending"}
            self.ctx.connections.finish_operation(actor.id, key, signature, result)
            return result

    def read(self, actor: Actor, identifier: str) -> bytes:
        with self.ctx.read_transaction():
            row = self.ctx.storage.connection.execute("SELECT * FROM media WHERE id=?", (identifier,)).fetchone()
            if row is None:
                raise RoommateError("image_unavailable", status=404)
            if actor.id not in self.ctx.moderators:
                self.access.require(actor)
                if self.ctx.safety.restricted(row["owner"]) or self.ctx.safety.blocked(actor.id, row["owner"]):
                    raise RoommateError("image_unavailable", status=404)
                if actor.id != row["owner"]:
                    record = self.ctx.profiles.get(row["owner"])
                    if (
                        row["status"] != "approved"
                        or record is None
                        or record.avatar_id != identifier
                        or record.state is not ProfileState.ACTIVE
                        or record.expires_at is None
                        or self.ctx.clock.now() >= record.expires_at
                    ):
                        raise RoommateError("image_unavailable", status=404)
            return row["content"]

    def review(self, actor: Actor, identifier: str, approved: bool, reason: str) -> dict:
        with self.ctx.transaction():
            self.access.require_moderator(actor)
            row = self.ctx.storage.connection.execute("SELECT owner FROM media WHERE id=?", (identifier,)).fetchone()
            if row is None or not reason.strip():
                raise RoommateError("image_unavailable", status=404)
            self.ctx.storage.connection.execute(
                "UPDATE media SET status=? WHERE id=?", ("approved" if approved else "rejected", identifier)
            )
            record = self.ctx.profiles.get(row[0])
            if not approved and record and record.avatar_id == identifier:
                self.ctx.profiles.save(
                    record.model_copy(update={"avatar_id": None, "version": record.version + 1}), record.version
                )
            self.ctx.storage.connection.execute(
                "INSERT INTO moderation VALUES (?,?,?,?,?,?)",
                (
                    uuid4().hex,
                    actor.id,
                    row[0],
                    "image_approve" if approved else "image_reject",
                    reason,
                    self.ctx.clock.now().timestamp(),
                ),
            )
            return {"media_id": identifier, "status": "approved" if approved else "rejected"}

    def queue(self, actor: Actor) -> list[dict]:
        with self.ctx.read_transaction():
            self.access.require_moderator(actor)
            return [
                dict(row)
                for row in self.ctx.storage.connection.execute(
                    "SELECT id AS media_id,owner,status,mime,created FROM media ORDER BY created,id"
                )
            ]

    def own(self, actor: Actor) -> list[dict]:
        with self.ctx.read_transaction():
            self.access.require(actor)
            return [
                dict(row)
                for row in self.ctx.storage.connection.execute(
                    "SELECT id AS media_id,status,mime,created FROM media WHERE owner=? ORDER BY created DESC,id",
                    (actor.id,),
                )
            ]

    def attach(self, actor: Actor, identifier: str, expected_version: int) -> dict:
        with self.ctx.transaction():
            self.access.require(actor)
            row = self.ctx.storage.connection.execute(
                "SELECT 1 FROM media WHERE id=? AND owner=? AND status='approved'", (identifier, actor.id)
            ).fetchone()
            record = self.ctx.profiles.get(actor.id)
            if row is None or record is None:
                raise RoommateError("image_unavailable", status=404)
            self.ctx.profiles.save(
                record.model_copy(update={"avatar_id": identifier, "version": record.version + 1}), expected_version
            )
            return {"media_id": identifier, "version": record.version + 1}

    def delete(self, actor: Actor, identifier: str) -> dict:
        with self.ctx.transaction():
            self.access.require(actor)
            row = self.ctx.storage.connection.execute("SELECT owner FROM media WHERE id=?", (identifier,)).fetchone()
            if row is None or row[0] != actor.id:
                raise RoommateError("image_unavailable", status=404)
            self.ctx.storage.connection.execute("DELETE FROM media WHERE id=?", (identifier,))
            record = self.ctx.profiles.get(actor.id)
            if record and record.avatar_id == identifier:
                self.ctx.profiles.save(
                    record.model_copy(update={"avatar_id": None, "version": record.version + 1}), record.version
                )
            return {"deleted": True}
