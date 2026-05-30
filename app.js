/* =========================================================================
   HR Eignungs-Score – transparente, gewichtete Bewertung
   -------------------------------------------------------------------------
   Grundprinzip:
   Jeder Faktor wird auf einen Teilscore 0..1 normalisiert (1 = optimal).
   Der Gesamtscore ist der gewichtete Durchschnitt aller AKTIVEN Faktoren,
   die für den Bewerber einen Wert haben:

        score = Σ(gewicht_i · teilscore_i) / Σ(gewicht_i)   · 100%

   Dadurch ist das Ergebnis vollständig nachvollziehbar und es können
   gezielt Faktoren ausgeschlossen werden (z.B. diskriminierende Merkmale).
   ========================================================================= */

// --- Faktor-Definitionen ---------------------------------------------------
const FEATURES = [
  {
    key: 'schulabschluss', label: 'Schulabschluss', type: 'ordinal',
    defaultWeight: 5, enabled: true,
    options: { OS: 0.0, MS: 0.6, AS: 1.0 },
    optionLabels: { OS: 'Ohne Schulabschluss', MS: 'Mittlerer Schulabschluss', AS: 'Abitur' }
  },
  {
    key: 'berufsabschluss', label: 'Berufsabschluss', type: 'ordinal',
    defaultWeight: 7, enabled: true,
    options: { O: 0.0, HW: 0.6, K: 0.7, ST: 1.0 },
    optionLabels: { O: 'Ohne Berufsabschluss', HW: 'Handwerk', K: 'Kaufmännisch', ST: 'Studium' }
  },
  {
    key: 'qualifikationsstufe', label: 'Qualifikationsstufe', type: 'ordinal',
    defaultWeight: 5, enabled: true,
    options: { H: 0.25, A: 0.45, S: 0.75, M: 1.0 },
    optionLabels: { H: 'Hilfskräfte', A: 'In Ausbildung', S: 'Sachbearbeitung', M: 'Management' }
  },
  {
    key: 'berufserfahrung', label: 'Berufserfahrung', type: 'numeric',
    defaultWeight: 8, enabled: true,
    min: 0, max: 20, unit: 'Jahre', higherIsBetter: true, manualOnly: true,
    hint: 'Nicht im Datensatz enthalten – bitte manuell erfassen.'
  },
  {
    key: 'fehlzeiten', label: 'Fehlzeiten', type: 'numeric',
    defaultWeight: 4, enabled: true,
    min: 0, max: 6, unit: 'Monate/Jahr', higherIsBetter: false
  },
  {
    key: 'gehaltEinstieg', label: 'Gehaltsvorstellung', type: 'numeric',
    defaultWeight: 0, enabled: false,
    min: 1000, max: 10000, unit: '€/Monat', higherIsBetter: false,
    ethics: 'Bewerber nach Kosten zu bewerten ist ethisch heikel und kann ' +
            'Qualifizierte benachteiligen. Standardmäßig deaktiviert.'
  }
];

// --- Geschützte Merkmale: NIE im Score, nur zur Information ----------------
const PROTECTED = [
  { key: 'name',        label: 'Name',        get: c => `${c.vorname} ${c.nachname}`.trim() || '—' },
  { key: 'geschlecht',  label: 'Geschlecht',  get: c => ({ m:'männlich', w:'weiblich', d:'divers' }[c.geschlecht] || '—') },
  { key: 'alter',       label: 'Alter',       get: c => c.alter ? `${c.alter} Jahre` : '—' }
];

const STORAGE_KEY = 'hr-score-weights-v1';
let candidates = [];
let config = loadConfig();          // { [key]: {weight, enabled} }
let current = blankCandidate();     // aktuell bewerteter Datensatz

// --- Konfiguration laden/speichern ----------------------------------------
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

function blankCandidate() {
  return { vorname:'', nachname:'', geschlecht:'', alter:null,
           schulabschluss:'', berufsabschluss:'', qualifikationsstufe:'',
           berufserfahrung:null, fehlzeiten:null, gehaltEinstieg:null };
}

// --- Normalisierung eines Faktorwerts auf 0..1 ----------------------------
function normalize(feature, value) {
  if (value === '' || value === null || value === undefined) return null;
  if (feature.type === 'ordinal') {
    return (value in feature.options) ? feature.options[value] : null;
  }
  // numeric
  const v = Number(value);
  if (!isFinite(v)) return null;
  const t = (v - feature.min) / (feature.max - feature.min);
  const clamped = Math.max(0, Math.min(1, t));
  return feature.higherIsBetter ? clamped : 1 - clamped;
}

// --- Scoreberechnung -------------------------------------------------------
function computeScore() {
  let sumW = 0, sumWN = 0;
  const rows = [];
  FEATURES.forEach(f => {
    const cfg = config[f.key];
    const value = current[f.key];
    const norm = normalize(f, value);
    const active = cfg.enabled && cfg.weight > 0 && norm !== null;
    const contribution = active ? cfg.weight * norm : 0;
    if (active) { sumW += cfg.weight; sumWN += contribution; }
    rows.push({ feature: f, value, norm, weight: cfg.weight, enabled: cfg.enabled, active, contribution });
  });
  const score = sumW > 0 ? (sumWN / sumW) * 100 : 0;
  // Beitrag jedes Faktors am Gesamtscore (in Prozentpunkten)
  rows.forEach(r => r.share = (sumW > 0 && r.active) ? (r.contribution / sumW) * 100 : 0);
  return { score, rows, sumW };
}

// --- UI: Eingabefelder aufbauen -------------------------------------------
function buildInputs() {
  const box = document.getElementById('feature-inputs');
  box.innerHTML = '';
  FEATURES.forEach(f => {
    const wrap = document.createElement('label');
    wrap.className = 'field' + (config[f.key].enabled ? '' : ' disabled');
    wrap.dataset.key = f.key;

    const span = document.createElement('span');
    span.textContent = f.label + (f.unit ? ` (${f.unit})` : '');
    wrap.appendChild(span);

    if (f.type === 'ordinal') {
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">— bitte wählen —</option>' +
        Object.keys(f.options).map(k => `<option value="${k}">${f.optionLabels[k]}</option>`).join('');
      sel.value = current[f.key] || '';
      sel.addEventListener('change', () => { current[f.key] = sel.value; render(); });
      wrap.appendChild(sel);
    } else {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = f.min; inp.max = f.max; inp.step = 'any';
      inp.placeholder = `${f.min}–${f.max}`;
      inp.value = (current[f.key] ?? '');
      inp.addEventListener('input', () => {
        current[f.key] = inp.value === '' ? null : Number(inp.value); render();
      });
      wrap.appendChild(inp);
    }
    if (f.hint) {
      const h = document.createElement('div');
      h.className = 'muted small'; h.style.marginTop = '4px'; h.textContent = f.hint;
      wrap.appendChild(h);
    }
    box.appendChild(wrap);
  });
}

// --- UI: Gewichtungs-Steuerung --------------------------------------------
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
                    <span class="track"></span>
                    <span>${cfg.enabled ? 'aktiv' : 'aus'}</span>`;
    sw.querySelector('input').addEventListener('change', e => {
      cfg.enabled = e.target.checked; saveConfig(); render();
    });
    head.appendChild(sw);
    row.appendChild(head);

    const valLine = document.createElement('div');
    valLine.innerHTML = `Gewicht: <span class="wr-val">${cfg.weight}</span>`;
    row.appendChild(valLine);

    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = 0; slider.max = 10; slider.step = 1; slider.value = cfg.weight;
    slider.disabled = !cfg.enabled;
    slider.addEventListener('input', () => {
      cfg.weight = Number(slider.value);
      valLine.querySelector('.wr-val').textContent = cfg.weight;
      saveConfig(); render();
    });
    row.appendChild(slider);

    if (f.ethics) {
      const e = document.createElement('p');
      e.className = 'wr-ethics'; e.textContent = '⚠ ' + f.ethics;
      row.appendChild(e);
    }
    box.appendChild(row);
  });
}

// --- UI: Ergebnis rendern --------------------------------------------------
function render() {
  const { score, rows, sumW } = computeScore();

  // Gauge
  const pct = Math.round(score);
  const circ = 2 * Math.PI * 52;
  const fg = document.getElementById('gauge-fg');
  fg.style.strokeDashoffset = circ * (1 - score / 100);
  const color = sumW === 0 ? '#94a3b8' : score >= 70 ? 'var(--good)' : score >= 50 ? 'var(--mid)' : 'var(--bad)';
  fg.style.stroke = color;
  document.getElementById('score-value').textContent = sumW === 0 ? '–' : pct + '%';

  // Empfehlung
  const rec = document.getElementById('recommendation');
  const lbl = document.getElementById('score-label');
  rec.className = 'recommendation';
  if (sumW === 0) {
    lbl.textContent = '—';
    rec.textContent = 'Kein aktiver Faktor mit Wert – bitte Daten eingeben oder Faktoren aktivieren.';
  } else if (score >= 75) {
    lbl.textContent = 'sehr geeignet'; rec.classList.add('good');
    rec.textContent = 'Klare Empfehlung: Der Bewerber passt sehr gut zu den gewichteten Anforderungen.';
  } else if (score >= 60) {
    lbl.textContent = 'geeignet'; rec.classList.add('good');
    rec.textContent = 'Empfehlung: solide Eignung. Einladung zum Gespräch sinnvoll.';
  } else if (score >= 45) {
    lbl.textContent = 'Grenzfall'; rec.classList.add('mid');
    rec.textContent = 'Grenzfall: Eignung teilweise gegeben. Genauer prüfen, Stärken/Schwächen abwägen.';
  } else {
    lbl.textContent = 'wenig geeignet'; rec.classList.add('bad');
    rec.textContent = 'Eher nicht empfohlen – erfüllt die gewichteten Anforderungen nur teilweise.';
  }

  // Aufschlüsselung
  const tbody = document.querySelector('#breakdown tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    if (!r.active) tr.className = 'excluded';
    const valTxt = formatValue(r.feature, r.value);
    const teil = r.norm === null ? '–' : Math.round(r.norm * 100) + '%';
    let beitrag;
    if (!r.feature) beitrag = '';
    if (!config[r.feature.key].enabled) beitrag = 'deaktiviert';
    else if (r.weight === 0) beitrag = 'Gewicht 0';
    else if (r.norm === null) beitrag = 'kein Wert';
    else beitrag = '+' + r.share.toFixed(1) + ' Pp';
    const barW = r.active ? Math.min(100, r.share * 2) : 0;
    tr.innerHTML = `
      <td>${r.feature.label}</td>
      <td>${valTxt}</td>
      <td>${teil}</td>
      <td>${r.weight}</td>
      <td class="bar-cell">${beitrag}<span class="bar" style="width:${barW}px"></span></td>`;
    tbody.appendChild(tr);
  });

  buildProtectedInfo();
}

function formatValue(f, v) {
  if (v === '' || v === null || v === undefined) return '—';
  if (f.type === 'ordinal') return f.optionLabels[v] || v;
  return v + (f.unit ? ' ' + f.unit.split('/')[0] : '');
}

// --- Geschützte Merkmale + Realitäts-Check --------------------------------
function buildProtectedInfo() {
  const box = document.getElementById('protected-info');
  box.innerHTML = '';
  PROTECTED.forEach(p => {
    const chip = document.createElement('span');
    chip.className = 'protected-chip';
    chip.innerHTML = `<strong>${p.label}:</strong> ${p.get(current)}`;
    box.appendChild(chip);
  });
}

function showReference(c) {
  const ref = document.getElementById('reference');
  const body = document.getElementById('reference-body');
  if (!c || c.gehaltEinstieg == null) { ref.classList.add('hidden'); return; }
  ref.classList.remove('hidden');
  const wachstum = (c.gehaltAktuell && c.gehaltEinstieg)
    ? Math.round((c.gehaltAktuell / c.gehaltEinstieg - 1) * 100) : null;
  const status = c.gekuendigt
    ? '<span class="badge left">hat das Unternehmen verlassen</span>'
    : '<span class="badge ok">noch im Unternehmen</span>';
  body.innerHTML = `
    <div class="ref-grid">
      <div class="ref-item"><span class="ref-val">${wachstum === null ? '—' : (wachstum >= 0 ? '+' : '') + wachstum + '%'}</span>Gehaltsentwicklung seit Einstieg</div>
      <div class="ref-item"><span class="ref-val">${c.betriebszugehoerigkeit ?? '—'} Jahre</span>Betriebszugehörigkeit</div>
      <div class="ref-item"><span class="ref-val">${c.fehlzeiten ?? 0} Mon.</span>erfasste Fehlzeiten</div>
      <div class="ref-item">${status}</div>
    </div>`;
}

// --- Datensatz-Auswahl -----------------------------------------------------
function fillDatasetSelect() {
  const sel = document.getElementById('dataset-select');
  candidates.forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${c.nachname}, ${c.vorname} (${c.quelle})`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    if (sel.value === '') {
      current = blankCandidate();
      document.getElementById('reference').classList.add('hidden');
    } else {
      const c = candidates[Number(sel.value)];
      current = {
        vorname: c.vorname, nachname: c.nachname, geschlecht: c.geschlecht, alter: c.alter,
        schulabschluss: c.schulabschluss, berufsabschluss: c.berufsabschluss,
        qualifikationsstufe: c.qualifikationsstufe,
        berufserfahrung: null, // nicht im Datensatz
        fehlzeiten: c.fehlzeiten ?? 0, gehaltEinstieg: c.gehaltEinstieg
      };
      showReference(c);
    }
    buildInputs();
    render();
  });
}

// --- Reset -----------------------------------------------------------------
document.getElementById('reset-weights').addEventListener('click', () => {
  config = defaultConfig(); saveConfig();
  buildWeightControls(); buildInputs(); render();
});

// --- Initialisierung -------------------------------------------------------
async function init() {
  buildInputs();
  buildWeightControls();
  render();
  try {
    const res = await fetch('data/candidates.json');
    const raw = await res.json();
    // kompakte Schlüssel (Speicherersparnis) auf sprechende Felder expandieren
    const Q = { T: 'Testdaten', Z: 'Zusatzinfos' };
    candidates = raw.map(c => ({
      quelle: Q[c.q] || c.q, nachname: c.nn, vorname: c.vn, geschlecht: c.g, alter: c.al,
      schulabschluss: c.sa, berufsabschluss: c.ba, qualifikationsstufe: c.qs,
      fehlzeiten: c.fz, gehaltEinstieg: c.ge, gehaltAktuell: c.ga,
      betriebszugehoerigkeit: c.bz, gekuendigt: !!c.k
    }));
    fillDatasetSelect();
  } catch (e) {
    console.warn('Datensatz konnte nicht geladen werden:', e);
  }
}
init();
