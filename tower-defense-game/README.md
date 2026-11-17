# 🗼 Turmverteidigung – Das dunkle Tal

Ein kostenloses HTML5-Tower-Defense-Browsergame (reines Vanilla JS + Canvas, **keine Abhängigkeiten, kein Build-Schritt**).
Gegner ziehen auf einem festen Weg durch das dunkle Tal zur Burg – baue Türme auf freien Feldern,
upgrade sie und halte so viele Wellen wie möglich durch. Rekord wird lokal im `localStorage` gespeichert.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Einstiegspunkt, Werbe-Slot-Platzhalter (oben/unten) |
| `style.css` | Dark-Fantasy-Theme (gleiches Design wie `nekromanten-game/`) |
| `game.js` | komplette Spiellogik: Karte/Pfad, Türme, Gegner, Wellen, Projektile, Shop, Rekord, Sounds |

## Steuerung

- **Turm bauen:** Turmkarte rechts anklicken (oder Taste `1`/`2`/`3`), dann auf ein freies Feld klicken
- **Turm auswählen:** Klick auf einen gebauten Turm → Upgrade / Verkaufen im Detail-Panel
- **Rechtsklick / Esc:** Auswahl aufheben
- **▶ Welle starten** oder **Leertaste:** nächste Welle beginnen
- **P:** Pause (automatisch auch beim Tab-Wechsel)
- **1×/2×-Button:** Spielgeschwindigkeit umschalten
- **🗑:** Rekord löschen und neu starten

## Spielprinzip

- Währung: **Gold** 🪙 (Start: 170) – Belohnung pro Kill + Wellen-Bonus (`20 + 5 × Welle`)
- **Leben** ❤️ (Start: 20) – jeder Gegner, der die Burg erreicht, kostet Leben (Bosse 5)
- Turmtypen: **Pfeilturm** (schnell, günstig), **Kanonenturm** (Flächenschaden), **Frostturm** (verlangsamt)
- Türme haben 3 Stufen (Upgrade = 75 % × Stufe des Grundpreises, +55 % Schaden pro Stufe)
- Gegnertypen: Kriecher, Flinkling (ab Welle 2), Panzer (ab Welle 4), Dämonenlord-Boss (jede 5. Welle)
- Gegner-HP skaliert mit der Welle (`hpMult` in `game.js`)

## Lokal starten

Einfach `index.html` im Browser öffnen (Doppelklick) – oder lokal servieren:

```bash
cd tower-defense-game
python3 -m http.server 8000
# dann http://localhost:8000 aufrufen
```

## Auf eigener Website hosten

Das Spiel ist statisch – lade die drei Dateien per FTP/SFTP auf deinen Webspace (z. B. in einen Ordner
`/turmverteidigung/`) und rufe `index.html` direkt auf. Kostenlose Alternativen:
GitHub Pages, Netlify, Vercel, Cloudflare Pages – dort reicht es, den Ordner zu deployen.

## Monetarisierung per Werbung

In `index.html` sind zwei Platzhalter (`#ad-top`, `#ad-bottom`) mit einem kommentierten
Google-AdSense-Beispiel markiert. Eigene Publisher-ID und Slot-ID eintragen – fertig.
DSGVO: Werbe-Skripte in der EU **erst nach Einwilligung** laden (CMP mit IAB-TCF-Unterstützung).

## Anpassungen

- Balancing (Kosten, HP, Schaden, Reichweite, Wellen-Stärke): Konstanten oben in `game.js`
  (`TOWER_TYPES`, `ENEMY_TYPES`, `hpMult`, `buildWave`, `defaultState`).
- Karte/Pfad: `PATH` und `WAYPOINTS` oben in `game.js` anpassen (Gitter 20 × 11 à 48 px).
- Rekord zurücksetzen: Button 🗑 oben rechts (löscht `localStorage`).

## Lizenz

Freie Nutzung für dein eigenes Projekt. Viel Erfolg beim Verteidigen des Tals! 🏰
