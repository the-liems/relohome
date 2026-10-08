import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class ContactVault:
    def __init__(self, key_path: Path, *, create: bool = True):
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
        self.fernet = Fernet(key_path.read_bytes())

    def seal(self, value: str) -> bytes:
        return self.fernet.encrypt(value.encode("utf-8"))

    def open(self, sealed: bytes) -> str:
        try:
            return self.fernet.decrypt(sealed).decode("utf-8")
        except InvalidToken:
            raise ValueError("Contact decryption failed; check the paired backup key") from None
