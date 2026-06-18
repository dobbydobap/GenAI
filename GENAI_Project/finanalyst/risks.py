"""Risk factor extraction and comparison."""

from __future__ import annotations

import re


CATEGORIES = {
    "market": ["competition", "market", "demand", "customer", "pricing"],
    "macroeconomic": ["inflation", "interest", "recession", "currency", "economic"],
    "operational": ["supply", "manufacturing", "labor", "inventory", "distribution"],
    "technology": ["cyber", "technology", "data", "system", "security"],
    "legal/regulatory": ["regulation", "legal", "compliance", "tax", "litigation"],
    "financial": ["debt", "liquidity", "credit", "cash", "impairment"],
    "climate/esg": ["climate", "environment", "sustainability", "emission"],
}


def extract_risks(text: str) -> list[dict]:
    normalized = re.sub(r"\s+", " ", text)
    candidates = re.split(r"(?<=[.!?])\s+", normalized)
    risks: list[dict] = []
    seen: set[str] = set()
    for sentence in candidates:
        lower = sentence.lower()
        if not any(term in lower for term in ["risk", "adverse", "uncertain", "material", "could", "may"]):
            continue
        category = categorize_risk(sentence)
        key = _fingerprint(sentence)
        if key in seen or len(sentence) < 60:
            continue
        seen.add(key)
        risks.append(
            {
                "title": _title_from_sentence(sentence),
                "category": category,
                "severity": _severity(sentence),
                "excerpt": sentence[:520],
                "fingerprint": key,
            }
        )
        if len(risks) >= 18:
            break
    return risks


def compare_risks(current: list[dict], prior: list[dict] | None = None) -> dict:
    prior = prior or []
    prior_keys = {risk["fingerprint"] for risk in prior}
    current_keys = {risk["fingerprint"] for risk in current}
    new = [risk for risk in current if risk["fingerprint"] not in prior_keys]
    removed = [risk for risk in prior if risk["fingerprint"] not in current_keys]
    escalated = [
        risk
        for risk in current
        if risk["severity"] == "high"
        and any(old["category"] == risk["category"] and old["severity"] != "high" for old in prior)
    ]
    return {"new": new[:8], "removed": removed[:8], "escalated": escalated[:8]}


def categorize_risk(sentence: str) -> str:
    lower = sentence.lower()
    scores = {
        category: sum(1 for keyword in keywords if keyword in lower)
        for category, keywords in CATEGORIES.items()
    }
    best = max(scores, key=scores.get)
    return best if scores[best] else "general"


def _severity(sentence: str) -> str:
    lower = sentence.lower()
    high_terms = ["material adverse", "significant", "substantial", "severe", "materially"]
    medium_terms = ["could", "may", "uncertain", "disrupt", "decline"]
    if any(term in lower for term in high_terms):
        return "high"
    if any(term in lower for term in medium_terms):
        return "medium"
    return "low"


def _fingerprint(sentence: str) -> str:
    words = [
        word
        for word in re.findall(r"[a-z]+", sentence.lower())
        if len(word) > 4 and word not in {"could", "would", "their", "there", "these", "those"}
    ]
    return "-".join(words[:10])


def _title_from_sentence(sentence: str) -> str:
    clean = re.sub(r"\s+", " ", sentence).strip()
    return clean[:90].rstrip(",.;:") or "Risk factor"
