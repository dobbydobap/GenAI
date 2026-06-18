"""Management tone analysis."""

from __future__ import annotations

import re


CONFIDENT = {
    "strong",
    "confident",
    "record",
    "improved",
    "growth",
    "resilient",
    "favorable",
    "robust",
    "accelerated",
    "successful",
    "opportunity",
    "outperform",
}
CAUTIOUS = {
    "uncertain",
    "cautious",
    "risk",
    "decline",
    "pressure",
    "headwind",
    "volatile",
    "weakness",
    "challenge",
    "adverse",
    "disruption",
    "materially",
}
HEDGES = {
    "may",
    "might",
    "could",
    "possibly",
    "approximately",
    "believe",
    "expect",
    "intend",
    "anticipate",
    "estimate",
    "subject",
}


def analyze_tone(text: str, prior_text: str | None = None) -> dict:
    words = re.findall(r"[A-Za-z']+", text.lower())
    total = max(len(words), 1)
    confident = sum(1 for word in words if word in CONFIDENT)
    cautious = sum(1 for word in words if word in CAUTIOUS)
    hedges = sum(1 for word in words if word in HEDGES)
    score = (confident - cautious - hedges * 0.25) / total * 1000
    label = "confident" if score > 0.55 else "cautious" if score < -0.55 else "balanced"
    result = {
        "label": label,
        "score": round(score, 2),
        "confidence_terms": confident,
        "caution_terms": cautious,
        "hedging_terms": hedges,
        "hedging_rate": round(hedges / total * 100, 2),
        "flagged_passages": _flag_passages(text),
    }
    if prior_text:
        prior = analyze_tone(prior_text)
        result["change_vs_prior"] = round(result["score"] - prior["score"], 2)
        if result["score"] < prior["score"] - 0.75:
            result["tone_shift"] = "more cautious"
        elif result["score"] > prior["score"] + 0.75:
            result["tone_shift"] = "more confident"
        else:
            result["tone_shift"] = "stable"
    return result


def _flag_passages(text: str) -> list[dict]:
    sentences = re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text))
    scored = []
    for sentence in sentences:
        lower = sentence.lower()
        cautious = sum(1 for term in CAUTIOUS if term in lower)
        confident = sum(1 for term in CONFIDENT if term in lower)
        hedges = sum(1 for term in HEDGES if re.search(rf"\b{re.escape(term)}\b", lower))
        if cautious or confident or hedges >= 2:
            scored.append(
                {
                    "passage": sentence[:420],
                    "tone": "cautious" if cautious + hedges > confident else "confident",
                    "signal": cautious + confident + hedges,
                }
            )
    return sorted(scored, key=lambda item: item["signal"], reverse=True)[:6]
