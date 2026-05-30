# HR Eignungs-Score

Ein leichtgewichtiges, **transparentes** Tool zur Unterstützung der Bewerberauswahl
im Recruiting. Es berechnet aus qualifikations- und leistungsbezogenen Merkmalen
einen prozentualen **Eignungs-Score** (0–100 %) und gibt eine Einstellungs-Empfehlung.

> Entscheidungs**hilfe**, kein Automat: Die finale Entscheidung trifft immer ein Mensch.

## Ansatz: gewichtete Formel statt Black-Box-KI

Bewusst **keine** undurchsichtige KI, sondern eine nachvollziehbare Formel. Jeder
Faktor wird auf einen Teilscore `0..1` normalisiert (1 = optimal). Der Gesamtscore
ist der gewichtete Durchschnitt aller aktiven Faktoren:

```
score = Σ(gewicht_i · teilscore_i) / Σ(gewicht_i) · 100 %
```

Vorteile gerade im HR-Kontext:

- **Erklärbar** – jeder Score lässt sich Faktor für Faktor begründen (DSGVO Art. 22, AGG).
- **Kontrollierbar** – HR steuert selbst, welche Merkmale wie stark zählen.

## Ethische Schutzmechanismen

- **Geschützte Merkmale** (Name, Geschlecht, Alter) fließen **nie** in den Score ein.
  Sie werden nur informativ angezeigt und sind klar als nicht bewertet gekennzeichnet.
- **Jeder Faktor abschaltbar** + Gewicht 0–10 frei einstellbar.
- **Gehaltsvorstellung** ist als Kriterium standardmäßig deaktiviert und mit einem
  Ethik-Hinweis versehen (Bewerber nach Kosten zu bewerten benachteiligt Qualifizierte).
- **Realitäts-Check**: Bei Kandidaten aus dem Datensatz wird der tatsächliche spätere
  Werdegang (Gehaltsentwicklung, Betriebszugehörigkeit, Kündigung) angezeigt – das Tool
  macht transparent, dass Eignung sich nicht vollständig vorhersagen lässt.

## Bedienung

Die App startet mit vier Bereichen (Kacheln auf der Startseite):

1. **Bewerber bewerten** – Angaben eines neuen Bewerbers eingeben; Score, Empfehlung und
   Faktor-Aufschlüsselung aktualisieren sich live.
2. **Gewichtung anpassen** – pro Kriterium Gewicht (0–10) und Ein/Aus einstellen
   (wird lokal im Browser gespeichert).
3. **Datensätze ansehen** – alle vorhandenen Personen mit ihrem berechneten Score
   (feste Werte, nicht editierbar), sortier- und durchsuchbar.
4. **Formel erklärt** – Schritt-für-Schritt-Erläuterung inkl. der Teilscore-Tabellen
   und einem Rechenbeispiel.

## Technik & Deployment

Reine statische Single-Page-App (HTML/CSS/Vanilla-JS), **kein Build-Schritt**.

- `index.html`, `styles.css`, `app.js`
- `data/candidates.json` – aus den beiden Excel-Datensätzen konvertierte Bewerberdaten

### Vercel

Als statisches Projekt direkt deploybar – Vercel liefert `index.html` aus dem
Repo-Root automatisch aus. Keine zusätzliche Konfiguration nötig.

Lokal testen:

```bash
npx serve .       # oder: python3 -m http.server
```
