import hashlib
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class ContactVault:
    def __init__(self, key_path: Path, *, create: bool = True, key_value: str = ""):
        if key_value:
            self._key = key_value.encode("ascii")
            self.fingerprint = hashlib.sha256(key_value.encode("ascii")).hexdigest()
            self.fernet = Fernet(key_value.encode("ascii"))
            return
        key_path.parent.mkdir(parents=True, exist_ok=True)
        if create:
            try:
                descriptor = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                pass
            else:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(Fernet.generate_key())
                    stream.flush()
                    os.fsync(stream.fileno())
        key = key_path.read_bytes()
        self._key = key
        self.fingerprint = hashlib.sha256(key).hexdigest()
        self.fernet = Fernet(key)

    def seal(self, value: str) -> bytes:
        return self.fernet.encrypt(value.encode("utf-8"))

    def backup_key(self, target: Path) -> None:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(self._key)
            stream.flush()
            os.fsync(stream.fileno())

    def open(self, sealed: bytes) -> str:
        try:
            return self.fernet.decrypt(sealed).decode("utf-8")
        except InvalidToken:
            raise ValueError("Contact decryption failed; check the paired backup key") from None
