from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class SkuMatch:
    raw: str
    bases: tuple[str, ...]
    confidence: float


class SkuNormalizer:
    def __init__(self, pattern: str, ignore_values: frozenset[str]):
        self.pattern = re.compile(pattern, re.IGNORECASE)
        self.ignore_values = ignore_values

    @staticmethod
    def clean(value: object) -> str:
        if value is None:
            return ""
        return str(value).replace("\u3000", " ").strip()

    def extract(self, value: object) -> SkuMatch | None:
        raw = self.clean(value)
        upper = raw.upper()
        if not raw or upper in self.ignore_values or upper.startswith("="):
            return None
        found = {re.sub(r"[\s_-]", "", m.group(1).upper()) for m in self.pattern.finditer(upper)}
        found = {item for item in found if not item.startswith("ID")}
        if not found:
            return None
        bases = tuple(sorted(found))
        confidence = 0.5 if len(bases) != 1 else (1.0 if upper == bases[0] else (0.99 if upper.startswith("AMZN.GR.") else 0.95))
        return SkuMatch(raw=raw, bases=bases, confidence=confidence)
