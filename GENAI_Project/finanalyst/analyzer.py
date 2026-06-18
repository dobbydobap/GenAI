"""High-level analysis orchestration."""

from __future__ import annotations

import re
from pathlib import Path

from finanalyst.genai import enrich_analysis
from finanalyst.memo import generate_memo
from finanalyst.metrics import benchmark, compare_metrics, extract_metrics
from finanalyst.pdf_text import extract_text
from finanalyst.risks import compare_risks, extract_risks
from finanalyst.sections import split_sections
from finanalyst.tone import analyze_tone


def analyze_document(path: Path, prior: dict | None = None) -> dict:
    extraction = extract_text(path)
    sections = split_sections(extraction.text)
    # Feed multiple sections to metrics extraction for maximum coverage
    metrics_text = "\n".join([
        sections.financials,
        sections.mda,
        sections.guidance,
        extraction.text[:50000],
    ])
    metrics = extract_metrics(metrics_text)
    risks = extract_risks(sections.risk_factors)
    prior_text = prior.get("sections", {}).get("mda") if prior else None
    tone = analyze_tone(sections.mda or extraction.text[:25000], prior_text)

    analysis = {
        "filename": path.name,
        "company": infer_company(extraction.text, path.name),
        "extraction": {
            "method": extraction.method,
            "confidence": extraction.confidence,
            "warnings": extraction.warnings,
            "characters": len(extraction.text),
        },
        "sections": {
            "financials": sections.financials[:12000],
            "mda": sections.mda[:12000],
            "risk_factors": sections.risk_factors[:12000],
            "guidance": sections.guidance[:12000],
        },
        "metrics": [metric.to_dict() for metric in metrics],
        "metric_comparison": compare_metrics(
            metrics,
            _metric_objects(prior.get("metrics", [])) if prior else None,
        ),
        "tone": tone,
        "risks": risks,
        "risk_comparison": compare_risks(risks, prior.get("risks", []) if prior else None),
    }
    analysis["analysis_mode"] = "rules"
    analysis["memo"] = generate_memo(analysis, prior)
    genai = enrich_analysis(analysis, extraction.text)
    analysis["genai"] = {
        "enabled": genai.enabled,
        "provider": genai.provider,
        "model": genai.model,
        "error": genai.error,
        "data": genai.data,
    }
    if genai.data:
        analysis["analysis_mode"] = "openai"
        analysis["rule_based_memo"] = analysis["memo"]
        analysis["memo"] = genai.data.get("investment_memo") or analysis["memo"]
    return analysis


def analyze_batch(paths: list[Path]) -> dict:
    analyses = [analyze_document(path) for path in paths]
    return {"documents": analyses, "benchmark": benchmark(analyses)}


def infer_company(text: str, fallback: str) -> str:
    """Infer company name from SEC filing text using multiple heuristics."""

    # --- Strategy 1: SEC "exact name of registrant" line ---
    # Standard SEC format: company name is on the line BEFORE "(Exact name of registrant...)"
    before_registrant = re.search(
        r"([A-Z][A-Z0-9 ,.&'()\-]{3,80})\s*\n\s*\(?\s*[Ee]xact\s+name\s+of\s+registrant",
        text[:15000],
    )
    if before_registrant:
        value = _clean_company_name(before_registrant.group(1))
        if 3 < len(value) < 90 and not _is_boilerplate(value):
            return value

    # Also try: company name on line AFTER "exact name of registrant" (some formats)
    registrant_patterns = [
        r"exact\s+name\s+of\s+registrant[^A-Z\n]{0,40}\n\s*([A-Z][A-Z0-9 ,.&'()-]{3,80})",
        r"exact\s+name\s+of\s+registrant[^A-Z\n]{0,40}([A-Z][A-Z0-9 ,.&'()-]{3,80})",
    ]
    for pattern in registrant_patterns:
        match = re.search(pattern, text[:15000], re.I | re.S)
        if match:
            value = _clean_company_name(match.group(1))
            if 3 < len(value) < 90 and not _is_boilerplate(value):
                return value

    # --- Strategy 1b: Line right after "Commission file number" ---
    comm_match = re.search(
        r"[Cc]ommission\s+file\s+number[^\n]*\n\s*\n?\s*([A-Z][A-Z0-9 ,.&'()\-]{3,80})",
        text[:15000],
    )
    if comm_match:
        value = _clean_company_name(comm_match.group(1))
        if 3 < len(value) < 90 and not _is_boilerplate(value):
            return value

    # --- Strategy 2: Company name before "FORM 10-K" / "FORM 10-Q" ---
    form_patterns = [
        r"([A-Z][A-Z0-9 ,.&'()-]{3,80})\s*\n.*?FORM\s+10-[KQ]",
        r"([A-Z][A-Z0-9 ,.&'()-]{3,80})\s+FORM\s+10-[KQ]",
    ]
    for pattern in form_patterns:
        match = re.search(pattern, text[:15000], re.S)
        if match:
            value = _clean_company_name(match.group(1))
            if 3 < len(value) < 90 and not _is_boilerplate(value):
                return value

    # --- Strategy 3: Spaced-out capital letters (Chromium PDF artifact) ---
    # e.g. "L O C K H E E D  M A R T I N  C O R P O R A T I O N"
    for line in text.splitlines()[:100]:
        stripped = line.strip()
        if re.search(r"[A-Z]\s+[A-Z]", stripped) and len(stripped) > 10:
            collapsed = re.sub(r"(?<=\w)\s+(?=\w)", "", stripped)
            if any(kw in collapsed.upper() for kw in ("CORP", "INC", "LLC", "LTD", "COMPANY", "CO.", "GROUP")):
                return collapsed.title()

    # --- Strategy 4: First prominent all-caps line that looks like a company ---
    for line in text.splitlines()[:120]:
        stripped = line.strip()
        if (
            len(stripped) > 5
            and stripped.isupper()
            and any(kw in stripped for kw in ("CORP", "INC", "LLC", "LTD", "COMPANY", "CO.", "GROUP"))
        ):
            return _clean_company_name(stripped)

    # --- Strategy 5: After SEC/EDGAR header lines ---
    post_sec = re.search(
        r"(?:SECURITIES AND EXCHANGE COMMISSION|Washington,?\s*D\.?C\.?)[^\n]*\n(.*?)(?:FORM|ANNUAL|Commission)",
        text[:15000],
        re.I | re.S,
    )
    if post_sec:
        for line in post_sec.group(1).splitlines():
            stripped = line.strip()
            if len(stripped) > 4 and re.search(r"[A-Za-z]{3,}", stripped):
                value = _clean_company_name(stripped)
                if 3 < len(value) < 90 and not _is_boilerplate(value):
                    return value

    return Path(fallback).stem


def _clean_company_name(raw: str) -> str:
    """Normalize a company name extracted from text."""
    value = re.sub(r"\s+", " ", raw).strip(" -.,")
    # Collapse spaced-out letters if present
    if re.search(r"[A-Z]\s[A-Z]\s[A-Z]", value):
        value = re.sub(r"(?<=\w)\s+(?=\w)", "", value)
    # Title-case if all-caps, otherwise keep as-is
    if value.isupper() and len(value) > 4:
        value = value.title()
    return value


def _is_boilerplate(text: str) -> bool:
    """Check if text is SEC boilerplate rather than a company name."""
    boilerplate_terms = [
        "UNITED STATES", "SECURITIES AND EXCHANGE", "WASHINGTON",
        "ANNUAL REPORT", "TRANSITION REPORT", "COMMISSION FILE",
        "FORM 10", "PURSUANT TO",
    ]
    upper = text.upper()
    return any(term in upper for term in boilerplate_terms)


def _metric_objects(metrics: list[dict]):
    from finanalyst.metrics import Metric

    return [
        Metric(
            name=m["name"],
            value=m["value"],
            unit=m.get("unit", ""),
            raw_value=m.get("raw_value", ""),
            context=m.get("context", ""),
            period=m.get("period"),
        )
        for m in metrics
    ]
