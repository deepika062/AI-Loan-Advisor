// public/app.js — front-end logic for the LoanWise advisor.
const $ = (id) => document.getElementById(id);
let TOKEN = null;
let LATEST_FACTS = null; // last computed authoritative facts (for download)

const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN');

// ---- Sign in ---------------------------------------------------------------

async function loadDemoUsers() {
  try {
    const { users } = await (await fetch('/api/demo-users')).json();
    const sel = $('demoUsers');
    sel.innerHTML = '<option value="">— pick a demo user —</option>' +
      users.map((u) => `<option value="${u.token}">${u.name}</option>`).join('');
    sel.onchange = () => { if (sel.value) $('token').value = sel.value; };
  } catch { /* ignore */ }
}

async function authedFetch(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

$('loginBtn').onclick = async () => {
  const token = $('token').value.trim();
  const msg = $('loginMsg');
  if (!token) { msg.className = 'msg err'; msg.textContent = 'Enter a token.'; return; }
  TOKEN = token;
  try {
    const me = await authedFetch('/api/me/profile');
    msg.className = 'msg ok'; msg.textContent = `Signed in as ${me.name}.`;
    $('who').textContent = `${me.name} · ${me.userId}`;
    prefillProfile(me.profile);
    $('profileCard').classList.remove('hidden');
    $('loginCard').querySelector('h2').textContent = '1 · Signed in ✓';
  } catch (e) {
    TOKEN = null; msg.className = 'msg err'; msg.textContent = e.message;
  }
};

function prefillProfile(p) {
  if (p.monthlyIncome != null) $('income').value = p.monthlyIncome;
  if (p.existingEmi != null) $('existingEmi').value = p.existingEmi;
  if (p.employmentType) $('employment').value = p.employmentType;
  if (p.riskProfile) $('risk').value = p.riskProfile;
  $('hasCollateral').checked = !!p.hasCollateral;
  $('hasExistingLoan').checked = !!p.hasExistingLoan;
}

function collectRequest() {
  return {
    amount: Number($('amount').value),
    purpose: $('purpose').value,
    preferredTenureMonths: Number($('tenure').value),
    monthlyIncome: Number($('income').value),
    existingEmi: Number($('existingEmi').value),
    employmentType: $('employment').value,
    riskProfile: $('risk').value,
    hasCollateral: $('hasCollateral').checked,
    hasExistingLoan: $('hasExistingLoan').checked,
  };
}

// ---- Recommendation --------------------------------------------------------

$('recommendBtn').onclick = async () => {
  try {
    const facts = await authedFetch('/api/me/recommend', { method: 'POST', body: JSON.stringify(collectRequest()) });
    renderResults(facts);
    $('resultCard').classList.remove('hidden');
    $('chatCard').classList.remove('hidden');
    seedChat(facts);
  } catch (e) { alert(e.message); }
};

function renderResults(facts) {
  LATEST_FACTS = facts;
  const el = $('results');
  if (!facts.recommendation) {
    el.innerHTML = `<p class="note bad">No product matches this request.</p>` + ineligibleHtml(facts);
    return;
  }
  const cards = facts.eligible.map((p, i) => recCard(p, i === 0)).join('');
  el.innerHTML = cards + tradeoffHtml(facts) + ineligibleHtml(facts);
}

function recCard(p, isTop) {
  const affBadge = p.affordable
    ? '' : `<span class="badge warn">High FOIR ${p.foirPct}%</span>`;
  const tAdj = p.tenureAdjusted ? `<span class="badge">tenure adjusted to ${p.tenureMonths}mo</span>` : '';
  return `<div class="rec ${isTop ? 'top' : ''}">
    <div class="name">${p.name}
      ${isTop ? '<span class="badge best">Best fit</span>' : ''}${affBadge}${tAdj}</div>
    <div class="metrics">
      <div class="metric"><div class="v">${fmt(p.emi)}</div><div class="k">EMI/mo</div></div>
      <div class="metric"><div class="v">${p.offeredRatePct}%</div><div class="k">Rate</div></div>
      <div class="metric"><div class="v">${p.tenureMonths}</div><div class="k">Months</div></div>
      <div class="metric"><div class="v">${fmt(p.totalInterest)}</div><div class="k">Interest</div></div>
    </div>
    <div class="note ${p.affordable ? '' : 'bad'}">${p.affordabilityNote} Total repayment ${fmt(p.totalPayment)}.</div>
    ${isTop ? scheduleHtml(p) : ''}
  </div>`;
}

function scheduleHtml(p) {
  if (!p.schedulePreview || !p.schedulePreview.length) return '';
  const rows = p.schedulePreview.map((s) =>
    `<tr><td>${s.month}</td><td>${fmt(s.principal)}</td><td>${fmt(s.interest)}</td><td>${fmt(s.balance)}</td></tr>`).join('');
  return `<details class="schedule"><summary>View amortization (first ${p.schedulePreview.length} months)</summary>
    <table class="grid"><tr><th>Month</th><th>Principal</th><th>Interest</th><th>Balance</th></tr>${rows}</table>
    <div class="note">Each EMI is part principal, part interest; the interest share falls as the balance reduces.</div>
  </details>`;
}

function tradeoffHtml(facts) {
  const t = facts.tenureTradeoff;
  if (!t) return '';
  return `<div class="note" style="margin:10px 0">
    <b>Tenure trade-off:</b> at ${facts.recommendation.offeredRatePct}%, a ${t.a.tenureMonths}-month plan
    means EMI ${fmt(t.a.emi)} (interest ${fmt(t.a.totalInterest)}), while ${t.b.tenureMonths} months
    lowers EMI to ${fmt(t.b.emi)} but raises interest to ${fmt(t.b.totalInterest)} —
    about ${fmt(Math.abs(t.interestDifference))} more interest for a lower monthly outflow.</div>`;
}

function ineligibleHtml(facts) {
  if (!facts.ineligible.length) return '';
  const items = facts.ineligible.map((p) =>
    `<li><b>${p.name}:</b> ${p.reasons.join(' ')}</li>`).join('');
  return `<div class="ineligible"><details><summary>Why some products were excluded (${facts.ineligible.length})</summary><ul>${items}</ul></details></div>`;
}

// ---- Chat ------------------------------------------------------------------

const LANG_VOICE = { English: 'en-IN', Hindi: 'hi-IN', Spanish: 'es-ES', French: 'fr-FR' };

// ---- Markdown helpers ------------------------------------------------------
// The model replies in Markdown. We render a safe subset for display and strip
// all formatting for speech (so the voice never reads "hash" / "asterisk").

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMd(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function renderMarkdown(text) {
  const lines = escapeHtml(text).split('\n');
  let html = '';
  let i = 0;
  let listOpen = false;
  const closeList = () => { if (listOpen) { html += '</ul>'; listOpen = false; } };

  while (i < lines.length) {
    const line = lines[i];

    // Table: a row with pipes followed by a |---|---| separator row.
    if (/\|/.test(line) && i + 1 < lines.length &&
        /-/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      closeList();
      const header = splitRow(line);
      i += 2;
      let rows = '';
      while (i < lines.length && /\|/.test(lines[i])) {
        const cells = splitRow(lines[i]);
        rows += '<tr>' + cells.map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>';
        i++;
      }
      html += '<table class="md-table"><thead><tr>' +
        header.map((c) => `<th>${inlineMd(c)}</th>`).join('') +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); html += `<div class="md-h">${inlineMd(h[2])}</div>`; i++; continue; }

    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { if (!listOpen) { html += '<ul>'; listOpen = true; } html += `<li>${inlineMd(li[1])}</li>`; i++; continue; }

    if (/^\s*-{3,}\s*$/.test(line)) { closeList(); html += '<hr>'; i++; continue; }
    if (/^\s*$/.test(line)) { closeList(); i++; continue; }

    closeList();
    html += `<p>${inlineMd(line)}</p>`;
    i++;
  }
  closeList();
  return html;
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, ' ') // table separator rows
    .replace(/\|/g, ', ')
    .replace(/[#>*_`]+/g, '')
    .replace(/^\s*[-]\s+/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .trim();
}

function speak(text, language) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(stripMarkdown(text));
  u.lang = LANG_VOICE[language] || 'en-IN';
  window.speechSynthesis.speak(u);
}

function addBubble(text, who, opts = {}) {
  const log = $('chatLog');
  const b = document.createElement('div');
  b.className = `bubble ${who}`;
  const content = document.createElement('div');
  content.className = 'content';
  if (who === 'bot') content.innerHTML = renderMarkdown(text);
  else content.textContent = text;
  b.appendChild(content);
  if (opts.src) {
    const s = document.createElement('div');
    s.className = 'src';
    s.textContent = `via ${opts.src}${opts.language && opts.language !== 'English' ? ' · ' + opts.language : ''}`;
    if (who === 'bot') {
      const sp = document.createElement('button');
      sp.className = 'speakbtn'; sp.textContent = '🔊'; sp.title = 'Read aloud';
      sp.onclick = () => speak(text, opts.language || 'English');
      s.appendChild(sp);
    }
    b.appendChild(s);
  }
  log.appendChild(b);
  log.scrollTop = log.scrollHeight;
  return b;
}

function seedChat(facts) {
  $('chatLog').innerHTML = '';
  const r = facts.recommendation;
  addBubble(
    r ? `Hi! Based on your request I suggest ${r.name} — EMI ${fmt(r.emi)}/mo at ${r.offeredRatePct}% for ${r.tenureMonths} months. Ask me anything about it.`
      : `I couldn't find a matching product for this request. Ask me why, or adjust the inputs.`,
    'bot'
  );
  const suggestions = ['Why this product?', 'What if I pick a longer tenure?', 'Compare my top 2 options', 'Can I afford this?'];
  $('suggest').innerHTML = suggestions.map((s) => `<button class="chip">${s}</button>`).join('');
  $('suggest').querySelectorAll('.chip').forEach((c) => c.onclick = () => { $('chatInput').value = c.textContent; send(); });
}

async function send() {
  const input = $('chatInput');
  const message = input.value.trim();
  if (!message) return;
  addBubble(message, 'user');
  input.value = '';
  const typing = addBubble('thinking…', 'bot');
  typing.classList.add('typing');
  try {
    const language = $('language').value;
    const data = await authedFetch('/api/me/chat', {
      method: 'POST',
      body: JSON.stringify({ message, profile: collectRequest(), language }),
    });
    typing.remove();
    addBubble(data.reply, 'bot', { src: data.source, language: data.language });
    if (data.facts) renderResults(data.facts);
    if ($('voice').checked) speak(data.reply, data.language);
  } catch (e) {
    typing.remove();
    addBubble(`Error: ${e.message}`, 'bot');
  }
}

$('sendBtn').onclick = send;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

// ---- Downloadable recommendation summary (bonus) ---------------------------
// Styled, self-contained HTML summary. Renders ₹ and all UTF-8 correctly in any
// browser, and can be saved as PDF via the browser's "Print → Save as PDF".
function buildSummaryHTML(facts) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const who = esc($('who').textContent || 'User');
  const p = facts.profile;
  const r = facts.recommendation;

  const recBlock = r ? `
    <h2>Recommended product: ${esc(r.name)}</h2>
    <table class="kv">
      <tr><th>Interest rate</th><td>${r.offeredRatePct}%</td></tr>
      <tr><th>Tenure</th><td>${r.tenureMonths} months</td></tr>
      <tr><th>EMI</th><td><b>${fmt(r.emi)}</b> / month</td></tr>
      <tr><th>Total interest</th><td>${fmt(r.totalInterest)}</td></tr>
      <tr><th>Total repayment</th><td>${fmt(r.totalPayment)}</td></tr>
      <tr><th>Obligation (FOIR)</th><td>${r.foirPct}% ${r.affordable ? '<span class="ok">(within limit)</span>' : '<span class="bad">(HIGH — exceeds limit)</span>'}</td></tr>
    </table>` : '<h2>No eligible product was found for this request.</h2>';

  const others = (r && facts.eligible.length > 1) ? `
    <h3>Other eligible options</h3>
    <table class="grid">
      <tr><th>Product</th><th>Rate</th><th>EMI</th><th>Tenure</th><th>Total interest</th></tr>
      ${facts.eligible.slice(1).map((o) => `<tr><td>${esc(o.name)}</td><td>${o.offeredRatePct}%</td><td>${fmt(o.emi)}</td><td>${o.tenureMonths} mo</td><td>${fmt(o.totalInterest)}</td></tr>`).join('')}
    </table>` : '';

  const excluded = facts.ineligible.length ? `
    <h3>Products not available (and why)</h3>
    <ul>${facts.ineligible.map((o) => `<li><b>${esc(o.name)}:</b> ${esc(o.reasons.join(' '))}</li>`).join('')}</ul>` : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Loan Recommendation Summary</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#1a2029;max-width:720px;margin:24px auto;padding:0 18px;line-height:1.5;}
  h1{font-size:22px;margin:0 0 2px;} .sub{color:#666;font-size:13px;margin-bottom:18px;}
  h2{font-size:16px;margin:18px 0 8px;} h3{font-size:14px;margin:18px 0 6px;}
  table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0;}
  table.kv th{text-align:left;width:170px;color:#555;font-weight:600;padding:4px 8px;}
  table.kv td{padding:4px 8px;}
  table.grid th,table.grid td{border:1px solid #ddd;padding:6px 8px;text-align:left;}
  table.grid th{background:#f4f6f8;}
  .ok{color:#1a7f37;} .bad{color:#b3261e;font-weight:600;}
  ul{font-size:13px;padding-left:18px;} li{margin:3px 0;}
  .disclaimer{margin-top:22px;border-top:1px solid #ddd;padding-top:12px;font-size:11.5px;color:#555;}
  .actions{margin:14px 0;} button{font:inherit;padding:8px 14px;border:1px solid #ccc;border-radius:6px;background:#f4f6f8;cursor:pointer;}
  @media print{.actions{display:none;}}
</style></head><body>
  <h1>💰 LoanWise — Loan Recommendation Summary</h1>
  <div class="sub">Prepared for: ${who}</div>
  <div class="actions"><button onclick="window.print()">🖨️ Print / Save as PDF</button></div>

  <h3>Your request</h3>
  <table class="kv">
    <tr><th>Amount</th><td>${fmt(p.amount)}</td></tr>
    <tr><th>Purpose</th><td>${esc(p.purpose)}</td></tr>
    <tr><th>Monthly income</th><td>${fmt(p.monthlyIncome)}</td></tr>
    <tr><th>Existing EMI</th><td>${fmt(p.existingEmi)}</td></tr>
    <tr><th>Employment</th><td>${esc(p.employmentType)}</td></tr>
    <tr><th>Risk profile</th><td>${esc(p.riskProfile)}</td></tr>
  </table>

  ${recBlock}
  ${others}
  ${excluded}

  <div class="disclaimer"><b>Disclaimer:</b> This is an automated estimate for guidance only,
  based on the information provided. It is not a loan offer or a guarantee of approval. Final
  eligibility, interest rate, and terms are subject to underwriting, credit checks, and document
  verification. Please verify all figures before making a decision.</div>
</body></html>`;
}

function downloadBlob(content, filename, mime) {
  // Prepend a UTF-8 BOM so ₹ and dashes render correctly even in Notepad.
  const blob = new Blob(['﻿', content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('downloadBtn').onclick = () => {
  if (!LATEST_FACTS) { alert('Generate a recommendation first.'); return; }
  downloadBlob(buildSummaryHTML(LATEST_FACTS), 'loan-recommendation-summary.html', 'text/html;charset=utf-8');
};

loadDemoUsers();
