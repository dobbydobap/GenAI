import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from finanalyst.analyzer import analyze_document
from finanalyst.genai import enrich_analysis
from finanalyst.metrics import extract_metrics
from finanalyst.risks import compare_risks, extract_risks
from finanalyst.tone import analyze_tone


ROOT = Path(__file__).resolve().parents[1]


class AnalysisTests(unittest.TestCase):
    def test_tone_identifies_cautious_vs_confident(self):
        cautious = "We may experience significant uncertainty, adverse demand, and material disruption."
        confident = "We delivered strong record growth and remain confident in robust opportunities."

        self.assertEqual(analyze_tone(cautious)["label"], "cautious")
        self.assertEqual(analyze_tone(confident)["label"], "confident")

    def test_metric_extraction_named_figures(self):
        text = """
        Revenue was $12.4 billion in fiscal 2025. EBITDA was $2.1 billion.
        Operating margin was 18.5%. Capital expenditures were $800 million.
        Total debt was $3.0 billion.
        """
        metrics = extract_metrics(text)
        names = {metric.name for metric in metrics}

        self.assertIn("Revenue", names)
        self.assertIn("EBITDA", names)
        self.assertIn("Operating Margin", names)
        self.assertIn("Debt", names)
        self.assertIn("Capex", names)

    def test_risk_comparison_flags_new_risk(self):
        prior = extract_risks("Competition could adversely affect pricing and demand.")
        current = extract_risks(
            "Competition could adversely affect pricing and demand. "
            "A cyber security incident could materially disrupt our operations and data systems."
        )

        comparison = compare_risks(current, prior)
        self.assertTrue(comparison["new"])
        self.assertEqual(comparison["new"][0]["category"], "technology")

    def test_sample_pdf_pipeline(self):
        result = analyze_document(ROOT / "0000936468-21-000013.pdf")

        self.assertGreater(result["extraction"]["characters"], 1000)
        self.assertIn("memo", result)
        self.assertIn("genai", result)
        self.assertIsInstance(result["metrics"], list)
        self.assertIsInstance(result["risks"], list)

    def test_genai_layer_is_optional_without_api_key(self):
        with patch.dict("os.environ", {}, clear=True):
            result = enrich_analysis({"company": "Example"}, "Revenue was $10 million.")

        self.assertFalse(result.enabled)
        self.assertIn("GEMINI_API_KEY", result.error)

    def test_genai_selects_gemini_key(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}, clear=True), patch(
            "urllib.request.urlopen", side_effect=urllib.error.URLError("blocked")
        ):
            result = enrich_analysis({"company": "Example"}, "Revenue was $10 million.")

        self.assertTrue(result.enabled)
        self.assertEqual(result.provider, "gemini")


if __name__ == "__main__":
    unittest.main()
