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
  });
  sfx.summon();
  burst(SPAWN_X + 20, GROUND_Y - 40, '#b28bff', 10);
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
      vx: (Math.random() - 0.5) * 120,
      vy: -Math.random() * 120 - 30,
      life: 0.6 + Math.random() * 0.4,
      color,
    });
  }
}

function updateCombat(dt) {
  // Mana-Regeneration
  state.mana += manaRegen() * dt;
  // Nekromanten-Regeneration
  state.necHp = Math.min(necMaxHp(), state.necHp + 0.4 * dt);

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
    const target = heroes.filter((h) => h.x > sk.x - 20).sort((a, b) => a.x - b.x)[0];
    if (target && target.x - sk.x <= sk.range) {
      if (sk.atkCd <= 0) {
        sk.atkCd = sk.ranged ? 1.6 : (sk.type === 'knight' ? 1.4 : sk.type === 'warrior' ? 1.1 : 0.9);
        if (sk.ranged) {
          arrows.push({ x: sk.x + 10, y: GROUND_Y - 52, target, dmg: sk.dmg, speed: 320 });
        } else {
          target.hp -= sk.dmg;
          sfx.hit();
          addFloat(target.x, GROUND_Y - 84, '-' + sk.dmg, '#ffd257');
          burst(target.x, GROUND_Y - 50, '#ff8080', 4);
        }
      }
    } else {
      sk.x += sk.speed * dt;
    }
  }

  // Helden bewegen/angreifen
  for (const h of heroes) {
    h.atkCd -= dt;
    const target = skeletons.filter((s) => s.x < h.x + 20).sort((a, b) => b.x - a.x)[0];
    if (target && h.x - target.x <= MELEE_RANGE + 6) {
      if (h.atkCd <= 0) {
        h.atkCd = 1.0;
        target.hp -= h.dmg;
        sfx.hit();
        addFloat(target.x, GROUND_Y - 84, '-' + h.dmg, '#ff9aa8');
        burst(target.x, GROUND_Y - 50, '#c0c8d8', 4);
      }
    } else if (!target && h.x <= NEC_X + 46) {
      if (h.atkCd <= 0) {
        h.atkCd = 1.0;
        state.necHp -= h.dmg;
        shake = 8;
        sfx.hit();
        addFloat(NEC_X, GROUND_Y - 110, '-' + h.dmg, '#ff6b7a');
        burst(NEC_X + 10, GROUND_Y - 60, '#ff6b7a', 6);
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
      burst(h.x, GROUND_Y - 50, h.color, 14);
    }
  }
  // Tote Skelette entfernen
  for (let i = skeletons.length - 1; i >= 0; i--) {
    if (skeletons[i].hp <= 0) {
      burst(skeletons[i].x, GROUND_Y - 45, '#e8e8e8', 10);
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
      addFloat(a.target.x, GROUND_Y - 84, '-' + a.dmg, '#9fd18b');
      burst(a.target.x, GROUND_Y - 52, '#9fd18b', 3);
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

/* ---------------- Zeichnen ---------------- */
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#120b1e');
  g.addColorStop(0.7, '#1a1028');
  g.addColorStop(1, '#0d0812');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Mond
  ctx.fillStyle = '#e8ddc0';
  ctx.beginPath(); ctx.arc(W - 120, 80, 34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(18,11,30,0.85)';
  ctx.beginPath(); ctx.arc(W - 132, 72, 30, 0, Math.PI * 2); ctx.fill();
  // Sterne
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 40; i++) {
    const x = (i * 173) % W, y = (i * 97) % 200;
    ctx.fillRect(x, y, 2, 2);
  }
  // Boden
  ctx.fillStyle = '#171021';
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = '#241a35';
  ctx.fillRect(0, GROUND_Y, W, 6);
  // Grüfte/Grabsteine
  ctx.fillStyle = '#221833';
  [[W - 320, 40], [W - 260, 55], [W - 480, 45], [300, 50], [360, 38]].forEach(([x, h]) => {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x, GROUND_Y - h + 12);
    ctx.arc(x + 12, GROUND_Y - h + 12, 12, Math.PI, 0);
    ctx.lineTo(x + 24, GROUND_Y);
    ctx.fill();
  });
  // Nebel
  ctx.fillStyle = 'rgba(140,110,200,0.06)';
  ctx.fillRect(0, GROUND_Y - 30, W, 30);
}

function drawNecromancer() {
  const x = NEC_X, y = GROUND_Y;
  ctx.save();
  ctx.translate(x, y);
  // Umhang
  ctx.fillStyle = '#241536';
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.quadraticCurveTo(-20, -70, -8, -92);
  ctx.lineTo(8, -92);
  ctx.quadraticCurveTo(20, -70, 26, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3d2c5e';
  ctx.stroke();
  // Kapuze
  ctx.fillStyle = '#2e1c46';
  ctx.beginPath(); ctx.arc(0, -96, 16, Math.PI, 0); ctx.fill();
  // Schädel
  ctx.fillStyle = '#e8e0d0';
  ctx.beginPath(); ctx.arc(0, -94, 10, 0, Math.PI * 2); ctx.fill();
  // Augen
  ctx.fillStyle = '#37e08b';
  ctx.shadowColor = '#37e08b'; ctx.shadowBlur = 8;
  ctx.fillRect(-6, -97, 4, 4);
  ctx.fillRect(2, -97, 4, 4);
  ctx.shadowBlur = 0;
  // Stab
  ctx.strokeStyle = '#5a4030';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(30, -110); ctx.stroke();
  ctx.fillStyle = '#b28bff';
  ctx.shadowColor = '#b28bff'; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(30, -116, 7, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
  // Lebensbalken
  drawBar(x - 30, y - 140, 60, state.necHp / necMaxHp(), '#ff6b7a');
}

function drawSkeleton(sk) {
  const x = sk.x, y = GROUND_Y;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = sk.color;
  ctx.fillStyle = sk.color;
  ctx.lineWidth = 3;
  // Beine
  ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-4, -18); ctx.moveTo(3, 0); ctx.lineTo(4, -18); ctx.stroke();
  // Körper
  ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(0, -34); ctx.stroke();
  // Rippen
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(-5, -20 - i * 4); ctx.lineTo(5, -20 - i * 4); ctx.stroke();
  }
  // Arme
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(10, -26); ctx.moveTo(0, -32); ctx.lineTo(-8, -27); ctx.stroke();
  // Schädel
  ctx.beginPath(); ctx.arc(0, -42, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#120b1e';
  ctx.fillRect(-4, -44, 3, 3); ctx.fillRect(1, -44, 3, 3);
  if (sk.type === 'warrior') { ctx.fillStyle = '#8890a8'; ctx.fillRect(-7, -50, 14, 4); }
  if (sk.type === 'knight') { ctx.fillStyle = '#5a3fb0'; ctx.fillRect(-8, -51, 16, 5); }
  if (sk.type === 'archer') {
    ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(12, -30, 8, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  }
  ctx.restore();
  drawBar(x - 17, y - 62, 34, sk.hp / sk.maxHp, '#8fd0ff');
}

function drawHero(h) {
  const x = h.x, y = GROUND_Y;
  ctx.save();
  ctx.translate(x, y);
  // Beine
  ctx.strokeStyle = '#3a3a4a'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-5, -20); ctx.moveTo(4, 0); ctx.lineTo(5, -20); ctx.stroke();
  // Rüstung
  ctx.fillStyle = h.color;
  ctx.fillRect(-9, -44, 18, 26);
  // Kopf + Helm
  ctx.fillStyle = '#e8c8a0';
  ctx.beginPath(); ctx.arc(0, -50, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = h.color;
  ctx.beginPath(); ctx.arc(0, -53, 8, Math.PI, 0); ctx.fill();
  // Schwert
  ctx.strokeStyle = '#d8d8e8'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(10, -40); ctx.lineTo(20, -58); ctx.stroke();
  ctx.restore();
  drawBar(x - 17, y - 72, 34, h.hp / h.maxHp, '#ff6b7a');
}

function drawBar(x, y, w, ratio, color) {
  ratio = Math.max(0, Math.min(1, ratio));
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, w, 6);
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
  ctx.strokeStyle = '#c8e8a0'; ctx.lineWidth = 2;
  for (const a of arrows) {
    ctx.beginPath(); ctx.moveTo(a.x - 10, a.y); ctx.lineTo(a.x + 6, a.y); ctx.stroke();
  }
  // Partikel
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  // Schwebende Texte
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  for (const f of floats) {
    ctx.globalAlpha = Math.max(0, f.life);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  // Welle-Banner
  if (banner) {
    ctx.globalAlpha = Math.min(1, banner.life);
    ctx.font = 'bold 34px Georgia, serif';
    ctx.fillStyle = '#b28bff';
    ctx.shadowColor = '#8a5cf6'; ctx.shadowBlur = 16;
    ctx.fillText(banner.text, W / 2, 90);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  // Pausenhinweis zwischen Wellen
  if (!waveActive && !gameOver && !banner) {
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#9a8bb8';
    ctx.fillText('Nächste Welle in ' + Math.ceil(waveTimer) + ' …', W / 2, 60);
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
  if (crit) { sfx.crit(); burst(x, y, '#ffd257', 8); } else { sfx.click(); }
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

/* ---------------- Hauptloop ---------------- */
let last = performance.now();
let hudTimer = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!gameOver) updateCombat(dt);
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
document.getElementById('btn-sound').textContent = state.muted ? '🔇' : '🔊';
buildShop();
refreshStats();
refreshShop();
requestAnimationFrame(loop);
