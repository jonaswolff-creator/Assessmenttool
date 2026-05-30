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
    desc: 'Fehlzeit pro Jahr. Bei bestehenden Mitarbeitenden wird die Gesamt-Fehlzeit ' +
          'auf die Beschäftigungsdauer umgerechnet (Monate/Jahr). Weniger ist besser.',
    note: 'Hinweis: Bei vorhandenen Datensätzen wird die Rate berechnet als ' +
          'Gesamt-Fehlzeit ÷ Beschäftigungsjahre. So zählt 2 Monate in 20 Jahren (0,1/Jahr) ' +
          'viel besser als 2 Monate in 1 Jahr (2,0/Jahr).',
    min: 0, max: 3, unit: 'Monate/Jahr', higherIsBetter: false
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
const MAP_KEY = 'hr-score-map-v1';
const NUM_KEY = 'hr-score-num-v1';
let candidates = [];                 // expandierte Datensätze
let config = loadConfig();
let optMap = loadOptMap();           // anpassbare Teilscores je kategorialem Wert
let numMap = loadNumMap();           // anpassbare Grenzen je Zahlen-Kriterium
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

// Anpassbare Teilscores (Bereich „Formel"): { featureKey: { optionKey: 0..1 } }
function defaultOptMap() {
  const m = {};
  FEATURES.forEach(f => { if (f.type === 'ordinal') m[f.key] = { ...f.options }; });
  return m;
}
function loadOptMap() {
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_KEY));
    const base = defaultOptMap();
    if (saved) for (const fk in base)
      for (const ok in base[fk])
        if (saved[fk] && typeof saved[fk][ok] === 'number') base[fk][ok] = saved[fk][ok];
    return base;
  } catch { return defaultOptMap(); }
}
function saveOptMap() { try { localStorage.setItem(MAP_KEY, JSON.stringify(optMap)); } catch {} }

// Anpassbare Grenzen der Zahlen-Kriterien: { featureKey: { min, max } }
function defaultNumMap() {
  const m = {};
  FEATURES.forEach(f => { if (f.type === 'numeric') m[f.key] = { min: f.min, max: f.max }; });
  return m;
}
function loadNumMap() {
  try {
    const saved = JSON.parse(localStorage.getItem(NUM_KEY));
    const base = defaultNumMap();
    if (saved) for (const fk in base)
      for (const b of ['min', 'max'])
        if (saved[fk] && typeof saved[fk][b] === 'number') base[fk][b] = saved[fk][b];
    return base;
  } catch { return defaultNumMap(); }
}
function saveNumMap() { try { localStorage.setItem(NUM_KEY, JSON.stringify(numMap)); } catch {} }

// --- Kernlogik: Teilscore + Gesamtscore -----------------------------------
function normalize(feature, value) {
  if (value === '' || value === null || value === undefined) return null;
  if (feature.type === 'ordinal') {
    const map = optMap[feature.key] || feature.options;
    return (value in map) ? map[value] : null;
  }
  const v = Number(value);
  if (!isFinite(v)) return null;
  const nm = numMap[feature.key] || feature;
  if (nm.max === nm.min) return null;
  const t = (v - nm.min) / (nm.max - nm.min);
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
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function renderDataTable() {
  const filter = (document.getElementById('daten-filter').value || '').toLowerCase();
  const rows = candidates.map(c => {
    // Fehlzeit als Rate (Monate/Jahr) über die Beschäftigungsdauer normieren
    const rate = c.betriebszugehoerigkeit > 0 ? c.fehlzeiten / c.betriebszugehoerigkeit : c.fehlzeiten;
    const { score, sumW } = scoreOf({ ...c, fehlzeiten: rate });
    return {
      name: `${c.nachname}, ${c.vorname}`, quelle: c.quelle,
      schul: c.schulabschluss, beruf: c.berufsabschluss, qual: c.qualifikationsstufe,
      fz: c.fehlzeiten ?? 0, fzrate: rate,
      ed: c.einstellungsdatum || '', kd: c.kuendigungsdatum || '',
      score: sumW === 0 ? -1 : score
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
    tr.innerHTML = `<td>${r.name}</td><td>${r.quelle}</td>
      <td>${SL[r.schul] || r.schul}</td><td>${r.beruf}</td><td>${r.qual}</td>
      <td>${r.fz}</td>
      <td>${r.fzrate.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
      <td>${fmtDate(r.ed)}</td><td>${fmtDate(r.kd)}</td>
      <td>${sc}</td>`;
    tbody.appendChild(tr);
  });
}
function pill(score) {
  return score >= 70 ? '#dcfce7' : score >= 50 ? '#fef3c7' : '#fee2e2';
}
function buildLegend() {
  const host = document.getElementById('daten-legende');
  if (!host) return;
  const block = f => `<div class="legend-block"><strong>${f.label}:</strong> ` +
    Object.keys(f.options).map(k => `${k} = ${f.optionLabels[k]}`).join(' · ') + '</div>';
  host.innerHTML = '<div class="legend-title">Legende</div>' +
    FEATURES.filter(f => f.type === 'ordinal').map(block).join('');
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
      const rows = Object.keys(f.options).map(k =>
        `<tr><td>${f.optionLabels[k]}</td>
         <td class="ts"><input type="number" min="0" max="100" step="1"
            value="${Math.round((optMap[f.key][k]) * 100)}"
            data-f="${f.key}" data-o="${k}" class="ts-input"> %</td></tr>`).join('');
      t.innerHTML = `<caption>${f.label} (kategorial – anpassbar)</caption>
        <thead><tr><th>Wert</th><th>Teilscore</th></tr></thead><tbody>${rows}</tbody>`;
    } else {
      const dir = f.higherIsBetter ? 'mehr ist besser' : 'weniger ist besser';
      const unit = f.unit;
      const lowBound = f.higherIsBetter ? 'min' : 'max';  // Wert, der 0 % ergibt
      const highBound = f.higherIsBetter ? 'max' : 'min'; // Wert, der 100 % ergibt
      const nm = numMap[f.key];
      const inp = (b) => `<input type="number" step="any" value="${nm[b]}"
          data-f="${f.key}" data-b="${b}" class="num-input"> ${unit}`;
      t.innerHTML = `<caption>${f.label} (Zahl, ${dir} – anpassbar)</caption>
        <thead><tr><th>Wert</th><th>Teilscore</th></tr></thead><tbody>
        <tr><td>${inp(lowBound)} (ungünstig)</td><td class="ts">0%</td></tr>
        <tr><td>dazwischen</td><td class="ts">linear</td></tr>
        <tr><td>${inp(highBound)} (optimal)</td><td class="ts">100%</td></tr>
        </tbody>`;
    }
    host.appendChild(t);
    if (f.note) {
      const n = document.createElement('p');
      n.className = 'map-note muted small'; n.textContent = f.note;
      host.appendChild(n);
    }
  });

  // Eingaben für editierbare Teilscores (kategorial) verdrahten
  host.querySelectorAll('.ts-input').forEach(inp => {
    inp.oninput = () => {
      let v = Number(inp.value);
      if (!isFinite(v)) return;
      v = Math.max(0, Math.min(100, v));
      optMap[inp.dataset.f][inp.dataset.o] = v / 100;
      saveOptMap();
      renderFormelExample();
      renderBewerten();
    };
  });
  // Eingaben für editierbare Grenzen (Zahlen) verdrahten
  host.querySelectorAll('.num-input').forEach(inp => {
    inp.oninput = () => {
      const v = Number(inp.value);
      if (!isFinite(v)) return;
      numMap[inp.dataset.f][inp.dataset.b] = v;
      saveNumMap();
      renderFormelExample();
      renderBewerten();
    };
  });

  renderFormelExample();
}

function renderFormelExample() {
  const host = document.getElementById('formel-example');
  if (!host) return;
  // Rechenbeispiel mit Standard-Gewichtung
  const ex = { schulabschluss:'AS', berufsabschluss:'ST', qualifikationsstufe:'S',
               berufserfahrung:8, fehlzeiten:1, gehaltEinstieg:null };
  const cfg = defaultConfig();
  const { score, rows } = scoreOf(ex, cfg);
  const active = rows.filter(r => r.active);
  const body = active.map(r =>
    `<tr><td>${r.feature.label}</td><td>${fmtValue(r.feature, r.value)}</td>
     <td>${Math.round(r.norm*100)}%</td><td>${r.weight}</td>
     <td>${(r.weight*r.norm).toFixed(2)}</td></tr>`).join('');
  const sumW = active.reduce((s,r)=>s+r.weight,0);
  const sumWN = active.reduce((s,r)=>s+r.weight*r.norm,0);
  host.innerHTML = `
    <p class="muted small">Beispielbewerber mit der <strong>Standard-Gewichtung</strong>
    (Gehalt deaktiviert). Ändern Sie oben einen Teilscore, ändert sich dieses Ergebnis mit:</p>
    <table class="example-table">
      <thead><tr><th>Kriterium</th><th>Wert</th><th>Teilscore</th><th>Gewicht</th><th>Gew.×Teilscore</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="3">Summen</td><td>${sumW}</td><td>${sumWN.toFixed(2)}</td></tr></tfoot>
    </table>
    <p>Score = ${sumWN.toFixed(2)} ÷ ${sumW} × 100&nbsp;%
       = <span class="example-result">${Math.round(score)}%</span></p>`;
}

document.getElementById('reset-map').onclick = () => {
  optMap = defaultOptMap(); saveOptMap();
  numMap = defaultNumMap(); saveNumMap();
  buildFormel(); renderBewerten();
};

// --- Navigation ------------------------------------------------------------
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  (el || document.getElementById('view-home')).classList.add('active');
  if (name === 'bewerten') { buildBewertenInputs(); renderBewerten(); }
  if (name === 'gewichtung') buildWeightControls();
  if (name === 'daten') { renderDataTable(); buildLegend(); }
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
      einstellungsdatum: c.ed, kuendigungsdatum: c.kd,
      betriebszugehoerigkeit: c.bz, gekuendigt: !!c.k
    }));
  } catch (e) {
    console.warn('Datensatz konnte nicht geladen werden:', e);
  }
  showView('home');
}
init();
