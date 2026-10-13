import io

import pytest
from PIL import Image, PngImagePlugin
from relohome_roommate.access import RoommateError
from relohome_roommate.media import MediaService, sanitized_image
from relohome_roommate.ports import Actor
from relohome_roommate.storage import Storage

from tests.test_roommate.test_request_lifecycle import prepare


def image_bytes():
    output = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    info.add_text("contact", "private")
    Image.new("RGB", (32, 32), "white").save(output, format="PNG", pnginfo=info)
    return output.getvalue()


def test_image_decoder_strips_metadata_and_rejects_invalid_content():
    data = sanitized_image(image_bytes())
    with Image.open(io.BytesIO(data)) as image:
        assert image.info == {}
    for body in (b"<svg></svg>", b"https://example.test/private.png", b"broken"):
        with pytest.raises(RoommateError, match="invalid_image"):
            sanitized_image(body)


def test_private_media_review_owner_only_delete_and_block(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        ctx.moderators = frozenset({"mod"})
        service = MediaService(ctx)
        result = service.upload(Actor(id="a"), image_bytes(), "image-upload-op0001")
        identifier = result["media_id"]
        assert service.upload(Actor(id="a"), image_bytes(), "image-upload-op0001") == result
        assert service.read(Actor(id="a"), identifier) == sanitized_image(image_bytes())
        with pytest.raises(RoommateError):
            service.read(Actor(id="b"), identifier)
        service.review(Actor(id="mod"), identifier, True, "Reviewed")
        service.attach(Actor(id="a"), identifier, 2)
        assert service.read(Actor(id="b"), identifier)
        with ctx.transaction():
            ctx.safety.block("a", "b", True)
        with pytest.raises(RoommateError):
            service.read(Actor(id="b"), identifier)
        with pytest.raises(RoommateError):
            service.delete(Actor(id="b"), identifier)
        service.delete(Actor(id="a"), identifier)
        assert ctx.profiles.get("a").avatar_id is None
