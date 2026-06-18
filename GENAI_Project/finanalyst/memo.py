"""Investment memo generation grounded in extracted data."""

from __future__ import annotations

from finanalyst.metrics import compare_metrics


def generate_memo(analysis: dict, prior: dict | None = None) -> str:
    company = analysis.get("company") or analysis.get("filename", "Company")
    comparisons = compare_metrics(
        _metric_objects(analysis.get("metrics", [])),
        _metric_objects(prior.get("metrics", [])) if prior else None,
    )
    tone = analysis.get("tone", {})
    risks = analysis.get("risks", [])

    revenue = _find_metric(analysis, "Revenue")
    cash_flow = _find_metric(analysis, "Cash Flow")
    debt = _find_metric(analysis, "Debt")
    strongest = [row for row in comparisons if row.get("change_pct") is not None]
    strongest.sort(key=lambda row: row["change_pct"], reverse=True)

    bull = []
    bear = []
    if revenue:
        bull.append(f"Reported revenue signal of {revenue['raw_value']} in extracted filing context.")
    if cash_flow:
        bull.append(f"Cash generation appears analyzable from extracted cash-flow figure {cash_flow['raw_value']}.")
    if strongest and strongest[0]["change_pct"] > 0:
        bull.append(f"{strongest[0]['metric']} improved about {strongest[0]['change_pct']:.1f}% vs comparison document.")
    if tone.get("label") == "confident":
        bull.append("Management commentary screens as confident on the project tone model.")

    if debt:
        bear.append(f"Debt-related disclosure includes an extracted figure of {debt['raw_value']}.")
    if risks:
        bear.append(f"{len(risks)} risk passages were identified, led by {risks[0]['category']} risk.")
    if tone.get("label") == "cautious":
        bear.append("Management language contains elevated caution or hedging.")
    if strongest and strongest[-1]["change_pct"] < 0:
        bear.append(f"{strongest[-1]['metric']} declined about {abs(strongest[-1]['change_pct']):.1f}% vs comparison document.")

    return "\n".join(
        [
            f"# Investment Memo: {company}",
            "",
            "## Company Overview",
            f"Analyzed filing `{analysis.get('filename', 'document')}` using document ingestion, section parsing, metric extraction, tone analysis, and risk classification.",
            "",
            "## Financial Summary",
            _financial_summary(analysis, comparisons),
            "",
            "## Bull Case",
            _bullets(bull or ["Positive case requires analyst validation because extracted upside signals were limited."]),
            "",
            "## Bear Case",
            _bullets(bear or ["Downside case requires analyst validation because extracted risk signals were limited."]),
            "",
            "## Key Risks",
            _bullets([f"{risk['category'].title()}: {risk['title']}" for risk in risks[:5]] or ["No discrete risk passages extracted."]),
            "",
            "## Questions To Investigate",
            _bullets(
                [
                    "Which extracted metrics tie exactly to audited financial statement line items?",
                    "Are tone changes driven by one-time events or a durable shift in fundamentals?",
                    "Do new or escalated risks change valuation assumptions, cost of capital, or scenario weights?",
                    "How do margins and capital allocation compare with direct competitors over the same period?",
                ]
            ),
        ]
    )


def _financial_summary(analysis: dict, comparisons: list[dict]) -> str:
    if not analysis.get("metrics"):
        return "No named financial metrics were extracted with high enough confidence."
    lines = []
    for metric in analysis["metrics"][:8]:
        lines.append(f"- {metric['name']}: {metric['raw_value']} ({metric.get('period') or 'period not detected'})")
    for row in comparisons:
        if row.get("change_pct") is not None:
            lines.append(f"- {row['metric']} comparison: {row['change_pct']:.1f}%")
    return "\n".join(lines)


def _find_metric(analysis: dict, name: str) -> dict | None:
    return next((metric for metric in analysis.get("metrics", []) if metric["name"] == name), None)


def _bullets(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items)


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
