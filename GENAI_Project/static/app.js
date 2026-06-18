/* ===== State ===== */
const state = { result: null };

/* ===== DOM refs ===== */
const statusEl = document.querySelector("#status");
const statusDot = document.querySelector("#statusDot");
const loadingBar = document.querySelector("#loadingBar");
const form = document.querySelector("#uploadForm");
const input = document.querySelector("#documents");
const fileList = document.querySelector("#fileList");
const sampleButton = document.querySelector("#sampleButton");
const emptyState = document.querySelector("#emptyState");
const dropzoneLabel = document.querySelector("#dropzoneLabel");

/* ===== Drag & Drop ===== */
dropzoneLabel.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzoneLabel.classList.add("drag-over");
});
dropzoneLabel.addEventListener("dragleave", () => dropzoneLabel.classList.remove("drag-over"));
dropzoneLabel.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzoneLabel.classList.remove("drag-over");
  if (e.dataTransfer.files.length) {
    input.files = e.dataTransfer.files;
    input.dispatchEvent(new Event("change"));
  }
});

input.addEventListener("change", () => {
  const names = [...input.files].map((f) => f.name);
  fileList.textContent = names.length ? names.join(", ") : "PDF, HTML, TXT, MD, or CSV";
});

/* ===== Tab Navigation ===== */
document.querySelectorAll(".nav-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    const target = document.querySelector(`#${btn.dataset.tab}`);
    if (target) target.classList.add("active");
    emptyState.classList.add("hidden");
  });
});

/* ===== Form Submission ===== */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!input.files.length) {
    setStatus("Choose at least one filing or transcript.", "error");
    return;
  }
  const data = new FormData(form);
  await runAnalysis(() => fetch("/api/analyze", { method: "POST", body: data }));
});

sampleButton.addEventListener("click", async () => {
  await runAnalysis(() => fetch("/api/sample"));
});

/* ===== Analysis Runner ===== */
async function runAnalysis(fetcher) {
  setBusy(true);
  setStatus("Analyzing documents\u2026", "busy");
  try {
    const response = await fetcher();
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Analysis failed");
    state.result = payload.documents ? payload : { documents: [payload], benchmark: null };
    render(state.result);
    setStatus("Analysis complete", "ok");
    // Activate summary tab
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    document.querySelector("#tab-summary").classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.querySelector("#summary").classList.add("active");
    emptyState.classList.add("hidden");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  document.querySelectorAll("button").forEach((b) => (b.disabled = busy));
  loadingBar.classList.toggle("active", busy);
}

function setStatus(msg, type = "ok") {
  statusEl.textContent = msg;
  statusDot.className = "status-indicator" + (type === "busy" ? " busy" : type === "error" ? " error" : "");
}

/* ===== Render ===== */
function render(result) {
  const doc = result.documents[result.documents.length - 1];
  renderSummary(result, doc);
  renderMetrics(doc);
  renderTone(doc);
  renderRisks(doc);
  renderBenchmark(result, doc);
  renderMemo(doc);
}

/* ===== Summary ===== */
function renderSummary(result, doc) {
  const mode = doc.analysis_mode === "openai" ? providerName(doc.genai) : "Rule-based";
  document.querySelector("#summary").innerHTML = `
    <h1 class="section-title">Analysis Summary</h1>
    <div class="kpi-grid">
      ${kpi("Company", doc.company, "accent")}
      ${kpi("Metrics Found", doc.metrics.length, "sky")}
      ${kpi("Risk Factors", doc.risks.length, "amber")}
      ${kpi("Confidence", Math.round(doc.extraction.confidence * 100) + "%", "green")}
      ${kpi("Analysis Mode", mode, "purple")}
    </div>
    <div class="card">
      <div class="card-header"><h2>Document Profile</h2></div>
      <table class="profile-table">
        <tbody>
          <tr><td>File</td><td>${esc(doc.filename)}</td></tr>
          <tr><td>Extractor</td><td><span class="pill">${esc(doc.extraction.method)}</span></td></tr>
          <tr><td>Characters</td><td>${fmtNum(doc.extraction.characters)}</td></tr>
          <tr><td>Provider</td><td>${doc.genai?.provider ? esc(providerName(doc.genai)) : "Offline"}</td></tr>
          <tr><td>Model</td><td>${doc.genai?.enabled ? esc(doc.genai.model || "Model") : "Not configured"}</td></tr>
          <tr><td>Model Status</td><td>${esc(doc.genai?.error || (doc.genai?.data ? "Model analysis complete" : "Rule-based analysis"))}</td></tr>
          <tr><td>Warnings</td><td>${doc.extraction.warnings.map(esc).join("<br>") || '<span style="color:var(--green)">None</span>'}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

/* ===== Metrics ===== */
function renderMetrics(doc) {
  // Group metrics by name for a cleaner presentation
  const grouped = {};
  doc.metrics.forEach((m) => {
    if (!grouped[m.name]) grouped[m.name] = [];
    grouped[m.name].push(m);
  });

  const modelMetrics = doc.genai?.data?.validated_metrics;

  document.querySelector("#metrics").innerHTML = `
    <h1 class="section-title">Financial Metrics</h1>
    <p class="section-subtitle">Extracted from financial statements and narrative disclosures</p>
    ${modelMetrics ? `
      <div class="card" style="border-color: rgba(99,102,241,0.3);">
        <div class="card-header"><h2>\u2728 Model-Validated Metrics</h2></div>
        <div class="comparison-table">
        <table>
          <thead><tr><th>Metric</th><th>Value</th><th>Period</th><th>Confidence</th><th>Evidence</th></tr></thead>
          <tbody>
            ${modelMetrics.map((m) => `
              <tr>
                <td><strong>${esc(m.name)}</strong></td>
                <td>${esc(m.value)}</td>
                <td>${esc(m.period)}</td>
                <td><span class="pill ${m.confidence === "high" ? "green" : m.confidence === "medium" ? "amber" : "red"}">${esc(m.confidence)}</span></td>
                <td class="excerpt">${esc(m.evidence)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        </div>
      </div>` : ""}
    <div class="card">
      <div class="card-header"><h2>Rule-Based Extraction</h2></div>
      <div class="comparison-table">
      <table>
        <thead><tr><th>Metric</th><th>Raw Value</th><th>Computed</th><th>Period</th><th>Context</th></tr></thead>
        <tbody>
          ${doc.metrics.map((m) => `
            <tr>
              <td><strong>${esc(m.name)}</strong></td>
              <td>${esc(m.raw_value)}</td>
              <td style="color:var(--green);font-weight:600">${fmtVal(m.value, m.unit)}</td>
              <td>${esc(m.period || "N/A")}</td>
              <td class="excerpt">${esc(m.context.substring(0, 200))}</td>
            </tr>
          `).join("") || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No metrics extracted</td></tr>'}
        </tbody>
      </table>
      </div>
    </div>
  `;
}

/* ===== Tone ===== */
function renderTone(doc) {
  const t = doc.tone;
  const gaugeWidth = Math.min(100, Math.max(5, 50 + t.score * 5));

  document.querySelector("#tone").innerHTML = `
    <h1 class="section-title">Management Tone Analysis</h1>
    <p class="section-subtitle">Sentiment, confidence, and hedging patterns in management commentary</p>

    <div class="tone-gauge">
      <span class="pill ${t.label}">${t.label}</span>
      <div class="gauge-bar">
        <div class="gauge-fill ${t.label}" style="width:${gaugeWidth}%"></div>
      </div>
      <span style="font-weight:700;font-size:1.1rem;color:var(--text-primary)">${t.score}</span>
    </div>

    <div class="kpi-grid">
      ${kpi("Confidence Terms", t.confidence_terms, "green")}
      ${kpi("Caution Terms", t.caution_terms, "red")}
      ${kpi("Hedging Terms", t.hedging_terms, "amber")}
      ${kpi("Hedging Rate", t.hedging_rate + "%", "sky")}
      ${t.tone_shift ? kpi("Tone Shift", t.tone_shift, t.tone_shift === "more cautious" ? "red" : t.tone_shift === "more confident" ? "green" : "sky") : kpi("Prior Comparison", "N/A", "")}
    </div>

    <div class="card">
      <div class="card-header"><h2>Flagged Passages</h2></div>
      <div class="stack">
        ${t.flagged_passages.map((p) => `
          <div class="passage-item">
            <span class="pill ${p.tone}">${p.tone}</span>
            <p class="excerpt" style="margin-top:8px">${esc(p.passage)}</p>
          </div>
        `).join("") || '<p class="excerpt">No flagged passages</p>'}
      </div>
    </div>
  `;
}

/* ===== Risks ===== */
function renderRisks(doc) {
  // Group by category
  const cats = {};
  doc.risks.forEach((r) => {
    if (!cats[r.category]) cats[r.category] = [];
    cats[r.category].push(r);
  });

  document.querySelector("#risks").innerHTML = `
    <h1 class="section-title">Risk Factor Analysis</h1>
    <p class="section-subtitle">${doc.risks.length} risk passages extracted and classified</p>

    <div class="kpi-grid" style="margin-bottom:20px">
      ${Object.entries(cats).map(([cat, items]) =>
        kpi(cat.charAt(0).toUpperCase() + cat.slice(1), items.length, items.some((r) => r.severity === "high") ? "red" : "amber")
      ).join("")}
    </div>

    <div class="stack">
      ${doc.risks.map((r) => `
        <div class="risk-item">
          <h3>${esc(r.title)}</h3>
          <div class="risk-pills">
            <span class="pill">${esc(r.category)}</span>
            <span class="pill ${r.severity}">${esc(r.severity)}</span>
          </div>
          <p class="excerpt">${esc(r.excerpt)}</p>
        </div>
      `).join("") || '<p class="excerpt">No risk passages extracted.</p>'}
    </div>
    
    ${doc.risk_comparison && (doc.risk_comparison.new?.length || doc.risk_comparison.escalated?.length) ? `
      <div class="card" style="margin-top:20px">
        <div class="card-header"><h2>\u26A0\uFE0F Risk Comparison vs Prior Period</h2></div>
        <div class="stack" style="margin-top:12px">
          ${doc.risk_comparison.new?.map(r => `
            <div class="comparison-row">
              <span class="pill red">NEW</span>
              <strong>${esc(r.title)}</strong>
              <span class="excerpt">${esc(r.excerpt)}</span>
            </div>
          `).join("") || ""}
          ${doc.risk_comparison.escalated?.map(r => `
            <div class="comparison-row">
              <span class="pill amber">ESCALATED</span>
              <strong>${esc(r.title)}</strong>
              <span class="excerpt">${esc(r.excerpt)}</span>
            </div>
          `).join("") || ""}
        </div>
      </div>
    ` : ""}
  `;
}

/* ===== Benchmark ===== */
function renderBenchmark(result, doc) {
  const bm = result.benchmark || [];
  const docs = result.documents || [];

  let html = "";

  if (!bm.length && docs.length <= 1) {
    // Single document — generate self-benchmark from metrics
    if (!doc) {
      document.querySelector("#benchmark").innerHTML = `
        <h1 class="section-title">Competitor Benchmarking</h1>
        <p class="section-subtitle">Upload multiple filings to compare companies side-by-side</p>
        <div class="card"><p class="excerpt">Upload 2+ filings to enable cross-company benchmarking, or view the single-company profile below.</p></div>
      `;
      return;
    }

    const metrics = doc.metrics || [];
    const byName = {};
    metrics.forEach((m) => { if (!byName[m.name]) byName[m.name] = m; });

    document.querySelector("#benchmark").innerHTML = `
      <h1 class="section-title">Company Profile &mdash; ${esc(doc.company)}</h1>
      <p class="section-subtitle">Key financial metrics at a glance. Upload multiple filings to compare companies.</p>

      <div class="benchmark-grid">
        <div class="benchmark-company-card">
          <div class="benchmark-company-name">${esc(doc.company)}</div>
          <div class="benchmark-scale">${esc(doc.filename)}</div>
          <div class="benchmark-metrics-grid">
            ${bmMetric("Revenue", fmtVal(byName["Revenue"]?.value, "USD"))}
            ${bmMetric("Net Income", fmtVal(byName["Net Income"]?.value, "USD"))}
            ${bmMetric("Op. Income", fmtVal(byName["Operating Income"]?.value, "USD"))}
            ${bmMetric("Cash Flow", fmtVal(byName["Cash Flow"]?.value, "USD"))}
            ${bmMetric("Total Debt", fmtVal(byName["Debt"]?.value, "USD"))}
            ${bmMetric("Total Assets", fmtVal(byName["Total Assets"]?.value, "USD"))}
            ${bmMetric("Capex", fmtVal(byName["Capex"]?.value, "USD"))}
            ${bmMetric("Equity", fmtVal(byName["Shareholders Equity"]?.value, "USD"))}
          </div>
          <div class="benchmark-footer">
            <span class="pill">${esc(doc.tone?.label || "n/a")}</span>
            <span class="pill">${doc.risks?.length || 0} risks</span>
          </div>
        </div>
      </div>

      ${doc.metric_comparison?.length ? `
        <div class="card" style="margin-top:16px">
          <div class="card-header"><h2>Period Comparison</h2></div>
          <div class="comparison-table">
          <table>
            <thead><tr><th>Metric</th><th>Current</th><th>Prior</th><th>Change</th></tr></thead>
            <tbody>
              ${doc.metric_comparison.filter((r) => r.change_pct !== null).map((r) => `
                <tr>
                  <td><strong>${esc(r.metric)}</strong></td>
                  <td>${fmtVal(r.current, "USD")}</td>
                  <td>${fmtVal(r.prior, "USD")}</td>
                  <td style="color:${r.change_pct >= 0 ? "var(--green)" : "var(--red)"};font-weight:700">${r.change_pct >= 0 ? "+" : ""}${r.change_pct.toFixed(1)}%</td>
                </tr>
              `).join("") || '<tr><td colspan="4" class="excerpt">No comparison data</td></tr>'}
            </tbody>
          </table>
          </div>
        </div>
      ` : ""}
    `;
  } else {
    // Multi-company benchmark
    html += `
      <h1 class="section-title">Competitor Benchmarking</h1>
      <p class="section-subtitle">Comparative analysis across ${bm.length} companies on key metrics, margins, and capital allocation</p>

    <!-- Summary comparison table -->
    <div class="card">
      <div class="card-header"><h2>Head-to-Head Comparison</h2></div>
      <div class="comparison-table">
      <table>
        <thead>
          <tr>
            <th>Company</th><th>Revenue</th><th>Net Income</th><th>Gross Margin</th><th>Op. Margin</th>
            <th>NI Margin</th><th>CF Margin</th><th>D/E</th><th>ROA</th><th>Strategy</th>
          </tr>
        </thead>
        <tbody>
          ${bm.map((r) => `
            <tr>
              <td><strong>${esc(r.company)}</strong><br><span class="excerpt">${esc(r.revenue_scale || "")}</span></td>
              <td>${fmtVal(r.revenue, "USD")}</td>
              <td>${fmtVal(r.net_income, "USD")}</td>
              <td>${fmtPct(r.gross_margin)}</td>
              <td>${fmtPct(r.operating_margin)}</td>
              <td>${fmtPct(r.net_income_margin)}</td>
              <td>${fmtPct(r.cash_flow_margin)}</td>
              <td>${fmtPct(r.debt_to_equity)}</td>
              <td>${fmtPct(r.return_on_assets)}</td>
              <td><span class="pill">${esc(r.capital_allocation)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      </div>
    </div>

    <!-- Company cards -->
    <div class="benchmark-grid" style="margin-top:16px">
      ${bm.map((r) => `
        <div class="benchmark-company-card">
          <div class="benchmark-company-name">${esc(r.company)}</div>
          <div class="benchmark-scale">${esc(r.revenue_scale || "")}</div>
          <div class="benchmark-metrics-grid">
            ${bmMetric("Revenue", fmtVal(r.revenue, "USD"))}
            ${bmMetric("Net Income", fmtVal(r.net_income, "USD"))}
            ${bmMetric("Gross Margin", fmtPct(r.gross_margin))}
            ${bmMetric("Op. Margin", fmtPct(r.operating_margin))}
            ${bmMetric("NI Margin", fmtPct(r.net_income_margin))}
            ${bmMetric("CF Margin", fmtPct(r.cash_flow_margin))}
            ${bmMetric("D/E Ratio", fmtPct(r.debt_to_equity))}
            ${bmMetric("Capex Int.", fmtPct(r.capex_intensity))}
          </div>
          <div class="benchmark-footer">
            <span class="pill ${r.tone_label === "cautious" ? "cautious" : r.tone_label === "confident" ? "confident" : ""}">${esc(r.tone_label)}</span>
            <span class="pill">${r.risk_count} risks</span>
            <span class="pill purple">${esc(r.capital_allocation)}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
  }

  // Always append period comparison at the bottom if available (for both single and multi-file scenarios)
  if (doc?.metric_comparison?.length) {
    html += `
      <div class="card" style="margin-top:16px">
        <div class="card-header"><h2>Period Comparison (Latest vs Prior)</h2></div>
        <div class="comparison-table">
        <table>
          <thead><tr><th>Metric</th><th>Current</th><th>Prior</th><th>Change</th></tr></thead>
          <tbody>
            ${doc.metric_comparison.filter((r) => r.change_pct !== null).map((r) => `
              <tr>
                <td><strong>${esc(r.metric)}</strong></td>
                <td>${fmtVal(r.current, "USD")}</td>
                <td>${fmtVal(r.prior, "USD")}</td>
                <td style="color:${r.change_pct >= 0 ? "var(--green)" : "var(--red)"};font-weight:700">${r.change_pct >= 0 ? "+" : ""}${r.change_pct.toFixed(1)}%</td>
              </tr>
            `).join("") || '<tr><td colspan="4" class="excerpt">No comparison data</td></tr>'}
          </tbody>
        </table>
        </div>
      </div>
    `;
  }
  
  document.querySelector("#benchmark").innerHTML = html;
}

/* ===== Memo ===== */
function renderMemo(doc) {
  const memoText = doc.memo || "No memo generated.";
  // Simple markdown-like rendering
  const rendered = memoText
    .replace(/^# (.+)$/gm, '<h1 style="font-size:1.3rem;font-weight:800;margin:16px 0 8px;color:var(--text-primary);font-family:var(--font-sans)">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:1.05rem;font-weight:700;margin:14px 0 6px;color:var(--accent-light);font-family:var(--font-sans)">$1</h2>')
    .replace(/^- (.+)$/gm, '<div style="padding:4px 0 4px 16px;border-left:2px solid var(--accent);margin:4px 0;color:var(--text-secondary)">$1</div>');

  document.querySelector("#memo").innerHTML = `
    <h1 class="section-title">Investment Memo</h1>
    <p class="section-subtitle">AI-synthesized investment thesis based on extracted data</p>
    <div class="card">
      <div class="memo-content">${rendered}</div>
    </div>
    ${doc.rule_based_memo ? `
      <div class="card" style="margin-top:16px;opacity:0.75">
        <div class="card-header"><h2>Rule-Based Memo (Audit Trail)</h2></div>
        <div class="memo-content" style="font-size:0.78rem">${esc(doc.rule_based_memo)}</div>
      </div>
    ` : ""}
  `;
}

/* ===== Helpers ===== */
function kpi(label, value, color = "") {
  return `<div class="kpi-card"><span class="kpi-label">${esc(label)}</span><span class="kpi-value ${color}">${typeof value === "string" ? value : esc(String(value))}</span></div>`;
}

function bmMetric(label, value) {
  return `<div class="bm-metric"><span class="bm-metric-label">${esc(label)}</span><span class="bm-metric-value">${value}</span></div>`;
}

function fmtVal(value, unit) {
  if (value === null || value === undefined) return '<span style="color:var(--text-muted)">n/a</span>';
  if (unit === "%") return `${value.toFixed(1)}%`;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${fmtNum(abs)}`;
}

function fmtPct(value) {
  if (value === null || value === undefined) return '<span style="color:var(--text-muted)">n/a</span>';
  const color = value >= 0 ? "var(--green)" : "var(--red)";
  return `<span style="color:${color};font-weight:600">${value.toFixed(1)}%</span>`;
}

function fmtNum(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function providerName(genai) {
  if (!genai?.provider) return "Model";
  return genai.provider === "gemini" ? "Gemini" : "OpenAI";
}

/* ===== Auto-load sample ===== */
runAnalysis(() => fetch("/api/sample"));
