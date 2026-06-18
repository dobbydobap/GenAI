"""Document sectioning helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class DocumentSections:
    financials: str
    mda: str
    risk_factors: str
    guidance: str
    full_text: str


SECTION_PATTERNS = {
    "risk_factors": [
        r"item\s+1a\.?\s+risk\s+factors",
        r"risk\s+factors",
    ],
    "mda": [
        r"item\s+7\.?\s+management.s\s+discussion\s+and\s+analysis",
        r"item\s+7a?\.?\s+management.s\s+discussion",
        r"management.s\s+discussion\s+and\s+analysis",
        r"md&a",
        r"results\s+of\s+operations",
    ],
    "financials": [
        r"item\s+8\.?\s+financial\s+statements",
        r"consolidated\s+statements\s+of\s+(operations|income|comprehensive\s+income|cash\s+flows|earnings)",
        r"consolidated\s+balance\s+sheet",
        r"financial\s+highlights",
        r"selected\s+financial\s+data",
    ],
    "guidance": [
        r"outlook",
        r"guidance",
        r"forward[\s-]looking\s+statements",
        r"business\s+outlook",
        r"financial\s+outlook",
        r"future\s+expectations",
    ],
}


def split_sections(text: str) -> DocumentSections:
    lower = text.lower()
    starts: dict[str, int] = {}
    for name, patterns in SECTION_PATTERNS.items():
        for pattern in patterns:
            matches = list(re.finditer(pattern, lower))
            if matches:
                chosen = next((match for match in matches if match.start() > 10_000), matches[0])
                starts[name] = chosen.start()
                break

    def slice_from(name: str, fallback_terms: list[str]) -> str:
        if name not in starts:
            return _keyword_window(text, fallback_terms)
        start = starts[name]
        later = [pos for key, pos in starts.items() if key != name and pos > start]
        end = min(later) if later else min(len(text), start + 35000)
        return text[start:end].strip()

    return DocumentSections(
        financials=slice_from("financials", ["revenue", "net income", "cash flow", "debt"]),
        mda=slice_from("mda", ["management", "results of operations", "liquidity"]),
        risk_factors=slice_from("risk_factors", ["risk", "uncertain", "adverse"]),
        guidance=slice_from("guidance", ["expect", "outlook", "guidance", "future"]),
        full_text=text,
    )


def _keyword_window(text: str, terms: list[str], radius: int = 9000) -> str:
    lower = text.lower()
    hits = [lower.find(term) for term in terms if lower.find(term) >= 0]
    if not hits:
        return text[: min(len(text), radius)]
    start = max(0, min(hits) - radius // 3)
    end = min(len(text), start + radius)
    return text[start:end].strip()
