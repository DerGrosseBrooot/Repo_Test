# ⚰ Nekromant – Das dunkle Reich

Ein kostenloses HTML5-Browsergame (reines Vanilla JS + Canvas, **keine Abhängigkeiten, kein Build-Schritt**).
Du spielst einen Nekromanten: Klicke auf das Spielfeld, um Mana zu sammeln, beschwöre eine Skelett-Armee und
verteidige dein Reich gegen immer stärkere Wellen von Helden. Belohnungen: **Seelen** (💀) und **Gold** (🪙).

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Einstiegspunkt, Werbe-Slot-Platzhalter (oben/unten) |
| `style.css` | Dark-Fantasy-Theme |
| `game.js` | komplette Spiellogik, Kampf, Shop, Speichern (localStorage), Ad-Hook |

## Steuerung

- **Klick auf das Spielfeld:** Mana sammeln (gelegentlich kritische 5x-Klicks)
- **⏸-Button oder Taste P / Leertaste:** Pause – automatisch auch beim Tab-Wechsel
- Shop rechts: Beschwörungen (Mana), Upgrades (Gold), Dunkle Mächte (Seelen)

## Lokal starten

Einfach `index.html` im Browser öffnen (Doppelklick) – oder lokal servieren:

```bash
cd nekromanten-game
python3 -m http.server 8000
# dann http://localhost:8000 aufrufen
```

## Auf eigener Website hosten

Das Spiel ist statisch – lade die drei Dateien per FTP/SFTP auf deinen Webspace (z. B. in einen Ordner
`/nekromant/`) und binde `index.html` ein oder rufe sie direkt auf. Kostenlose Alternativen:
GitHub Pages, Netlify, Vercel, Cloudflare Pages – dort reicht es, den Ordner zu deployen.

## Spielprinzip (Click-Monetarisierung)

- Jeder Klick auf das Spielfeld erzeugt Mana → je mehr geklickt wird, desto schneller wächst die Armee.
- Klicks sind damit die zentrale "Währung" des Spiels: aktive Spieler sehen mehr Werbeflächen und
  klicken öfter – das ist die Grundlage für Klick-basierte Monetarisierung (Ad-Impressions skalieren mit
  der Spielzeit/Klickzahl).
- Belohnungssystem motiviert zum Weiterspielen: Wellen-Belohnungen (Seelen/Gold), Upgrades,
  Offline-Mana, Speicherstand via `localStorage`.

## Monetarisierung per Werbung

### 1. Banner (oben/unten)
In `index.html` sind zwei Platzhalter (`#ad-top`, `#ad-bottom`) mit einem kommentierten
Google-AdSense-Beispiel markiert. Eigene Publisher-ID und Slot-ID eintragen – fertig.

### 2. Rewarded Ad („🎁 Werbung ansehen → 2× Seelen")
Der Button oben rechts ruft `requestRewardedAd()` in `game.js` auf.
- `AD_CONFIG.demoMode = true` (Auslieferung): simuliert die Werbung lokal mit Countdown.
- `AD_CONFIG.demoMode = false`: hier deinen echten Rewarded Ad einhängen
  (Code-Beispiel für Google AdSense Rewarded Ads steht als Kommentar oben in `game.js`).
  Bei Erfolg `grantAdReward()` aufrufen – das vergibt die Seelen und setzt den Cooldown
  (`rewardCooldownSec`, Standard 60 s).

### 3. DSGVO / EU
Werbe-Skripte (AdSense etc.) in der EU **erst nach Einwilligung** laden – am besten über ein
Consent-Management-Plattform (CMP) mit IAB-TCF-Unterstützung (z. B. Consentmanager, Usercentrics,
oder AdSense-eigenes Consent-Signal). Dafür im `index.html` das AdSense-Script erst nach Consent-Event laden.

## Anpassungen

- Balancing (Kosten, HP, Schaden, Wellen-Stärke): Konstanten oben in `game.js`
  (`SUMMONS`, `UPGRADES`, `SOUL_UPGRADES`, `HERO_TYPES`, `startWave()`).
- Werbe-Belohnung: `AD_CONFIG` in `game.js`.
- Speicherstand zurücksetzen: Button 🗑 oben rechts (löscht `localStorage`).

## Lizenz

Freie Nutzung für dein eigenes Projekt. Viel Erfolg mit dem Spiel! 🦴
