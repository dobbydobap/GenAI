/* ===== State ===== */
const state = { result: null };

/* ===== DOM refs ===== */
const statusEl = document.querySelector("#status");
const statusDot = document.querySelector("#statusDot");
const loadingBar = document.querySelector("#loadingBar");
const form = document.querySelector("#uploadForm");
const input = document.querySelector("#documents");
const activeFileEl = document.querySelector("#activeFile");
const addFilingBtn = document.querySelector("#addFilingBtn");

/* ===== Form Triggers ===== */
if (addFilingBtn) {
  addFilingBtn.addEventListener("click", () => {
    input.click();
  });
}

input.addEventListener("change", () => {
  const files = [...input.files];
  if (!files.length) {
    if (activeFileEl) activeFileEl.textContent = "No filing selected";
    return;
  }
  // Just show the first file name for the topbar, could expand logic if multiple
  if (activeFileEl) activeFileEl.textContent = files[0].name + (files.length > 1 ? ` (+${files.length - 1})` : "");
  // Automatically submit when files are selected
  form.dispatchEvent(new Event("submit"));
});

/* ===== Tab Navigation ===== */
document.querySelectorAll(".nav-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    const target = document.querySelector(`#${btn.dataset.tab}`);
    if (target) target.classList.add("active");
    
    // Hide empty state if present
    const empty = document.querySelector(".empty-state");
    if (empty) empty.classList.add("hidden");
  });
});

/* ===== Form Submission ===== */
document.querySelector("#analyzeBtn").addEventListener("click", () => form.dispatchEvent(new Event("submit")));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!input.files.length) {
    setStatus("Choose a filing first.", "error");
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
    const tabSummary = document.querySelector("#tab-summary");
    if (tabSummary) tabSummary.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    const viewSummary = document.querySelector("#summary");
    if (viewSummary) viewSummary.classList.add("active");
    
    // Remove global empty state
    const emptyContainer = document.querySelector("#globalEmptyState");
    if (emptyContainer) emptyContainer.remove();

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
  statusDot.className = "status-dot" + (type === "busy" ? " busy" : type === "error" ? " error" : " ok");
  const banner = document.querySelector("#statusBox");
  banner.className = "status-chip" + (type === "busy" ? " busy" : type === "error" ? " error" : " ok");
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
  const metrics = doc.metrics || [];
  const byName = {};
  metrics.forEach((m) => { if (!byName[m.name]) byName[m.name] = m; });

  const toneLabel = doc.tone?.label || "N/A";
  const risksCount = doc.risks?.length || 0;
  
  // Specific style logic requested by user
  const isConfident = toneLabel.toLowerCase() === "confident";
  const toneChipClass = isConfident ? "chip-success" : (toneLabel.toLowerCase() === "cautious" ? "chip-danger" : "chip-neutral");
  const riskChipClass = risksCount > 0 ? "chip-warning" : "chip-neutral";

  document.querySelector("#summary").innerHTML = `
    <div class="card-elevated">
      <div class="profile-header">
        <div class="profile-title-group">
          <div class="profile-company-name">${esc(doc.company)}</div>
          <div class="profile-filename">${esc(doc.filename)}</div>
        </div>
        <div class="profile-chips">
          <span class="chip ${toneChipClass}">${esc(toneLabel.toUpperCase())}</span>
          <span class="chip ${riskChipClass}">${risksCount} RISKS</span>
        </div>
      </div>
      
      <div class="profile-divider"></div>
      
      <div class="metrics-grid">
        ${renderTextMetric("Document Type", "SEC Filing")}
        ${renderTextMetric("Extracted Metrics", metrics.length)}
        ${renderTextMetric("Characters", fmtNum(doc.extraction?.characters))}
        ${renderTextMetric("Confidence", Math.round((doc.extraction?.confidence || 0) * 100) + "%")}
        ${renderTextMetric("Analysis Mode", doc.analysis_mode === "openai" ? "Model-backed" : "Rule-based")}
        ${renderTextMetric("Provider", doc.genai?.provider ? providerName(doc.genai) : "Offline")}
        ${renderTextMetric("Model", doc.genai?.enabled ? (doc.genai.model || "Model") : "None")}
        ${renderTextMetric("Warnings", doc.extraction?.warnings?.length || "None")}
      </div>
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
        <div class="page-header">
          <div class="breadcrumb">FinSight AI <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg> Benchmarking</div>
          <h1 class="page-title">Competitor Benchmarking</h1>
        </div>
        <div class="empty-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
          <p>Upload 2+ filings to enable cross-company benchmarking.</p>
        </div>
      `;
      return;
    }

    const metrics = doc.metrics || [];
    const byName = {};
    metrics.forEach((m) => { if (!byName[m.name]) byName[m.name] = m; });

    html += `
      <div class="page-header">
        <div class="breadcrumb">FinSight AI <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg> Profile</div>
        <h1 class="page-title">Company Profile</h1>
      </div>

      <div class="card card-elevated">
        <div class="profile-header">
          <div class="profile-company-name">${esc(doc.company)}</div>
          <div class="profile-filename">${esc(doc.filename)}</div>
        </div>
        
        <div class="metrics-table">
          ${bmMetric("Revenue", fmtVal(byName["Revenue"]?.value, "USD"))}
          ${bmMetric("Net Income", fmtVal(byName["Net Income"]?.value, "USD"))}
          ${bmMetric("Op. Income", fmtVal(byName["Operating Income"]?.value, "USD"))}
          ${bmMetric("Cash Flow", fmtVal(byName["Cash Flow"]?.value, "USD"))}
          ${bmMetric("Total Debt", fmtVal(byName["Debt"]?.value, "USD"))}
          ${bmMetric("Total Assets", fmtVal(byName["Total Assets"]?.value, "USD"))}
          ${bmMetric("Capex", fmtVal(byName["Capex"]?.value, "USD"))}
          ${bmMetric("Equity", fmtVal(byName["Shareholders Equity"]?.value, "USD"))}
        </div>
        
        <div class="status-chips">
          <span class="chip ${doc.tone?.label === 'confident' ? 'chip-success' : doc.tone?.label === 'cautious' ? 'chip-danger' : 'chip-neutral'}">${esc(doc.tone?.label || "N/A")}</span>
          <span class="chip ${doc.risks?.length > 0 ? 'chip-warning' : 'chip-neutral'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            ${doc.risks?.length || 0} RISKS
          </span>
        </div>
      </div>
      
      <div class="empty-placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
        <p style="color:var(--text-primary);font-weight:500;margin-bottom:4px;">Ready to Compare</p>
        <p>Upload multiple filings to benchmark competitors side-by-side.</p>
      </div>
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
function kpi(label, value, color) {
  return `
    <div class="kpi-card">
      <div class="metric-label">${esc(label)}</div>
      <div class="metric-value ${color}">${esc(value)}</div>
    </div>
  `;
}

function renderProfileMetric(label, value, unit) {
  const formatted = fmtVal(value, unit);
  const isNa = formatted.includes("n/a");
  return `
    <div class="metric-cell">
      <div class="metric-cell-label">${esc(label)}</div>
      <div class="metric-cell-value ${isNa ? 'muted-value' : ''}">${formatted}</div>
    </div>
  `;
}

function renderTextMetric(label, value) {
  const formatted = value === null || value === undefined || value === "N/A" || value === "" ? "n/a" : esc(String(value));
  const isNa = formatted === "n/a";
  return `
    <div class="metric-cell">
      <div class="metric-cell-label">${esc(label)}</div>
      <div class="metric-cell-value ${isNa ? 'muted-value' : ''}" style="font-size:1.1rem; letter-spacing:0">${formatted}</div>
    </div>
  `;
}

function bmMetric(label, value) {
  const isNa = value === "n/a" || String(value).includes("n/a");
  return `
    <div class="metrics-row">
      <div class="metric-label">${esc(label)}</div>
      <div class="metric-value ${isNa ? 'muted-value' : ''}">${value}</div>
    </div>
  `;
}

function fmtVal(value, unit) {
  if (value === null || value === undefined) return '<span class="muted-value">n/a</span>';
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
  if (value === null || value === undefined) return '<span class="muted-value">n/a</span>';
  const color = value >= 0 ? "var(--success)" : "var(--danger)";
  return `<span style="color:${color};font-weight:500">${value.toFixed(1)}%</span>`;
}

function fmtNum(value) {
  if (!value) return "0";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function providerName(genai) {
  if (!genai || !genai.provider) return "Unknown";
  const p = genai.provider;
  if (p === "openai") return "OpenAI";
  if (p === "anthropic") return "Anthropic";
  if (p === "gemini" || p === "google") return "Google Gemini";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ===== No Auto-load ===== */
// We removed the auto-load sample logic so the global empty state remains visible.
