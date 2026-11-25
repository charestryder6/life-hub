"""Passphrase encryption shared by sync.py — matches the WebCrypto code in web/js/health.js.

PBKDF2-SHA256 (250k iterations) -> AES-256-GCM. Output is JSON with base64 fields.
"""

import base64
import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 250_000


def _key(passphrase: str, salt: bytes, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(passphrase.encode("utf-8"))


def encrypt(obj, passphrase: str) -> dict:
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(passphrase, salt, ITERATIONS)).encrypt(iv, json.dumps(obj).encode("utf-8"), None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return {"v": 1, "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def decrypt(payload: dict, passphrase: str):
    d = lambda s: base64.b64decode(s)
    key = _key(passphrase, d(payload["salt"]), payload.get("iter", ITERATIONS))
    return json.loads(AESGCM(key).decrypt(d(payload["iv"]), d(payload["ct"]), None))
