'use strict';

/* =====================================================================
   NEKROMANT – DAS DUNKE REICH
   Reines Vanilla-JS HTML5-Spiel (Canvas). Kein Build, keine Abhängigkeiten.
   ===================================================================== */

/* ---------------- Monetarisierung: Konfiguration ----------------
   AD_CONFIG steuert die Rewarded Ad ("Werbung ansehen -> 2x Seelen").

   demoMode: true  -> simuliert die Werbung lokal (Countdown im Modal).
   demoMode: false -> hier echte Werbeanbieter einhängen, z. B. Google AdSense
                      Rewarded Ads (googletag / slotRewarded) oder AdMob for Web.

   Beispiel AdSense (Auszug – Details siehe Google-Doku):
     // index.html: AdSense-Script mit deiner Publisher-ID laden
     // dann in requestRewardedAd():
     //   googletag.cmd.push(function () {
     //     googletag.pubads().enableAsyncRendering();
     //     slot = googletag.defineOutOfPageSlot('/DEINE_PUB_ID/rewarded', ...)
     //               .addService(googletag.pubads());
     //     googletag.display(slot);
     //   });
     //   googletag.pubads().addEventListener('rewardedSlotReady', (e) => e.makeRewardedVisible());
     //   googletag.pubads().addEventListener('rewardedSlotReward', grantAdReward);
   DSGVO: Werbe-Skripte in der EU erst nach Consent laden (CMP mit IAB TCF).
   ===================================================================== */
const AD_CONFIG = {
  demoMode: true,
  rewardCooldownSec: 60,
  demoDurationSec: 5,
  soulsPerWave: 5,        // Basis-Belohnung: max(10, Welle * soulsPerWave)
  rewardMultiplier: 2,    // x2 durch Werbung
};

const SAVE_KEY = 'nekromant_save_v1';
const W = 960, H = 480;
const GROUND_Y = H - 90;
const NEC_X = 95;
const SPAWN_X = 170;
const MELEE_RANGE = 48;

/* ---------------- Spielzustand ---------------- */
const defaultState = () => ({
  mana: 30,
  souls: 0,
  gold: 0,
  wave: 1,
  necHp: 100,
  counts: { skeleton: 0, warrior: 0, archer: 0, knight: 0 },
  upgrades: { click: 0, dmg: 0, hp: 0, regen: 0, necHp: 0 },
  soulUpgrades: { pact: 0, crit: 0, vamp: 0 },
  muted: false,
  adCooldownUntil: 0,
  lastSeen: Date.now(),
});
let state = defaultState();

/* ---------------- Abgeleitete Werte ---------------- */
const pactMult = () => 1 + 0.10 * state.soulUpgrades.pact;
const clickPower = () => (2 + state.upgrades.click) * pactMult();
const critChance = () => 0.05 + 0.05 * state.soulUpgrades.crit;
const skelDmgMult = () => (1 + 0.10 * state.soulUpgrades.pact);
const skelHpMult = () => (1 + 0.10 * state.soulUpgrades.pact);
const manaRegen = () => 0.5 + 0.5 * state.upgrades.regen;
const necMaxHp = () => 100 + 50 * state.upgrades.necHp;
const vampHeal = () => state.soulUpgrades.vamp; // Leben pro Kill

/* ---------------- Beschwörungen ---------------- */
const SUMMONS = [
  { id: 'skeleton', name: 'Skelett',              desc: 'Billig & flink',        baseCost: 25,   costMult: 1.13, hp: 40,  dmg: 6,  speed: 26, atkCd: 0.9, color: '#e8e8e8', icon: '🦴' },
  { id: 'warrior',  name: 'Skelett-Krieger',      desc: 'Zäher Nahkämpfer',      baseCost: 150,  costMult: 1.15, hp: 110, dmg: 15, speed: 22, atkCd: 1.1, color: '#b9c2d6', icon: '⚔️' },
  { id: 'archer',   name: 'Skelett-Bogenschütze', desc: 'Angriff aus der Distanz', baseCost: 400, costMult: 1.16, hp: 35, dmg: 11, speed: 30, atkCd: 1.6, range: 180, ranged: true, color: '#9fd18b', icon: '🏹' },
  { id: 'knight',   name: 'Todesritter',         desc: 'Schwerer Boss-Killer',  baseCost: 1200, costMult: 1.18, hp: 260, dmg: 44, speed: 16, atkCd: 1.4, color: '#9b86e8', icon: '🐴' },
];
const summonCost = (s) => Math.ceil(s.baseCost * Math.pow(s.costMult, state.counts[s.id]));

/* ---------------- Gold-Upgrades ---------------- */
const UPGRADES = [
  { id: 'click', name: 'Manaklick',        desc: '+1 Mana pro Klick',                  base: 15, mult: 2.2, currency: 'gold', icon: '🔮' },
  { id: 'dmg',   name: 'Klingen der Toten', desc: '+3 Schaden pro Skelett',            base: 25, mult: 2.4, currency: 'gold', icon: '🗡️' },
  { id: 'hp',    name: 'Knochenpanzer',    desc: '+20 Leben pro Skelett',              base: 25, mult: 2.4, currency: 'gold', icon: '🛡️' },
  { id: 'regen', name: 'Manaquelle',       desc: '+0,5 Mana pro Sekunde',             base: 20, mult: 2.3, currency: 'gold', icon: '💧' },
  { id: 'necHp', name: 'Lebenskraft',      desc: '+50 max. Leben des Nekromanten',    base: 30, mult: 2.5, currency: 'gold', icon: '❤️' },
];
const upgradeCost = (u) => Math.ceil(u.base * Math.pow(u.mult, state.upgrades[u.id]));

/* ---------------- Seelen-Upgrades (permanent, stärker) ---------------- */
const SOUL_UPGRADES = [
  { id: 'pact', name: 'Dunkler Pakt',   desc: '+10% Schaden & Klickkraft (permanent)', base: 10, mult: 2.0, icon: '🌑' },
  { id: 'crit', name: 'Tödlicher Griff', desc: '+5% Chance auf 5x-Klick',              base: 12, mult: 2.2, icon: '🎯' },
  { id: 'vamp', name: 'Blutdurst',      desc: '+1 Leben pro getötetem Helden',          base: 15, mult: 2.4, icon: '🩸' },
];
const soulCost = (u) => Math.ceil(u.base * Math.pow(u.mult, state.soulUpgrades[u.id]));

/* ---------------- Helden-Typen ---------------- */
const HERO_TYPES = [
  { name: 'Ritter',  hpMult: 1.0, dmgMult: 1.0, speed: [18, 26], color: '#c0c8d8', souls: 1, minWave: 1, icon: '🛡️' },
  { name: 'Paladin', hpMult: 2.3, dmgMult: 0.8, speed: [13, 19], color: '#e8d878', souls: 2, minWave: 3, icon: '✨' },
  { name: 'Magier',  hpMult: 0.7, dmgMult: 1.9, speed: [20, 28], color: '#d87bd8', souls: 2, minWave: 5, icon: '🔥' },
];

/* ---------------- Laufzeitdaten ---------------- */
let skeletons = [];
let heroes = [];
let arrows = [];
let floats = [];
let particles = [];
let waveActive = false;
let waveTimer = 2.5;
let spawnQueue = 0;
let spawnTimer = 0;
let shake = 0;
let banner = null; // {text, life}
let gameOver = false;
let paused = false;
let animT = 0;          // globale Animationszeit (friert in Pause ein)
let lightning = 0;      // Blitz-Flash
let lightningTimer = 5;
let boltX = 500;
let necAura = 0;
let bgCache = null;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

/* ---------------- Sound (WebAudio, ohne Dateien) ---------------- */
let audioCtx = null;
function beep(freq, dur, type = 'square', vol = 0.05, slide = 0) {
  if (state.muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* Audio nicht verfügbar – ignorieren */ }
}
const sfx = {
  click: () => beep(520, 0.06, 'square', 0.04, 120),
  crit:  () => beep(880, 0.12, 'sawtooth', 0.06, 300),
  summon:() => beep(160, 0.25, 'sine', 0.08, -80),
  hit:   () => beep(220, 0.05, 'square', 0.025, -60),
  die:   () => beep(120, 0.3, 'sawtooth', 0.06, -90),
  wave:  () => beep(330, 0.4, 'triangle', 0.07, 110),
  buy:   () => beep(660, 0.08, 'triangle', 0.05, 80),
  over:  () => beep(90, 0.8, 'sawtooth', 0.08, -50),
  pause: () => beep(440, 0.1, 'triangle', 0.05, -100),
};

/* ---------------- Speichern / Laden ---------------- */
function save() {
  state.lastSeen = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* privatmodus etc. */ }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    state = Object.assign(defaultState(), s);
    state.upgrades = Object.assign(defaultState().upgrades, s.upgrades || {});
    state.soulUpgrades = Object.assign(defaultState().soulUpgrades, s.soulUpgrades || {});
    state.counts = Object.assign(defaultState().counts, s.counts || {});
    state.necHp = Math.min(Math.max(state.necHp, 1), necMaxHp());
    // Offline-Fortschritt: 50% Mana-Regeneration, max. 8h
    const dt = Math.min((Date.now() - (s.lastSeen || Date.now())) / 1000, 8 * 3600);
    const gained = Math.floor(manaRegen() * dt * 0.5);
    if (gained > 0) {
      state.mana += gained;
      setTimeout(() => toast(`🌙 Während deiner Abwesenheit: +${gained} Mana`), 600);
    }
  } catch (e) { /* korrupter Save – neu starten */ }
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.classList.add('hidden'), 350); }, 2600);
}

/* ---------------- Pause ---------------- */
function setPaused(p) {
  if (gameOver) return;
  paused = p;
  document.getElementById('btn-pause').textContent = paused ? '▶' : '⏸';
}
function togglePause() {
  if (gameOver) return;
  setPaused(!paused);
  sfx.pause();
}

/* ---------------- Welle starten ---------------- */
function heroCountForWave(w) { return 2 + w; }
function startWave() {
  waveActive = true;
  spawnQueue = heroCountForWave(state.wave);
  spawnTimer = 0;
  banner = { text: '🌊 Welle ' + state.wave, life: 2.2 };
  sfx.wave();
}
function spawnHero() {
  const w = state.wave;
  const pool = HERO_TYPES.filter((t) => t.minWave <= w);
  const t = pool[Math.floor(Math.random() * pool.length)];
  const hp = Math.round(25 * Math.pow(1.32, w - 1) * t.hpMult);
  heroes.push({
    x: W + 40 + Math.random() * 60,
    hp, maxHp: hp,
    dmg: Math.round(4 * Math.pow(1.24, w - 1) * t.dmgMult),
    speed: t.speed[0] + Math.random() * (t.speed[1] - t.speed[0]),
    atkCd: 0,
    color: t.color, name: t.name, icon: t.icon,
    souls: t.souls + Math.floor(w / 3),
    gold: Math.round((3 + w * 1.5) * (0.8 + Math.random() * 0.4)),
    phase: Math.random() * Math.PI * 2, flash: 0, lunge: 0,
  });
}

/* ---------------- Beschwören ---------------- */
function summon(id) {
  const s = SUMMONS.find((x) => x.id === id);
  const cost = summonCost(s);
  if (state.mana < cost) { toast('Nicht genug Mana!'); return; }
  state.mana -= cost;
  state.counts[id]++;
  const hp = Math.round(s.hp * skelHpMult());
  skeletons.push({
    x: SPAWN_X + Math.random() * 30,
    hp, maxHp: hp,
    dmg: Math.round(s.dmg * skelDmgMult()),
    speed: s.speed, atkCd: 0,
    range: s.range || MELEE_RANGE,
    ranged: !!s.ranged,
    color: s.color, type: s.id,
    phase: Math.random() * Math.PI * 2, flash: 0, lunge: 0,
  });
  sfx.summon();
  burst(SPAWN_X + 20, GROUND_Y - 40, '#b28bff', 12);
  save();
}

function buyUpgrade(u) {
  const cost = upgradeCost(u);
  if (state.gold < cost) { toast('Nicht genug Gold!'); return; }
  state.gold -= cost;
  state.upgrades[u.id]++;
  if (u.id === 'necHp') state.necHp = Math.min(necMaxHp(), state.necHp + 50);
  sfx.buy();
  toast(`${u.icon} ${u.name} verbessert!`);
  save();
}

function buySoulUpgrade(u) {
  const cost = soulCost(u);
  if (state.souls < cost) { toast('Nicht genug Seelen!'); return; }
  state.souls -= cost;
  state.soulUpgrades[u.id]++;
  sfx.buy();
  toast(`${u.icon} ${u.name} erworben!`);
  save();
}

/* ---------------- Kampf-Update ---------------- */
function addFloat(x, y, text, color) {
  floats.push({ x, y, text, color, life: 1.0 });
}
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 140,
      vy: -Math.random() * 130 - 30,
      life: 0.6 + Math.random() * 0.4,
      color,
      r: 1.5 + Math.random() * 2.5,
    });
  }
}

function updateCombat(dt) {
  // Mana-Regeneration
  state.mana += manaRegen() * dt;
  // Nekromanten-Regeneration
  state.necHp = Math.min(necMaxHp(), state.necHp + 0.4 * dt);

  // Ambiente: Blitz + Aura des Nekromanten
  lightningTimer -= dt;
  if (lightningTimer <= 0) {
    lightningTimer = 6 + Math.random() * 9;
    lightning = 0.14;
    boltX = 80 + Math.random() * (W - 160);
  }
  if (lightning > 0) lightning -= dt;
  necAura -= dt;
  if (necAura <= 0) {
    necAura = 0.22;
    particles.push({
      x: NEC_X + (Math.random() - 0.5) * 44,
      y: GROUND_Y - 15 - Math.random() * 70,
      vx: (Math.random() - 0.5) * 10,
      vy: -16 - Math.random() * 16,
      life: 1.1,
      color: 'rgba(55,224,139,0.75)',
      r: 1.5 + Math.random(),
    });
  }

  // Welle spawnen / beenden
  if (!waveActive && !gameOver) {
    waveTimer -= dt;
    if (waveTimer <= 0) startWave();
  }
  if (waveActive && spawnQueue > 0) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = Math.max(0.35, 1.15 - state.wave * 0.03);
      spawnQueue--;
      spawnHero();
    }
  }
  if (waveActive && spawnQueue === 0 && heroes.length === 0) {
    waveActive = false;
    state.wave++;
    waveTimer = 3;
    banner = { text: '✅ Welle ' + (state.wave - 1) + ' geschafft!', life: 2.2 };
    toast(`Welle ${state.wave - 1} besiegt! Nächste Welle: ${state.wave}`);
    save();
  }

  // Skelette bewegen/angreifen
  for (const sk of skeletons) {
    sk.atkCd -= dt;
    if (sk.flash > 0) sk.flash -= dt;
    if (sk.lunge > 0) sk.lunge -= dt;
    const target = heroes.filter((h) => h.x > sk.x - 20).sort((a, b) => a.x - b.x)[0];
    if (target && target.x - sk.x <= sk.range) {
      if (sk.atkCd <= 0) {
        sk.atkCd = sk.ranged ? 1.6 : (sk.type === 'knight' ? 1.4 : sk.type === 'warrior' ? 1.1 : 0.9);
        sk.lunge = 0.18;
        if (sk.ranged) {
          arrows.push({ x: sk.x + 10, y: GROUND_Y - 52, target, dmg: sk.dmg, speed: 320 });
        } else {
          target.hp -= sk.dmg;
          target.flash = 0.12;
          sfx.hit();
          addFloat(target.x, GROUND_Y - 84, '-' + sk.dmg, '#ffd257');
          burst(target.x, GROUND_Y - 50, '#ff8080', 5);
        }
      }
    } else {
      sk.x += sk.speed * dt;
    }
  }

  // Helden bewegen/angreifen
  for (const h of heroes) {
    h.atkCd -= dt;
    if (h.flash > 0) h.flash -= dt;
    if (h.lunge > 0) h.lunge -= dt;
    const target = skeletons.filter((s) => s.x < h.x + 20).sort((a, b) => b.x - a.x)[0];
    if (target && h.x - target.x <= MELEE_RANGE + 6) {
      if (h.atkCd <= 0) {
        h.atkCd = 1.0;
        h.lunge = 0.18;
        target.hp -= h.dmg;
        target.flash = 0.12;
        sfx.hit();
        addFloat(target.x, GROUND_Y - 84, '-' + h.dmg, '#ff9aa8');
        burst(target.x, GROUND_Y - 50, '#c0c8d8', 5);
      }
    } else if (!target && h.x <= NEC_X + 46) {
      if (h.atkCd <= 0) {
        h.atkCd = 1.0;
        h.lunge = 0.18;
        state.necHp -= h.dmg;
        shake = 8;
        sfx.hit();
        addFloat(NEC_X, GROUND_Y - 110, '-' + h.dmg, '#ff6b7a');
        burst(NEC_X + 10, GROUND_Y - 60, '#ff6b7a', 8);
        if (state.necHp <= 0 && !gameOver) triggerGameOver();
      }
    } else {
      h.x -= h.speed * dt;
      if (h.x < NEC_X + 46) h.x = NEC_X + 46;
    }
  }

  // Tote Helden einsammeln
  for (let i = heroes.length - 1; i >= 0; i--) {
    if (heroes[i].hp <= 0) {
      const h = heroes[i];
      heroes.splice(i, 1);
      state.souls += h.souls;
      state.gold += h.gold;
      state.necHp = Math.min(necMaxHp(), state.necHp + vampHeal());
      sfx.die();
      addFloat(h.x, GROUND_Y - 90, `+${h.souls}💀 +${h.gold}🪙`, '#b28bff');
      burst(h.x, GROUND_Y - 50, h.color, 16);
    }
  }
  // Tote Skelette entfernen
  for (let i = skeletons.length - 1; i >= 0; i--) {
    if (skeletons[i].hp <= 0) {
      burst(skeletons[i].x, GROUND_Y - 45, '#e8e8e8', 12);
      skeletons.splice(i, 1);
    }
  }
  // Counts präzise neu zählen (Basis für die Beschwörungskosten)
  const c = { skeleton: 0, warrior: 0, archer: 0, knight: 0 };
  for (const s of skeletons) c[s.type] = (c[s.type] || 0) + 1;
  state.counts = c;

  // Pfeile
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (!heroes.includes(a.target)) { arrows.splice(i, 1); continue; }
    const dx = a.target.x - a.x;
    const step = a.speed * dt;
    if (Math.abs(dx) <= step + 6) {
      a.target.hp -= a.dmg;
      a.target.flash = 0.12;
      addFloat(a.target.x, GROUND_Y - 84, '-' + a.dmg, '#9fd18b');
      burst(a.target.x, GROUND_Y - 52, '#9fd18b', 4);
      arrows.splice(i, 1);
    } else {
      a.x += Math.sign(dx) * step;
    }
  }

  // Effekte
  for (let i = floats.length - 1; i >= 0; i--) {
    floats[i].y -= 34 * dt;
    floats[i].life -= dt * 0.9;
    if (floats[i].life <= 0) floats.splice(i, 1);
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 300 * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  if (banner) { banner.life -= dt; if (banner.life <= 0) banner = null; }
  if (shake > 0) shake = Math.max(0, shake - 40 * dt);
}

function triggerGameOver() {
  gameOver = true;
  state.necHp = 0;
  sfx.over();
  document.getElementById('go-wave').textContent = state.wave;
  document.getElementById('gameover').classList.remove('hidden');
  save();
}
function revive() {
  gameOver = false;
  skeletons = [];
  heroes = [];
  arrows = [];
  state.counts = { skeleton: 0, warrior: 0, archer: 0, knight: 0 };
  state.necHp = necMaxHp();
  waveActive = false;
  waveTimer = 2;
  document.getElementById('gameover').classList.add('hidden');
  toast('⚰ Du wurdest wiederbelebt. Die gleiche Welle erwartet dich!');
  save();
}

/* ---------------- Hintergrund (wird einmal in ein Offscreen-Canvas gezeichnet) ---------------- */
function buildBackground() {
  bgCache = document.createElement('canvas');
  bgCache.width = W;
  bgCache.height = H;
  const b = bgCache.getContext('2d');

  // Himmel
  const sky = b.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0a0616');
  sky.addColorStop(0.55, '#1c1130');
  sky.addColorStop(0.8, '#241539');
  sky.addColorStop(1, '#120b1e');
  b.fillStyle = sky;
  b.fillRect(0, 0, W, H);

  // Sterne
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H * 0.55;
    const r = 0.4 + Math.random() * 1.4;
    b.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.6})`;
    b.beginPath(); b.arc(x, y, r, 0, Math.PI * 2); b.fill();
  }

  // Mond mit Glow + Krater
  const mg = b.createRadialGradient(W - 130, 85, 10, W - 130, 85, 95);
  mg.addColorStop(0, 'rgba(240,230,200,0.85)');
  mg.addColorStop(0.35, 'rgba(230,215,180,0.30)');
  mg.addColorStop(1, 'rgba(230,215,180,0)');
  b.fillStyle = mg;
  b.beginPath(); b.arc(W - 130, 85, 95, 0, Math.PI * 2); b.fill();
  b.fillStyle = '#efe6c8';
  b.beginPath(); b.arc(W - 130, 85, 32, 0, Math.PI * 2); b.fill();
  b.fillStyle = 'rgba(160,150,130,0.45)';
  b.beginPath(); b.arc(W - 140, 78, 7, 0, Math.PI * 2); b.fill();
  b.beginPath(); b.arc(W - 120, 95, 5, 0, Math.PI * 2); b.fill();
  b.beginPath(); b.arc(W - 128, 70, 4, 0, Math.PI * 2); b.fill();

  // Ferne Hügel
  b.fillStyle = '#150e22';
  b.beginPath();
  b.moveTo(0, GROUND_Y - 60);
  b.quadraticCurveTo(200, GROUND_Y - 130, 430, GROUND_Y - 70);
  b.quadraticCurveTo(650, GROUND_Y - 120, W, GROUND_Y - 55);
  b.lineTo(W, GROUND_Y); b.lineTo(0, GROUND_Y);
  b.fill();

  // Burgruine als Silhouette
  const cx = 300, cy = GROUND_Y - 118;
  b.fillStyle = '#1c1230';
  b.fillRect(cx - 60, cy, 120, 118);                       // Hauptbau
  b.fillRect(cx - 78, cy + 30, 22, 88);                     // linker Turm
  b.fillRect(cx + 56, cy + 30, 22, 88);                     // rechter Turm
  b.beginPath(); b.moveTo(cx - 80, cy + 30); b.lineTo(cx - 67, cy - 2); b.lineTo(cx - 54, cy + 30); b.fill();
  b.beginPath(); b.moveTo(cx + 54, cy + 30); b.lineTo(cx + 67, cy - 2); b.lineTo(cx + 80, cy + 30); b.fill();
  for (let i = 0; i < 6; i++) b.fillRect(cx - 60 + i * 22, cy - 8, 12, 10);  // Zinnen
  b.fillRect(cx + 95, cy + 45, 16, 73);                     // kaputter Turm
  b.beginPath(); b.moveTo(cx + 93, cy + 45); b.lineTo(cx + 103, cy + 28); b.lineTo(cx + 113, cy + 45); b.fill();
  // erleuchtete Fenster
  b.fillStyle = 'rgba(255,190,80,0.85)';
  b.fillRect(cx - 12, cy + 30, 6, 10);
  b.fillRect(cx + 6, cy + 55, 6, 10);
  b.fillRect(cx - 70, cy + 50, 5, 8);
  b.fillRect(cx + 62, cy + 50, 5, 8);

  // Nahe Hügel
  b.fillStyle = '#1b1229';
  b.beginPath();
  b.moveTo(0, GROUND_Y - 20);
  b.quadraticCurveTo(260, GROUND_Y - 70, 520, GROUND_Y - 25);
  b.quadraticCurveTo(760, GROUND_Y - 60, W, GROUND_Y - 18);
  b.lineTo(W, GROUND_Y); b.lineTo(0, GROUND_Y);
  b.fill();

  // Boden
  const gg = b.createLinearGradient(0, GROUND_Y, 0, H);
  gg.addColorStop(0, '#241a30');
  gg.addColorStop(1, '#120b18');
  b.fillStyle = gg;
  b.fillRect(0, GROUND_Y, W, H - GROUND_Y);

  // Risse, Steine, Knochen im Boden
  b.strokeStyle = 'rgba(0,0,0,0.35)';
  b.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * W;
    const y = GROUND_Y + 8 + Math.random() * (H - GROUND_Y - 16);
    b.beginPath();
    b.moveTo(x, y);
    b.lineTo(x + 12 + Math.random() * 20, y + (Math.random() - 0.5) * 8);
    b.stroke();
  }
  b.fillStyle = '#3a2c4d';
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * W;
    const y = GROUND_Y + 6 + Math.random() * (H - GROUND_Y - 12);
    b.beginPath(); b.ellipse(x, y, 3 + Math.random() * 4, 2 + Math.random() * 2, Math.random(), 0, Math.PI * 2); b.fill();
  }
  b.strokeStyle = '#cfc8b8';
  b.lineWidth = 2;
  [[150, 1], [700, -1], [840, 1]].forEach(([x, dir]) => {
    const y = GROUND_Y + 18 + Math.random() * 20;
    b.beginPath(); b.moveTo(x, y); b.lineTo(x + 16 * dir, y - 3); b.stroke();
    b.beginPath(); b.arc(x, y, 2.5, 0, Math.PI * 2); b.stroke();
  });

  // Leuchtender Runenkreis um den Nekromanten
  b.strokeStyle = 'rgba(55,224,139,0.5)';
  b.lineWidth = 2;
  b.beginPath(); b.ellipse(NEC_X, GROUND_Y + 8, 46, 10, 0, 0, Math.PI * 2); b.stroke();
  b.fillStyle = 'rgba(55,224,139,0.8)';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.fillRect(NEC_X + Math.cos(a) * 46 - 2, GROUND_Y + 8 + Math.sin(a) * 10 - 2, 4, 4);
  }

  // Nebelband
  const fg = b.createLinearGradient(0, GROUND_Y - 40, 0, GROUND_Y + 30);
  fg.addColorStop(0, 'rgba(140,110,200,0)');
  fg.addColorStop(0.5, 'rgba(140,110,200,0.10)');
  fg.addColorStop(1, 'rgba(140,110,200,0)');
  b.fillStyle = fg;
  b.fillRect(0, GROUND_Y - 40, W, 70);

  // Vignette
  const vg = b.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  b.fillStyle = vg;
  b.fillRect(0, 0, W, H);
}

/* ---------------- Zeichnen ---------------- */
function drawBackground() {
  ctx.drawImage(bgCache, 0, 0);
  // zwinkernde Sterne (dynamisch)
  for (let i = 0; i < 12; i++) {
    const x = (i * 197 + 40) % W;
    const y = (i * 61 + 15) % 190;
    const a = 0.25 + 0.55 * Math.abs(Math.sin(animT * 2 + i * 1.7));
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(x, y, 2, 2);
  }
  // driftender Nebel
  ctx.fillStyle = 'rgba(150,120,210,0.05)';
  const fx1 = ((animT * 14) % (W + 320)) - 160;
  const fx2 = W - ((animT * 9) % (W + 320)) + 160;
  ctx.beginPath(); ctx.ellipse(fx1, GROUND_Y - 6, 150, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(fx2, GROUND_Y + 14, 190, 18, 0, 0, Math.PI * 2); ctx.fill();
  // Blitz
  if (lightning > 0) {
    ctx.fillStyle = `rgba(200,220,255,${Math.min(0.35, lightning * 2.5)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = `rgba(230,240,255,${lightning * 6})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let bx = boltX, by = 0;
    ctx.moveTo(bx, by);
    while (by < GROUND_Y - 40) {
      by += 22 + Math.random() * 20;
      bx += (Math.random() - 0.5) * 46;
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }
}

function drawNecromancer() {
  const bob = Math.sin(animT * 2) * 3;
  const x = NEC_X, y = GROUND_Y + bob;
  ctx.save();
  ctx.translate(x, y);
  // Aura unter den Füßen
  ctx.fillStyle = 'rgba(55,224,139,0.12)';
  ctx.beginPath(); ctx.ellipse(0, 2 - bob, 34, 7, 0, 0, Math.PI * 2); ctx.fill();
  // Umhang mit wogendem Saum
  ctx.fillStyle = '#241536';
  ctx.beginPath();
  ctx.moveTo(-28, 0);
  ctx.quadraticCurveTo(-24, -60, -10, -90);
  ctx.lineTo(10, -90);
  ctx.quadraticCurveTo(24, -60, 28, 0);
  ctx.lineTo(20, 0);
  ctx.quadraticCurveTo(14, -6 + Math.sin(animT * 3) * 2, 0, 0);
  ctx.quadraticCurveTo(-14, -6 - Math.sin(animT * 3) * 2, -20, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3d2c5e';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Umhang-Verzierungen
  ctx.strokeStyle = 'rgba(178,139,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-14, -20); ctx.quadraticCurveTo(0, -30, 14, -20); ctx.stroke();
  // Kapuze
  ctx.fillStyle = '#2e1c46';
  ctx.beginPath(); ctx.arc(0, -96, 17, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#3d2c5e'; ctx.stroke();
  // Schädel im Kapuzenloch
  ctx.fillStyle = '#e8e0d0';
  ctx.beginPath(); ctx.arc(0, -94, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-4, -88, 8, 4); // Kiefer
  // glühende Augen
  ctx.fillStyle = '#37e08b';
  ctx.shadowColor = '#37e08b'; ctx.shadowBlur = 10;
  ctx.fillRect(-6, -97, 4, 4);
  ctx.fillRect(2, -97, 4, 4);
  ctx.shadowBlur = 0;
  // Stab mit pulsierendem Orb
  ctx.strokeStyle = '#5a4030';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(31, -112); ctx.stroke();
  const orbR = 7 + Math.sin(animT * 4) * 1.6;
  ctx.fillStyle = '#b28bff';
  ctx.shadowColor = '#b28bff'; ctx.shadowBlur = 18;
  ctx.beginPath(); ctx.arc(31, -118, orbR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(31 - orbR * 0.3, -118 - orbR * 0.3, orbR * 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // Lebensbalken
  drawBar(x - 32, y - 148, 64, state.necHp / necMaxHp(), '#ff6b7a');
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9a8bb8';
  ctx.fillText('Nekromant', x, y - 156);
}

function drawSkeleton(sk) {
  const ph = sk.phase + animT * 7;
  const bob = Math.abs(Math.sin(ph)) * 2;
  const swing = Math.sin(ph) * 3;
  const lunge = (sk.lunge > 0 ? sk.lunge / 0.18 : 0) * 10;
  const x = sk.x + lunge, y = GROUND_Y - bob;
  ctx.save();
  ctx.translate(x, y);
  const bone = sk.color;
  ctx.strokeStyle = bone;
  ctx.fillStyle = bone;
  ctx.lineCap = 'round';
  // Beine (leicht alternierend)
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-4 - swing * 0.5, -18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(4 + swing * 0.5, -18); ctx.stroke();
  // Becken + Wirbelsäule
  ctx.beginPath(); ctx.moveTo(-6, -18); ctx.lineTo(6, -18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(0, -36); ctx.stroke();
  // Rippen (Bögen)
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, -22 - i * 4.5, 5.5, Math.PI * 0.15, Math.PI * 0.85, false);
    ctx.stroke();
  }
  // Arme mit Schwung
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(10 + swing, -27); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(-8 - swing * 0.6, -28); ctx.stroke();
  // Schädel mit Kiefer und Augen
  ctx.beginPath(); ctx.arc(0, -43, 7.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-4, -39, 8, 3.5);
  ctx.fillStyle = '#120b1e';
  ctx.beginPath(); ctx.arc(-3, -45, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3, -45, 1.8, 0, Math.PI * 2); ctx.fill();
  // Typ-Details
  if (sk.type === 'warrior') {
    ctx.fillStyle = '#8890a8';
    ctx.beginPath(); ctx.arc(0, -46, 8, Math.PI, 0); ctx.fill();
    ctx.fillRect(-9, -47, 18, 3);
    ctx.strokeStyle = '#d8d8e8'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(10 + swing, -27); ctx.lineTo(18 + swing, -42); ctx.stroke();
  } else if (sk.type === 'knight') {
    ctx.fillStyle = '#5a3fb0';
    ctx.beginPath(); ctx.moveTo(-8, -50); ctx.lineTo(0, -62); ctx.lineTo(8, -50); ctx.fill();
    ctx.fillStyle = '#3a2a80';
    ctx.fillRect(-8, -51, 16, 4);
    ctx.strokeStyle = '#c8b8ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(10 + swing, -27); ctx.lineTo(22 + swing, -48); ctx.stroke();
    ctx.fillStyle = '#4a3a78';
    ctx.beginPath(); ctx.ellipse(-10 - swing * 0.6, -26, 5, 8, 0.2, 0, Math.PI * 2); ctx.fill();
  } else if (sk.type === 'archer') {
    ctx.fillStyle = '#3f6b34';
    ctx.beginPath(); ctx.arc(0, -45, 8.5, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
    ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-12 - swing * 0.5, -30, 9, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,220,200,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-21 - swing * 0.5, -30); ctx.lineTo(-3 - swing * 0.5, -30); ctx.stroke();
  }
  ctx.restore();
  // Treffer-Flash
  if (sk.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${sk.flash * 3})`;
    ctx.fillRect(x - 13, y - 72, 26, 72);
  }
  drawBar(x - 17, y - 64, 34, sk.hp / sk.maxHp, '#8fd0ff');
}

function drawHero(h) {
  const ph = h.phase + animT * 6;
  const bob = Math.abs(Math.sin(ph)) * 2;
  const swing = Math.sin(ph) * 4;
  const lunge = (h.lunge > 0 ? h.lunge / 0.18 : 0) * -12; // stoßen nach links
  const x = h.x + lunge, y = GROUND_Y - bob;
  ctx.save();
  ctx.translate(x, y);
  const isMage = h.name === 'Magier';
  const isPala = h.name === 'Paladin';
  // Beine
  ctx.strokeStyle = '#2e2e3c';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-5 - swing * 0.4, -20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(5 + swing * 0.4, -20); ctx.stroke();
  if (isMage) {
    // Roben-Magier
    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.moveTo(-10, -18);
    ctx.lineTo(0, -46);
    ctx.lineTo(10, -18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#8a4aa8'; ctx.lineWidth = 1.5; ctx.stroke();
    // Kapuze/Spitze
    ctx.beginPath(); ctx.moveTo(-8, -44); ctx.lineTo(0, -62); ctx.lineTo(8, -44); ctx.closePath(); ctx.fill();
    // Stab mit Orb
    ctx.strokeStyle = '#5a4030'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-12, -30); ctx.lineTo(-16, -58); ctx.stroke();
    ctx.fillStyle = '#d87bd8';
    ctx.shadowColor = '#d87bd8'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(-16, -62, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    // Rüstung (Ritter/Paladin)
    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.moveTo(-10, -20);
    ctx.lineTo(-9, -44);
    ctx.quadraticCurveTo(0, -48, 9, -44);
    ctx.lineTo(10, -20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (isPala) {
      ctx.fillStyle = 'rgba(255,240,180,0.35)';
      ctx.beginPath(); ctx.arc(0, -32, 16, 0, Math.PI * 2); ctx.fill();
    }
    // Kopf + Helm
    ctx.fillStyle = '#e8c8a0';
    ctx.beginPath(); ctx.arc(0, -50, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = h.color;
    ctx.beginPath(); ctx.arc(0, -52, 8, Math.PI, 0); ctx.fill();
    ctx.fillRect(-8, -53, 16, 3);
    // Helmfeder
    ctx.strokeStyle = isPala ? '#fff2b8' : '#d8d8e8';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -60); ctx.quadraticCurveTo(4, -68, 8, -66); ctx.stroke();
    // Schild (links)
    ctx.fillStyle = isPala ? '#d8b84a' : '#7a8296';
    ctx.beginPath();
    ctx.moveTo(-16, -42);
    ctx.lineTo(-24, -42);
    ctx.lineTo(-24, -26);
    ctx.quadraticCurveTo(-24, -20, -16, -20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
    // Waffe (rechts): Schwert bzw. Hammer
    ctx.strokeStyle = '#d8d8e8';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(10, -40); ctx.lineTo(20 + swing, -58 - swing); ctx.stroke();
    if (isPala) {
      ctx.fillStyle = '#e8e8f0';
      ctx.fillRect(18 + swing, -66 - swing, 12, 8);
    }
  }
  ctx.restore();
  // Treffer-Flash
  if (h.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${h.flash * 3})`;
    ctx.fillRect(x - 14, y - 76, 28, 76);
  }
  drawBar(x - 17, y - 74, 34, h.hp / h.maxHp, '#ff6b7a');
}

function drawBar(x, y, w, ratio, color) {
  ratio = Math.max(0, Math.min(1, ratio));
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x - 1, y - 1, w + 2, 8);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * ratio, 6);
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  drawBackground();
  drawNecromancer();
  // sortiert nach x für leichte Überlappung
  [...skeletons].sort((a, b) => a.x - b.x).forEach(drawSkeleton);
  [...heroes].sort((a, b) => a.x - b.x).forEach(drawHero);
  // Pfeile
  for (const a of arrows) {
    const dir = a.target && a.target.x >= a.x ? 1 : -1;
    ctx.strokeStyle = '#c8e8a0';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x - 10 * dir, a.y); ctx.lineTo(a.x + 6 * dir, a.y); ctx.stroke();
    ctx.fillStyle = '#e8f8c8';
    ctx.beginPath();
    ctx.moveTo(a.x + 9 * dir, a.y);
    ctx.lineTo(a.x + 2 * dir, a.y - 3.5);
    ctx.lineTo(a.x + 2 * dir, a.y + 3.5);
    ctx.closePath(); ctx.fill();
  }
  // Partikel
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r || 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Schwebende Texte (mit Kontur)
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  for (const f of floats) {
    ctx.globalAlpha = Math.max(0, f.life);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  // Welle-Banner (pulsierend)
  if (banner) {
    ctx.globalAlpha = Math.min(1, banner.life);
    const size = 34 + Math.sin(animT * 6) * 2;
    ctx.font = `bold ${size}px Georgia, serif`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(banner.text, W / 2, 90);
    ctx.fillStyle = '#b28bff';
    ctx.shadowColor = '#8a5cf6'; ctx.shadowBlur = 18;
    ctx.fillText(banner.text, W / 2, 90);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  // Pausenhinweis zwischen Wellen
  if (!waveActive && !gameOver && !banner && !paused) {
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#9a8bb8';
    ctx.fillText('Nächste Welle in ' + Math.ceil(waveTimer) + ' …', W / 2, 60);
  }
  // Pause-Overlay
  if (paused && !gameOver) {
    ctx.fillStyle = 'rgba(5,3,10,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = 'bold 42px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText('⏸ PAUSIERT', W / 2, H / 2 - 10);
    ctx.fillStyle = '#e6ddf5';
    ctx.fillText('⏸ PAUSIERT', W / 2, H / 2 - 10);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#9a8bb8';
    ctx.fillText('Klick auf ▶ oder Taste P / Leertaste zum Weitermachen', W / 2, H / 2 + 26);
  }
  ctx.restore();
}

/* ---------------- Klick auf das Spielfeld ---------------- */
canvas.addEventListener('click', (e) => {
  if (gameOver) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * W;
  const y = ((e.clientY - rect.top) / rect.height) * H;
  const crit = Math.random() < critChance();
  const gain = Math.round(clickPower() * (crit ? 5 : 1));
  state.mana += gain;
  addFloat(x, y - 10, (crit ? 'KRITISCH! ' : '+') + gain + ' 🔮', crit ? '#ffd257' : '#7ee0ff');
  burst(x, y, crit ? '#ffd257' : '#7ee0ff', crit ? 10 : 5);
  if (crit) { sfx.crit(); } else { sfx.click(); }
});

/* ---------------- Shop-UI aufbauen ---------------- */
function shopButton(cfg, cost, costClass, levelText, onClick) {
  const btn = document.createElement('button');
  btn.className = 'btn shop-item';
  btn.innerHTML =
    '<span class="info">' +
    `<span class="name">${cfg.icon} ${cfg.name} <span class="lvl">${levelText}</span></span>` +
    `<span class="desc">${cfg.desc}</span>` +
    '</span>' +
    `<span class="cost ${costClass}">${cost}</span>`;
  btn.addEventListener('click', onClick);
  return btn;
}
function buildShop() {
  const sl = document.getElementById('summon-list');
  sl.innerHTML = '';
  for (const s of SUMMONS) {
    sl.appendChild(shopButton(s, summonCost(s) + ' 🔮', 'mana',
      '×' + state.counts[s.id], () => summon(s.id)));
  }
  const ul = document.getElementById('upgrade-list');
  ul.innerHTML = '';
  for (const u of UPGRADES) {
    ul.appendChild(shopButton(u, upgradeCost(u) + ' 🪙', 'gold',
      'Lv.' + state.upgrades[u.id], () => buyUpgrade(u)));
  }
  const dl = document.getElementById('soul-list');
  dl.innerHTML = '';
  for (const u of SOUL_UPGRADES) {
    dl.appendChild(shopButton(u, soulCost(u) + ' 💀', 'souls',
      'Lv.' + state.soulUpgrades[u.id], () => buySoulUpgrade(u)));
  }
}
function refreshShop() {
  const sl = document.getElementById('summon-list');
  SUMMONS.forEach((s, i) => {
    const btn = sl.children[i];
    btn.querySelector('.cost').textContent = summonCost(s) + ' 🔮';
    btn.querySelector('.lvl').textContent = '×' + state.counts[s.id];
    btn.disabled = state.mana < summonCost(s);
  });
  const ul = document.getElementById('upgrade-list');
  UPGRADES.forEach((u, i) => {
    const btn = ul.children[i];
    btn.querySelector('.cost').textContent = upgradeCost(u) + ' 🪙';
    btn.querySelector('.lvl').textContent = 'Lv.' + state.upgrades[u.id];
    btn.disabled = state.gold < upgradeCost(u);
  });
  const dl = document.getElementById('soul-list');
  SOUL_UPGRADES.forEach((u, i) => {
    const btn = dl.children[i];
    btn.querySelector('.cost').textContent = soulCost(u) + ' 💀';
    btn.querySelector('.lvl').textContent = 'Lv.' + state.soulUpgrades[u.id];
    btn.disabled = state.souls < soulCost(u);
  });
  // Ad-Button
  const adBtn = document.getElementById('btn-ad');
  const cd = Math.ceil((state.adCooldownUntil - Date.now()) / 1000);
  adBtn.disabled = cd > 0;
  adBtn.textContent = cd > 0 ? `🎁 Werbung (${cd}s)` : '🎁 Werbung: 2× Seelen';
}
function refreshStats() {
  document.getElementById('st-mana').textContent = Math.floor(state.mana);
  document.getElementById('st-souls').textContent = state.souls;
  document.getElementById('st-gold').textContent = state.gold;
  document.getElementById('st-wave').textContent = state.wave;
  document.getElementById('st-nexthp').textContent = Math.ceil(state.necHp);
  document.getElementById('st-nectotal').textContent = necMaxHp();
}

/* ---------------- Rewarded Ad (Monetarisierung per Werbung) ---------------- */
function requestRewardedAd() {
  if (Date.now() < state.adCooldownUntil) return;
  if (AD_CONFIG.demoMode) {
    // Demo: lokales "Werbevideo" mit Countdown
    openAdModal();
  } else {
    // PRODUKTIV: hier echten Rewarded Ad des Anbieters laden & abspielen.
    // Belohnung bei Erfolg: grantAdReward() aufrufen (z. B. via SDK-Callback).
    // Siehe Kommentar-Block ganz oben in dieser Datei (AdSense-Beispiel).
    grantAdReward();
  }
}
function grantAdReward() {
  const base = Math.max(10, state.wave * AD_CONFIG.soulsPerWave);
  const reward = base * AD_CONFIG.rewardMultiplier;
  state.souls += reward;
  state.adCooldownUntil = Date.now() + AD_CONFIG.rewardCooldownSec * 1000;
  toast(`🎁 Werbebelohnung: +${reward} Seelen!`);
  save();
}
function openAdModal() {
  const modal = document.getElementById('ad-modal');
  const bar = document.getElementById('ad-progress-bar');
  const cdEl = document.getElementById('ad-countdown');
  const closeBtn = document.getElementById('ad-close');
  modal.classList.remove('hidden');
  closeBtn.disabled = true;
  closeBtn.textContent = 'Belohnung abholen';
  let remaining = AD_CONFIG.demoDurationSec;
  cdEl.textContent = remaining;
  bar.style.width = '0%';
  const iv = setInterval(() => {
    remaining -= 0.2;
    const frac = 1 - Math.max(0, remaining) / AD_CONFIG.demoDurationSec;
    bar.style.width = (frac * 100).toFixed(1) + '%';
    cdEl.textContent = Math.max(0, Math.ceil(remaining));
    if (remaining <= 0) {
      clearInterval(iv);
      closeBtn.disabled = false;
    }
  }, 200);
  closeBtn.onclick = () => {
    clearInterval(iv);
    modal.classList.add('hidden');
    grantAdReward();
  };
}

/* ---------------- Top-Leiste ---------------- */
document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-ad').addEventListener('click', requestRewardedAd);
document.getElementById('btn-revive').addEventListener('click', revive);
document.getElementById('btn-sound').addEventListener('click', (e) => {
  state.muted = !state.muted;
  e.target.textContent = state.muted ? '🔇' : '🔊';
  save();
});
document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('Wirklich den gesamten Spielstand löschen?')) {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }
});
// Pause per Tastatur (P oder Leertaste) und automatisch beim Tab-Wechsel
document.addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P' || e.key === ' ') {
    e.preventDefault();
    togglePause();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});

/* ---------------- Hauptloop ---------------- */
let last = performance.now();
let hudTimer = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!gameOver && !paused) {
    animT += dt;
    updateCombat(dt);
  }
  render();
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.15;
    refreshStats();
    refreshShop();
  }
  requestAnimationFrame(loop);
}

window.addEventListener('beforeunload', save);
setInterval(save, 5000);

/* ---------------- Start ---------------- */
load();
buildBackground();
document.getElementById('btn-sound').textContent = state.muted ? '🔇' : '🔊';
buildShop();
refreshStats();
refreshShop();
requestAnimationFrame(loop);
