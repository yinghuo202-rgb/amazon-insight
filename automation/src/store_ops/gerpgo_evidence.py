"""Remove authentication fields from new GERPgo evidence copies, not business facts."""
from __future__ import annotations

import re
from typing import Any

_AUTH_FIELDS = frozenset({
    "appkey", "appsecret", "clientsecret", "apikey", "accesstoken", "refreshtoken",
    "authtoken", "publictoken", "authtokenurl", "authorization", "cookie", "setcookie",
    "password", "secret", "token", "sign", "signature", "xapikey", "xappkey",
})


def sanitize_gerpgo_evidence(value: Any) -> Any:
    """Return a recursive copy, dropping only exact normalized authentication keys.

    Values, business identifiers and non-authentication keys are preserved. This
    deliberately does not rewrite strings or mutate legacy captures/generations.
    """
    if isinstance(value, dict):
        return {
            key: sanitize_gerpgo_evidence(item)
            for key, item in value.items()
            if not isinstance(key, str) or re.sub(r"[^a-z0-9]", "", key.lower()) not in _AUTH_FIELDS
        }
    if isinstance(value, list):
        return [sanitize_gerpgo_evidence(item) for item in value]
    return value
