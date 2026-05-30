/* =========================================================================
   HR Eignungs-Score
   Transparente, gewichtete Bewertung. Aufgeteilt in vier Bereiche:
   Bewerber bewerten · Gewichtung · Datensätze · Formel.
   ========================================================================= */

// --- Kriterien-Definitionen ------------------------------------------------
// Jeder Wert eines kategorialen Kriteriums hat einen festen Teilscore (0..1).
// Zahlen-Kriterien werden linear zwischen min und max umgerechnet.
const FEATURES = [
  {
    key: 'schulabschluss', label: 'Schulabschluss', type: 'ordinal',
    defaultWeight: 5, enabled: true,
    desc: 'Höchster allgemeinbildender Schulabschluss.',
    options: { OS: 0.0, MS: 0.6, AS: 1.0 },
    optionLabels: { OS: 'Ohne Schulabschluss', MS: 'Mittlerer Schulabschluss', AS: 'Abitur' }
  },
  {
    key: 'berufsabschluss', label: 'Berufsabschluss', type: 'ordinal',
    defaultWeight: 7, enabled: true,
    desc: 'Berufliche Qualifikation bzw. Ausbildung.',
    options: { O: 0.0, HW: 0.6, K: 0.7, ST: 1.0 },
    optionLabels: { O: 'Ohne Berufsabschluss', HW: 'Handwerk', K: 'Kaufmännisch', ST: 'Studium' }
  },
  {
    key: 'qualifikationsstufe', label: 'Qualifikationsstufe', type: 'ordinal',
    defaultWeight: 5, enabled: true,
    desc: 'Angestrebte bzw. aktuelle Funktionsebene.',
    options: { H: 0.25, A: 0.45, S: 0.75, M: 1.0 },
    optionLabels: { H: 'Hilfskräfte', A: 'In Ausbildung', S: 'Sachbearbeitung', M: 'Management' }
  },
  {
    key: 'berufserfahrung', label: 'Berufserfahrung', type: 'numeric',
    defaultWeight: 8, enabled: true,
    desc: 'Einschlägige Berufsjahre. 0 Jahre = 0 %, 20+ Jahre = 100 %.',
    min: 0, max: 20, unit: 'Jahre', higherIsBetter: true
  },
  {
    key: 'fehlzeiten', label: 'Fehlzeiten', type: 'numeric',
    defaultWeight: 4, enabled: true,
    desc: 'Fehltage/-monate pro Jahr. Weniger ist besser (0 Monate = 100 %).',
    min: 0, max: 6, unit: 'Monate/Jahr', higherIsBetter: false
  },
  {
    key: 'gehaltEinstieg', label: 'Gehaltsvorstellung', type: 'numeric',
    defaultWeight: 0, enabled: false,
    desc: 'Geforderter Einstiegslohn. Niedriger = „günstiger" = höherer Teilscore.',
    min: 1000, max: 10000, unit: '€/Monat', higherIsBetter: false,
    ethics: 'Bewerber nach Kosten zu bewerten ist ethisch heikel und kann Qualifizierte ' +
            'benachteiligen. Daher standardmäßig deaktiviert.'
  }
];

const STORAGE_KEY = 'hr-score-weights-v1';
let candidates = [];                 // expandierte Datensätze
let config = loadConfig();
let applicant = blankApplicant();    // manueller Bewerber (Bereich „Bewerten")
let sortState = { key: 'score', dir: 'desc' };

// --- Konfiguration ---------------------------------------------------------
function defaultConfig() {
  const c = {};
  FEATURES.forEach(f => c[f.key] = { weight: f.defaultWeight, enabled: f.enabled });
  return c;
}
function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const base = defaultConfig();
    if (saved) FEATURES.forEach(f => { if (saved[f.key]) base[f.key] = saved[f.key]; });
    return base;
  } catch { return defaultConfig(); }
}
function saveConfig() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {}
}
function blankApplicant() {
  const a = {};
  FEATURES.forEach(f => a[f.key] = f.type === 'ordinal' ? '' : null);
  return a;
}

// --- Kernlogik: Teilscore + Gesamtscore -----------------------------------
function normalize(feature, value) {
  if (value === '' || value === null || value === undefined) return null;
  if (feature.type === 'ordinal') {
    return (value in feature.options) ? feature.options[value] : null;
  }
  const v = Number(value);
  if (!isFinite(v)) return null;
  const t = (v - feature.min) / (feature.max - feature.min);
  const clamped = Math.max(0, Math.min(1, t));
  return feature.higherIsBetter ? clamped : 1 - clamped;
}

function scoreOf(cand, cfg = config) {
  let sumW = 0, sumWN = 0;
  const rows = [];
  FEATURES.forEach(f => {
    const c = cfg[f.key];
    const value = cand[f.key];
    const norm = normalize(f, value);
    const active = c.enabled && c.weight > 0 && norm !== null;
    if (active) { sumW += c.weight; sumWN += c.weight * norm; }
    rows.push({ feature: f, value, norm, weight: c.weight, enabled: c.enabled, active });
  });
  const score = sumW > 0 ? (sumWN / sumW) * 100 : 0;
  rows.forEach(r => r.share = (sumW > 0 && r.active) ? (r.weight * r.norm / sumW) * 100 : 0);
  return { score, rows, sumW };
}

function scoreColor(score, sumW) {
  if (sumW === 0) return '#94a3b8';
  return score >= 70 ? 'var(--good)' : score >= 50 ? 'var(--mid)' : 'var(--bad)';
}
function recommendation(score, sumW) {
  if (sumW === 0) return { label: '—', cls: '', text: 'Noch keine bewertbaren Angaben.' };
  if (score >= 75) return { label: 'sehr geeignet', cls: 'good', text: 'Klare Empfehlung: passt sehr gut zu den gewichteten Anforderungen.' };
  if (score >= 60) return { label: 'geeignet', cls: 'good', text: 'Empfehlung: solide Eignung. Gespräch sinnvoll.' };
  if (score >= 45) return { label: 'Grenzfall', cls: 'mid', text: 'Grenzfall: Stärken und Schwächen genauer abwägen.' };
  return { label: 'wenig geeignet', cls: 'bad', text: 'Eher nicht empfohlen – Anforderungen nur teilweise erfüllt.' };
}
function fmtValue(f, v) {
  if (v === '' || v === null || v === undefined) return '—';
  if (f.type === 'ordinal') return f.optionLabels[v] || v;
  return v + (f.unit ? ' ' + f.unit.split('/')[0] : '');
}

// --- Bereich: Bewerber bewerten -------------------------------------------
function buildBewertenInputs() {
  const box = document.getElementById('bewerten-inputs');
  box.innerHTML = '';
  FEATURES.forEach(f => {
    const cfg = config[f.key];
    const wrap = document.createElement('label');
    wrap.className = 'field' + (cfg.enabled ? '' : ' off');

    const span = document.createElement('span');
    span.textContent = f.label + (f.unit ? ` (${f.unit})` : '');
    if (!cfg.enabled) span.innerHTML += ' <span class="badge-off">– nicht gewertet</span>';
    wrap.appendChild(span);

    if (f.type === 'ordinal') {
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">— bitte wählen —</option>' +
        Object.keys(f.options).map(k => `<option value="${k}">${f.optionLabels[k]}</option>`).join('');
      sel.value = applicant[f.key] || '';
      sel.onchange = () => { applicant[f.key] = sel.value; renderBewerten(); };
      wrap.appendChild(sel);
    } else {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = f.min; inp.max = f.max; inp.step = 'any';
      inp.placeholder = `${f.min}–${f.max}`;
      inp.value = applicant[f.key] ?? '';
      inp.oninput = () => { applicant[f.key] = inp.value === '' ? null : Number(inp.value); renderBewerten(); };
      wrap.appendChild(inp);
    }
    box.appendChild(wrap);
  });
}

function renderBewerten() {
  const { score, rows, sumW } = scoreOf(applicant);
  const pct = Math.round(score);

  const fg = document.getElementById('gauge-fg');
  fg.style.strokeDashoffset = (2 * Math.PI * 52) * (1 - score / 100);
  fg.style.stroke = scoreColor(score, sumW);
  document.getElementById('score-value').textContent = sumW === 0 ? '–' : pct + '%';

  const rec = recommendation(score, sumW);
  document.getElementById('score-label').textContent = rec.label;
  const recEl = document.getElementById('recommendation');
  recEl.className = 'recommendation ' + rec.cls;
  recEl.textContent = rec.text;

  const tbody = document.querySelector('#breakdown tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    if (!r.active) tr.className = 'excluded';
    let beitrag;
    if (!config[r.feature.key].enabled) beitrag = 'aus';
    else if (r.weight === 0) beitrag = 'Gewicht 0';
    else if (r.norm === null) beitrag = '—';
    else beitrag = '+' + r.share.toFixed(1) + ' Pp';
    tr.innerHTML = `<td>${r.feature.label}</td>
      <td>${fmtValue(r.feature, r.value)}</td>
      <td>${r.norm === null ? '–' : Math.round(r.norm * 100) + '%'}</td>
      <td>${r.weight}</td>
      <td>${beitrag}</td>`;
    tbody.appendChild(tr);
  });
}

// --- Bereich: Gewichtung ---------------------------------------------------
function buildWeightControls() {
  const box = document.getElementById('weight-controls');
  box.innerHTML = '';
  FEATURES.forEach(f => {
    const cfg = config[f.key];
    const row = document.createElement('div');
    row.className = 'weight-row' + (cfg.enabled ? '' : ' off');

    const head = document.createElement('div');
    head.className = 'wr-head';
    head.innerHTML = `<span class="wr-title">${f.label}</span>`;
    const sw = document.createElement('label');
    sw.className = 'switch';
    sw.innerHTML = `<input type="checkbox" ${cfg.enabled ? 'checked' : ''}>
                    <span class="track"></span><span>${cfg.enabled ? 'aktiv' : 'aus'}</span>`;
    sw.querySelector('input').onchange = e => {
      cfg.enabled = e.target.checked; saveConfig();
      buildWeightControls(); buildBewertenInputs(); renderBewerten();
    };
    head.appendChild(sw);
    row.appendChild(head);

    const desc = document.createElement('p');
    desc.className = 'wr-desc'; desc.textContent = f.desc;
    row.appendChild(desc);

    const valLine = document.createElement('div');
    valLine.innerHTML = `Gewicht: <span class="wr-val">${cfg.weight}</span>`;
    row.appendChild(valLine);

    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = 0; slider.max = 10; slider.step = 1;
    slider.value = cfg.weight; slider.disabled = !cfg.enabled;
    slider.oninput = () => {
      cfg.weight = Number(slider.value);
      valLine.querySelector('.wr-val').textContent = cfg.weight;
      saveConfig(); renderBewerten();
    };
    row.appendChild(slider);

    if (f.ethics) {
      const e = document.createElement('p');
      e.className = 'wr-ethics'; e.textContent = '⚠ ' + f.ethics;
      row.appendChild(e);
    }
    box.appendChild(row);
  });
}
document.getElementById('reset-weights').onclick = () => {
  config = defaultConfig(); saveConfig();
  buildWeightControls(); buildBewertenInputs(); renderBewerten();
};

// --- Bereich: Datensätze ---------------------------------------------------
function renderDataTable() {
  const filter = (document.getElementById('daten-filter').value || '').toLowerCase();
  const rows = candidates.map(c => {
    const { score, sumW } = scoreOf(c);
    return {
      name: `${c.nachname}, ${c.vorname}`,
      quelle: c.quelle,
      schul: c.schulabschluss, beruf: c.berufsabschluss, qual: c.qualifikationsstufe,
      fz: c.fehlzeiten ?? 0,
      score: sumW === 0 ? -1 : score,
      status: c.gekuendigt ? 1 : 0
    };
  }).filter(r => r.name.toLowerCase().includes(filter));

  const dir = sortState.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    let x = a[sortState.key], y = b[sortState.key];
    if (typeof x === 'string') return x.localeCompare(y) * dir;
    return (x - y) * dir;
  });

  const SL = { OS:'o. Abschl.', MS:'Mittlere R.', AS:'Abitur' };
  const tbody = document.querySelector('#data-table tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const sc = r.score < 0
      ? '<span class="muted">–</span>'
      : `<span class="score-pill" style="background:${pill(r.score)}">${Math.round(r.score)}%</span>`;
    const status = r.status
      ? '<span class="badge left">ausgeschieden</span>'
      : '<span class="badge ok">im Unternehmen</span>';
    tr.innerHTML = `<td>${r.name}</td><td>${r.quelle}</td>
      <td>${SL[r.schul] || r.schul}</td><td>${r.beruf}</td><td>${r.qual}</td>
      <td>${r.fz}</td><td>${sc}</td><td>${status}</td>`;
    tbody.appendChild(tr);
  });
}
function pill(score) {
  return score >= 70 ? '#dcfce7' : score >= 50 ? '#fef3c7' : '#fee2e2';
}
document.getElementById('daten-filter').oninput = renderDataTable;
document.querySelectorAll('#data-table thead th').forEach(th => {
  th.onclick = () => {
    const key = th.dataset.sort;
    sortState.dir = (sortState.key === key && sortState.dir === 'desc') ? 'asc' : 'desc';
    sortState.key = key;
    document.querySelectorAll('#data-table thead th').forEach(h => {
      h.textContent = h.textContent.replace(/[ ▾▴]+$/, '');
    });
    th.textContent += sortState.dir === 'desc' ? ' ▾' : ' ▴';
    renderDataTable();
  };
});

// --- Bereich: Formel -------------------------------------------------------
function buildFormel() {
  // Zuordnungstabellen je Kriterium
  const host = document.getElementById('formel-tables');
  host.innerHTML = '';
  FEATURES.forEach(f => {
    const t = document.createElement('table');
    t.className = 'map-table';
    if (f.type === 'ordinal') {
      const rows = Object.keys(f.options)
        .map(k => `<tr><td>${f.optionLabels[k]}</td><td class="ts">${Math.round(f.options[k]*100)}%</td></tr>`).join('');
      t.innerHTML = `<caption>${f.label} (kategorial)</caption>
        <thead><tr><th>Wert</th><th>Teilscore</th></tr></thead><tbody>${rows}</tbody>`;
    } else {
      const dir = f.higherIsBetter ? 'mehr ist besser' : 'weniger ist besser';
      t.innerHTML = `<caption>${f.label} (Zahl, ${dir})</caption>
        <thead><tr><th>Wert</th><th>Teilscore</th></tr></thead><tbody>
        <tr><td>${f.higherIsBetter ? f.min : f.max} ${f.unit.split('/')[0]} (ungünstig)</td><td class="ts">0%</td></tr>
        <tr><td>dazwischen</td><td class="ts">linear</td></tr>
        <tr><td>${f.higherIsBetter ? f.max+'+' : f.min} ${f.unit.split('/')[0]} (optimal)</td><td class="ts">100%</td></tr>
        </tbody>`;
    }
    host.appendChild(t);
  });

  // Rechenbeispiel mit Standard-Gewichtung
  const ex = { schulabschluss:'AS', berufsabschluss:'ST', qualifikationsstufe:'S',
               berufserfahrung:8, fehlzeiten:1, gehaltEinstieg:null };
  const cfg = defaultConfig();
  const { score, rows, sumW } = scoreOf(ex, cfg);
  const active = rows.filter(r => r.active);
  const body = active.map(r =>
    `<tr><td>${r.feature.label}</td><td>${fmtValue(r.feature, r.value)}</td>
     <td>${Math.round(r.norm*100)}%</td><td>${r.weight}</td>
     <td>${(r.weight*r.norm).toFixed(2)}</td></tr>`).join('');
  const sumWN = active.reduce((s,r)=>s+r.weight*r.norm,0);
  document.getElementById('formel-example').innerHTML = `
    <p class="muted small">Beispielbewerber mit der <strong>Standard-Gewichtung</strong>
    (Gehalt deaktiviert):</p>
    <table class="example-table">
      <thead><tr><th>Kriterium</th><th>Wert</th><th>Teilscore</th><th>Gewicht</th><th>Gew.×Teilscore</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="3">Summen</td><td>${active.reduce((s,r)=>s+r.weight,0)}</td><td>${sumWN.toFixed(2)}</td></tr></tfoot>
    </table>
    <p>Score = ${sumWN.toFixed(2)} ÷ ${active.reduce((s,r)=>s+r.weight,0)} × 100&nbsp;%
       = <span class="example-result">${Math.round(score)}%</span></p>`;
}

// --- Navigation ------------------------------------------------------------
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  (el || document.getElementById('view-home')).classList.add('active');
  if (name === 'bewerten') { buildBewertenInputs(); renderBewerten(); }
  if (name === 'gewichtung') buildWeightControls();
  if (name === 'daten') renderDataTable();
  if (name === 'formel') buildFormel();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-nav]').forEach(b => {
  b.onclick = () => showView(b.dataset.nav);
});

// --- Start -----------------------------------------------------------------
async function init() {
  buildWeightControls();
  try {
    const res = await fetch('data/candidates.json');
    const raw = await res.json();
    const Q = { T: 'Testdaten', Z: 'Zusatzinfos' };
    candidates = raw.map(c => ({
      quelle: Q[c.q] || c.q, nachname: c.nn, vorname: c.vn, geschlecht: c.g, alter: c.al,
      schulabschluss: c.sa, berufsabschluss: c.ba, qualifikationsstufe: c.qs,
      fehlzeiten: c.fz, gehaltEinstieg: c.ge, gehaltAktuell: c.ga,
      betriebszugehoerigkeit: c.bz, gekuendigt: !!c.k
    }));
  } catch (e) {
    console.warn('Datensatz konnte nicht geladen werden:', e);
  }
  showView('home');
}
init();
