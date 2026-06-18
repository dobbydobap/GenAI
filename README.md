# AI Financial Document Analyst

Production-grade, dependency-light financial filing analyst for Assignment 12. It ingests annual reports, 10-K/10-Q filings, and transcripts; extracts core metrics; compares periods; analyzes management tone; classifies risks; benchmarks multiple companies; and generates an investment memo.

## Run

```bash
python3 -m finanalyst.server 8000
```

Open `http://127.0.0.1:8000`.

## GenAI API Mode

The app runs without an API key, but for the GenAI course version you should enable the model-backed analyst layer. Gemini is supported directly:

```bash
export GEMINI_API_KEY="your_gemini_api_key_here"
export GEMINI_MODEL="gemini-3.5-flash"
python3 -m finanalyst.server 8000
```

You can also use a local `.env` file. Copy `.env.example` to `.env`, replace the placeholder key, and run the server normally. The real `.env` file is ignored by git.

OpenAI is also supported:

```bash
export OPENAI_API_KEY="your_api_key_here"
export OPENAI_MODEL="gpt-5.5"
python3 -m finanalyst.server 8000
```

If both keys are present, Gemini is used by default. Override with:

```bash
export AI_PROVIDER="gemini"  # or "openai"
```

With a model API key, the pipeline is:

1. Extract text from PDF/HTML/TXT.
2. Run deterministic financial/risk/tone extraction for traceable baseline facts.
3. Send the extracted facts and filing excerpts to Gemini or OpenAI.
4. Ask the model for strict structured JSON containing validated metrics, tone assessment, risk assessment, bull case, bear case, questions, and investment memo.
5. Display the model memo while preserving the rule-based memo for auditability.

Environment variables:

- `OPENAI_API_KEY`: required for model-backed mode.
- `OPENAI_MODEL`: optional, defaults to `gpt-5.5`.
- `OPENAI_REASONING_EFFORT`: optional, defaults to `low`.
- `OPENAI_TIMEOUT`: optional request timeout in seconds, defaults to `60`.
- `GEMINI_API_KEY`: required for Gemini-backed mode.
- `GEMINI_MODEL`: optional, defaults to `gemini-3.5-flash`.
- `GEMINI_THINKING_LEVEL`: optional, defaults to `low`.
- `GEMINI_TIMEOUT`: optional request timeout in seconds, defaults to `60`.
- `AI_PROVIDER`: optional provider override, `gemini` or `openai`.

## Test

```bash
python3 -m unittest discover -s tests
```

## Design

- `finanalyst/pdf_text.py`: text extraction for plain text, HTML, optional `pdftotext`, and an internal Flate stream PDF decoder.
- `finanalyst/genai.py`: optional Gemini/OpenAI API enrichment with structured JSON output.
- `finanalyst/sections.py`: financials, MD&A, risk, and guidance section routing.
- `finanalyst/metrics.py`: revenue, EBITDA, margin, cash flow, debt, capex, guidance, and net income extraction.
- `finanalyst/tone.py`: sentiment, confidence, hedging, and tone-shift analysis.
- `finanalyst/risks.py`: risk factor extraction, category classification, and new/escalated risk comparison.
- `finanalyst/memo.py`: structured investment memo grounded in extracted data.
- `finanalyst/server.py`: standard-library HTTP API and web UI.

## API

- `GET /api/sample`: analyze the included sample 10-K.
- `POST /api/analyze`: multipart upload field `documents`, one or more files.
- `GET /api/health`: health check.

## Notes

For best PDF support, install PyMuPDF:

```bash
pip install pymupdf
```

The PDF extraction pipeline tries three methods in order:

1. **PyMuPDF** (`pip install pymupdf`) — highest quality, handles virtually all PDFs.
2. **pdftotext** (install `poppler-utils`) — good layout-preserving fallback.
3. **Internal Flate stream decoder** — zero-dependency last resort for Chromium/Skia PDFs.

Without PyMuPDF, only the sample Chromium/Skia PDF and plain-text/HTML filings are reliably supported. Scanned PDFs should be OCRed before ingestion regardless of extractor.
