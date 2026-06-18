"""Optional OpenAI model-backed analysis layer.

The rule-based pipeline gives the app a dependable offline baseline. When an
OpenAI API key is configured, this module asks a model to validate, enrich, and
explain the extracted facts using structured JSON.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from copy import deepcopy

from finanalyst.config import load_env_file


DEFAULT_OPENAI_MODEL = "gpt-5.5"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"
RESPONSES_URL = "https://api.openai.com/v1/responses"
GEMINI_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


@dataclass(frozen=True)
class GenAIResult:
    enabled: bool
    provider: str | None
    model: str | None
    data: dict | None
    error: str | None = None


def enrich_analysis(analysis: dict, source_text: str) -> GenAIResult:
    load_env_file()
    provider = _select_provider()
    if provider == "gemini":
        return _enrich_with_gemini(analysis, source_text)
    if provider == "openai":
        return _enrich_with_openai(analysis, source_text)
    return GenAIResult(
        False,
        None,
        None,
        None,
        "Set GEMINI_API_KEY or OPENAI_API_KEY to enable model-backed analysis.",
    )


def _select_provider() -> str | None:
    configured = os.getenv("AI_PROVIDER", "").strip().lower()
    if configured in {"gemini", "openai"}:
        return configured
    if os.getenv("GEMINI_API_KEY"):
        return "gemini"
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    return None


def _enrich_with_openai(analysis: dict, source_text: str) -> GenAIResult:
    api_key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)
    if not api_key:
        return GenAIResult(True, "openai", model, None, "OPENAI_API_KEY is not set.")

    payload = {
        "model": model,
        "reasoning": {"effort": os.getenv("OPENAI_REASONING_EFFORT", "low")},
        "instructions": _instructions(),
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": _analysis_prompt(analysis, source_text),
                    }
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "financial_document_analysis",
                "strict": True,
                "schema": _schema(),
            }
        },
    }

    request = urllib.request.Request(
        RESPONSES_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=int(os.getenv("OPENAI_TIMEOUT", "60"))) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:800]
        return GenAIResult(True, "openai", model, None, f"OpenAI API HTTP {exc.code}: {detail}")
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        return GenAIResult(True, "openai", model, None, f"OpenAI API request failed: {exc}")

    output_text = _extract_output_text(response_payload)
    if not output_text:
        return GenAIResult(True, "openai", model, None, "OpenAI API returned no text output.")
    try:
        return GenAIResult(True, "openai", model, json.loads(output_text), None)
    except json.JSONDecodeError as exc:
        return GenAIResult(True, "openai", model, None, f"Model output was not valid JSON: {exc}")


def _enrich_with_gemini(analysis: dict, source_text: str) -> GenAIResult:
    api_key = os.getenv("GEMINI_API_KEY")
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    if not api_key:
        return GenAIResult(True, "gemini", model, None, "GEMINI_API_KEY is not set.")

    payload = {
        "systemInstruction": {"parts": [{"text": _instructions()}]},
        "contents": [
            {
                "parts": [
                    {
                        "text": _analysis_prompt(analysis, source_text),
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": _gemini_schema(),
        },
    }
    thinking_level = os.getenv("GEMINI_THINKING_LEVEL", "low").strip()
    if thinking_level:
        payload["generationConfig"]["thinkingConfig"] = {"thinkingLevel": thinking_level}

    request = urllib.request.Request(
        GEMINI_URL_TEMPLATE.format(model=model),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=int(os.getenv("GEMINI_TIMEOUT", "60"))) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:800]
        return GenAIResult(True, "gemini", model, None, f"Gemini API HTTP {exc.code}: {detail}")
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        return GenAIResult(True, "gemini", model, None, f"Gemini API request failed: {exc}")

    output_text = _extract_gemini_text(response_payload)
    if not output_text:
        return GenAIResult(True, "gemini", model, None, "Gemini API returned no text output.")
    try:
        return GenAIResult(True, "gemini", model, json.loads(output_text), None)
    except json.JSONDecodeError as exc:
        return GenAIResult(True, "gemini", model, None, f"Gemini output was not valid JSON: {exc}")


def _instructions() -> str:
    return (
        "You are a senior equity research analyst. Use only the supplied filing "
        "excerpts and extracted facts. Validate figures, explain uncertainty, and "
        "do not invent metrics that are not grounded in the supplied text."
    )


def _analysis_prompt(analysis: dict, source_text: str) -> str:
    compact_analysis = {
        "company": analysis.get("company"),
        "filename": analysis.get("filename"),
        "extraction": analysis.get("extraction"),
        "metrics": analysis.get("metrics", [])[:20],
        "tone": analysis.get("tone"),
        "risks": analysis.get("risks", [])[:12],
        "metric_comparison": analysis.get("metric_comparison", [])[:12],
        "risk_comparison": analysis.get("risk_comparison"),
    }
    excerpts = "\n\n".join(
        [
            "FINANCIALS:\n" + analysis.get("sections", {}).get("financials", "")[:6500],
            "MD&A:\n" + analysis.get("sections", {}).get("mda", "")[:6500],
            "RISK FACTORS:\n" + analysis.get("sections", {}).get("risk_factors", "")[:6500],
            "GUIDANCE/FORWARD LOOKING:\n" + analysis.get("sections", {}).get("guidance", "")[:4500],
            "EARLY DOCUMENT CONTEXT:\n" + source_text[:3500],
        ]
    )
    return (
        "Review this financial filing analysis. Return structured JSON matching "
        "the schema. Ground every conclusion in the provided facts/excerpts.\n\n"
        f"EXTRACTED_FACTS_JSON:\n{json.dumps(compact_analysis, indent=2)}\n\n"
        f"FILING_EXCERPTS:\n{excerpts}"
    )


def _schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "company_overview": {"type": "string"},
            "validated_metrics": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "name": {"type": "string"},
                        "value": {"type": "string"},
                        "period": {"type": "string"},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                        "evidence": {"type": "string"},
                    },
                    "required": ["name", "value", "period", "confidence", "evidence"],
                },
            },
            "tone_assessment": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "label": {"type": "string"},
                    "explanation": {"type": "string"},
                    "evidence": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["label", "explanation", "evidence"],
            },
            "risk_assessment": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "category": {"type": "string"},
                        "severity": {"type": "string"},
                        "risk": {"type": "string"},
                        "why_it_matters": {"type": "string"},
                    },
                    "required": ["category", "severity", "risk", "why_it_matters"],
                },
            },
            "bull_case": {"type": "array", "items": {"type": "string"}},
            "bear_case": {"type": "array", "items": {"type": "string"}},
            "questions_to_investigate": {"type": "array", "items": {"type": "string"}},
            "investment_memo": {"type": "string"},
        },
        "required": [
            "company_overview",
            "validated_metrics",
            "tone_assessment",
            "risk_assessment",
            "bull_case",
            "bear_case",
            "questions_to_investigate",
            "investment_memo",
        ],
    }


def _gemini_schema() -> dict:
    schema = deepcopy(_schema())

    def strip_unsupported(value):
        if isinstance(value, dict):
            value.pop("additionalProperties", None)
            for child in value.values():
                strip_unsupported(child)
        elif isinstance(value, list):
            for child in value:
                strip_unsupported(child)

    strip_unsupported(schema)
    return schema


def _extract_output_text(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    chunks: list[str] = []
    for item in payload.get("output", []):
        for content in item.get("content", []):
            text = content.get("text")
            if isinstance(text, str):
                chunks.append(text)
    return "\n".join(chunks).strip()


def _extract_gemini_text(payload: dict) -> str:
    chunks: list[str] = []
    for candidate in payload.get("candidates", []):
        content = candidate.get("content", {})
        for part in content.get("parts", []):
            text = part.get("text")
            if isinstance(text, str):
                chunks.append(text)
    return "\n".join(chunks).strip()
