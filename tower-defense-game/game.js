'use strict';

/* =====================================================================
   TURMVERTEIDIGUNG – DAS DUNKE TAL
   Reines Vanilla-JS HTML5-Tower-Defense (Canvas). Kein Build, keine Abhängigkeiten.
   ===================================================================== */

const SAVE_KEY = 'turmverteidigung_highscore_v1';
const W = 960, H = 528, TILE = 48, COLS = W / TILE, ROWS = H / TILE; // 20 x 11

/* ---------------- Karte: fester Pfad der Gegner ---------------- */
const cellKey = (c, r) => c + ',' + r;
const cellCenter = (c, r) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
const PATH = new Set();
for (let c = 0; c <= 13; c++) PATH.add(cellKey(c, 2));
for (let r = 2; r <= 8; r++) PATH.add(cellKey(13, r));
for (let c = 13; c < COLS; c++) PATH.add(cellKey(c, 8));
const WAYPOINTS = [
  { x: -TILE, y: 2 * TILE + TILE / 2 },
  { x: 13 * TILE + TILE / 2, y: 2 * TILE + TILE / 2 },
  { x: 13 * TILE + TILE / 2, y: 8 * TILE + TILE / 2 },
  { x: W + TILE, y: 8 * TILE + TILE / 2 },
];

/* ---------------- Turmtypen ---------------- */
const TOWER_TYPES = {
  arrow:  { name: 'Pfeilturm',   icon: '🏹', cost: 50,  range: 115, dmg: 9,  rate: 2.0,  color: '#7ee0ff', desc: 'Günstig & schnell' },
  cannon: { name: 'Kanonenturm', icon: '💣', cost: 120, range: 100, dmg: 32, rate: 0.55, splash: 60, color: '#ff9a5a', desc: 'Langsam, Flächenschaden' },
  frost:  { name: 'Frostturm',   icon: '❄️', cost: 80,  range: 105, dmg: 4,  rate: 1.2,  slow: 0.5, slowDur: 1.6, color: '#9fd1ff', desc: 'Verlangsamt Gegner' },
};
const TOWER_ORDER = ['arrow', 'cannon', 'frost'];
const MAX_LEVEL = 3;
const towerDmg = (t) => TOWER_TYPES[t.type].dmg * Math.pow(1.55, t.level - 1);
const towerRange = (t) => TOWER_TYPES[t.type].range + 10 * (t.level - 1);
const upgradeCost = (t) => Math.round(TOWER_TYPES[t.type].cost * 0.75 * t.level);
const sellValue = (t) => Math.round(t.invested * 0.7);

/* ---------------- Gegnertypen ---------------- */
const ENEMY_TYPES = {
  grunt:  { name: 'Kriecher',    hp: 30,  speed: 42, reward: 6,   leak: 1, radius: 11, color: '#8fd18b' },
  runner: { name: 'Flinkling',   hp: 18,  speed: 76, reward: 8,   leak: 1, radius: 9,  color: '#ffd257' },
  tank:   { name: 'Panzer',      hp: 115, speed: 26, reward: 16,  leak: 2, radius: 14, color: '#ff6b7a' },
  boss:   { name: 'Dämonenlord', hp: 430, speed: 20, reward: 120, leak: 5, radius: 18, color: '#b28bff' },
};
const hpMult = (wave) => 1 + 0.22 * (wave - 1) + 0.03 * wave * wave;

/* ---------------- Rekord (localStorage) ---------------- */
function loadRecord() {
  try { return parseInt(localStorage.getItem(SAVE_KEY), 10) || 0; } catch (e) { return 0; }
}
function saveRecord() {
  try { localStorage.setItem(SAVE_KEY, String(state.record)); } catch (e) { /* lokal nicht verfügbar */ }
}

/* ---------------- Spielzustand ---------------- */
const defaultState = () => ({
  gold: 170,
  lives: 20,
  wave: 1,
  record: loadRecord(),
  speed: 1,
  muted: false,
});
let state = defaultState();
let towers = [];       // {col,row,type,level,cd,invested,x,y}
let enemies = [];      // {x,y,hp,maxHp,baseSpeed,reward,leak,radius,color,wp,dist,slowUntil,slow,alive}
let projectiles = [];  // {x,y,target,speed,dmg,splash,slow,slowDur,color}
let floats = [];       // {x,y,text,color,life}
let waveActive = false;
let spawnQueue = [];
let spawnTimer = 0;
let selectedType = null;
let selectedTower = null;
let hover = null;      // {col,row}
let paused = false;
let gameOver = false;
let banner = null;     // {text,life}

/* ---------------- Sound (WebAudio, kompakt) ---------------- */
let audioCtx = null;
function beep(freq, dur, type, gain) {
  if (state.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.04, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (dur || 0.08));
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + (dur || 0.08));
  } catch (e) { /* Audio nicht verfügbar */ }
}

/* ---------------- DOM ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const el = (id) => document.getElementById(id);
const ui = {
  gold: el('st-gold'), lives: el('st-lives'), wave: el('st-wave'), record: el('st-record'),
  btnWave: el('btn-wave'), btnPause: el('btn-pause'), btnSpeed: el('btn-speed'),
  btnSound: el('btn-sound'), btnReset: el('btn-reset'),
  towerList: el('tower-list'), towerInfo: el('tower-info'),
  gameover: el('gameover'), goWave: el('go-wave'), goRecord: el('go-record'), btnRestart: el('btn-restart'),
  toast: el('toast'),
};

let toastTimer = null;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add('hidden'), 2200);
}

/* ---------------- Wellen ---------------- */
function buildWave(n) {
  const list = [];
  if (n % 5 === 0) {
    list.push('boss');
    const extra = 3 + Math.floor(n / 5);
    for (let i = 0; i < extra; i++) list.push('grunt');
  }
  const count = 6 + 2 * n;
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    if (n >= 4 && r < 0.18) list.push('tank');
    else if (n >= 2 && r < 0.5) list.push('runner');
    else list.push('grunt');
  }
  return list;
}

function spawnEnemy(typeId) {
  const d = ENEMY_TYPES[typeId];
  const hp = Math.round(d.hp * hpMult(state.wave));
  enemies.push({
    type: typeId, x: WAYPOINTS[0].x, y: WAYPOINTS[0].y,
    hp: hp, maxHp: hp, baseSpeed: d.speed,
    reward: d.reward, leak: d.leak, radius: d.radius, color: d.color,
    wp: 0, dist: 0, slowUntil: 0, slow: 0, alive: true,
  });
}

function startWave() {
  if (waveActive || gameOver || paused) return;
  waveActive = true;
  spawnQueue = buildWave(state.wave);
  spawnTimer = 0.4;
  banner = { text: 'Welle ' + state.wave, life: 2 };
  beep(220, 0.15, 'sawtooth', 0.05);
  updateUI();
}

function waveComplete() {
  waveActive = false;
  const bonus = 20 + 5 * state.wave;
  state.gold += bonus;
  state.record = Math.max(state.record, state.wave);
  saveRecord();
  state.wave += 1;
  toast('Welle geschafft! +' + bonus + ' 🪙');
  beep(520, 0.12, 'triangle', 0.05);
  beep(780, 0.15, 'triangle', 0.05);
  updateUI();
}

function endGame() {
  gameOver = true;
  state.record = Math.max(state.record, state.wave - 1);
  saveRecord();
  ui.goWave.textContent = String(state.wave);
  ui.goRecord.textContent = String(state.record);
  ui.gameover.classList.remove('hidden');
  beep(110, 0.5, 'sawtooth', 0.08);
  updateUI();
}

/* ---------------- Bauen / Upgraden / Verkaufen ---------------- */
function towerAt(col, row) {
  return towers.find((t) => t.col === col && t.row === row) || null;
}

function tryBuildAt(col, row) {
  if (gameOver || col < 0 || row < 0 || col >= COLS || row >= ROWS) return;
  const key = cellKey(col, row);
  if (PATH.has(key)) { toast('Hier führt der Weg lang – nicht bebaubar.'); return; }
  if (towerAt(col, row)) { selectedTower = towerAt(col, row); selectedType = null; renderShop(); return; }
  if (!selectedType) { selectedTower = null; renderShop(); return; }
  const def = TOWER_TYPES[selectedType];
  if (state.gold < def.cost) { toast('Nicht genug Gold für ' + def.name + ' (' + def.cost + ' 🪙).'); return; }
  state.gold -= def.cost;
  const p = cellCenter(col, row);
  towers.push({ col: col, row: row, type: selectedType, level: 1, cd: 0, invested: def.cost, x: p.x, y: p.y });
  beep(440, 0.07, 'square', 0.05);
  renderShop();
  updateUI();
}

function upgradeSelected() {
  const t = selectedTower;
  if (!t || t.level >= MAX_LEVEL) return;
  const cost = upgradeCost(t);
  if (state.gold < cost) { toast('Nicht genug Gold fürs Upgrade (' + cost + ' 🪙).'); return; }
  state.gold -= cost;
  t.invested += cost;
  t.level += 1;
  beep(660, 0.09, 'square', 0.05);
  renderShop();
  updateUI();
}

function sellSelected() {
  const t = selectedTower;
  if (!t) return;
  state.gold += sellValue(t);
  towers = towers.filter((x) => x !== t);
  selectedTower = null;
  beep(330, 0.08, 'square', 0.05);
  renderShop();
  updateUI();
}

/* ---------------- Kampf ---------------- */
function fire(t, target) {
  const def = TOWER_TYPES[t.type];
  projectiles.push({
    x: t.x, y: t.y - 10, target: target, speed: 560,
    dmg: towerDmg(t), splash: def.splash || 0,
    slow: def.slow || 0, slowDur: def.slowDur || 0, color: def.color,
  });
  if (t.type === 'cannon') beep(90, 0.1, 'square', 0.05);
}

function damage(e, dmg) {
  if (!e.alive) return;
  e.hp -= dmg;
  if (e.hp <= 0) {
    e.alive = false;
    state.gold += e.reward;
    floats.push({ x: e.x, y: e.y - e.radius - 4, text: '+' + e.reward + ' 🪙', color: '#ffd257', life: 1 });
    beep(660, 0.05, 'triangle', 0.03);
  }
}

function leakEnemy(e) {
  e.alive = false;
  state.lives -= e.leak;
  floats.push({ x: Math.min(e.x, W - 30), y: e.y, text: '-' + e.leak + ' ❤️', color: '#ff6b7a', life: 1.2 });
  beep(110, 0.2, 'sawtooth', 0.06);
  if (state.lives <= 0) {
    state.lives = 0;
    endGame();
  }
}

/* ---------------- Update ---------------- */
function update(dt, t) {
  if (banner) { banner.life -= dt; if (banner.life <= 0) banner = null; }

  if (waveActive && spawnQueue.length > 0) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy(spawnQueue.shift());
      spawnTimer = Math.max(0.35, 0.95 - state.wave * 0.02);
    }
  }

  for (const e of enemies) {
    if (!e.alive) continue;
    const slowFactor = t < e.slowUntil ? 1 - e.slow : 1;
    const target = WAYPOINTS[e.wp + 1];
    if (!target) { leakEnemy(e); continue; }
    const dx = target.x - e.x, dy = target.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const step = e.baseSpeed * slowFactor * dt;
    if (step >= d) {
      e.x = target.x; e.y = target.y; e.wp += 1; e.dist += d;
      if (e.wp + 1 >= WAYPOINTS.length) leakEnemy(e);
    } else {
      e.x += (dx / d) * step;
      e.y += (dy / d) * step;
      e.dist += step;
    }
  }
  enemies = enemies.filter((e) => e.alive);

  for (const t of towers) {
    t.cd -= dt;
    if (t.cd > 0) continue;
    let best = null, bestDist = -1;
    const range = towerRange(t);
    for (const e of enemies) {
      const d = Math.hypot(e.x - t.x, e.y - t.y);
      if (d <= range + e.radius && e.dist > bestDist) { best = e; bestDist = e.dist; }
    }
    if (best) {
      fire(t, best);
      t.cd = 1 / TOWER_TYPES[t.type].rate;
    } else {
      t.cd = 0.05;
    }
  }

  for (const p of projectiles) {
    if (!p.target || !p.target.alive) { p.dead = true; continue; }
    const dx = p.target.x - p.x, dy = p.target.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const step = p.speed * dt;
    if (step >= d) {
      p.dead = true;
      if (p.splash > 0) {
        for (const e of enemies) {
          if (e.alive && Math.hypot(e.x - p.target.x, e.y - p.target.y) <= p.splash + e.radius) damage(e, p.dmg);
        }
      } else {
        damage(p.target, p.dmg);
      }
      if (p.slow > 0 && p.target.alive) {
        p.target.slow = p.slow;
        p.target.slowUntil = t + p.slowDur;
      }
    } else {
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    }
  }
  projectiles = projectiles.filter((p) => !p.dead);
  enemies = enemies.filter((e) => e.alive);

  for (const f of floats) { f.life -= dt; f.y -= 22 * dt; }
  floats = floats.filter((f) => f.life > 0);

  if (waveActive && spawnQueue.length === 0 && enemies.length === 0) waveComplete();

  updateUI();
}

/* ---------------- Zeichnen ---------------- */
function draw(t) {
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#0f0a1c';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(61, 44, 94, 0.35)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * TILE, 0); ctx.lineTo(c * TILE, H); ctx.stroke(); }
  for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * TILE); ctx.lineTo(W, r * TILE); ctx.stroke(); }

  for (const key of PATH) {
    const [c, r] = key.split(',').map(Number);
    ctx.fillStyle = '#241a3d';
    ctx.fillRect(c * TILE + 1, r * TILE + 1, TILE - 2, TILE - 2);
  }
  ctx.strokeStyle = '#4a3670';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(WAYPOINTS[0].x, WAYPOINTS[0].y);
  for (let i = 1; i < WAYPOINTS.length; i++) ctx.lineTo(WAYPOINTS[i].x, WAYPOINTS[i].y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '22px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🕳️', 14, 2 * TILE + TILE / 2);
  ctx.fillText('🏰', W - 14, 8 * TILE + TILE / 2);

  if (hover && hover.col >= 0 && hover.row >= 0 && hover.col < COLS && hover.row < ROWS) {
    const key = cellKey(hover.col, hover.row);
    const occ = towerAt(hover.col, hover.row);
    if (!PATH.has(key) && !occ && selectedType) {
      const def = TOWER_TYPES[selectedType];
      const p = cellCenter(hover.col, hover.row);
      ctx.fillStyle = state.gold >= def.cost ? 'rgba(55, 224, 139, 0.18)' : 'rgba(255, 107, 122, 0.18)';
      ctx.fillRect(hover.col * TILE + 1, hover.row * TILE + 1, TILE - 2, TILE - 2);
      ctx.strokeStyle = state.gold >= def.cost ? 'rgba(55, 224, 139, 0.7)' : 'rgba(255, 107, 122, 0.7)';
      ctx.beginPath(); ctx.arc(p.x, p.y, def.range, 0, Math.PI * 2); ctx.stroke();
    }
    if (occ) {
      ctx.strokeStyle = 'rgba(138, 92, 246, 0.7)';
      ctx.beginPath(); ctx.arc(occ.x, occ.y, towerRange(occ), 0, Math.PI * 2); ctx.stroke();
    }
  }

  for (const t of towers) {
    ctx.fillStyle = '#251b3d';
    ctx.strokeStyle = selectedTower === t ? '#37e08b' : '#3d2c5e';
    ctx.lineWidth = selectedTower === t ? 3 : 1.5;
    ctx.beginPath(); ctx.arc(t.x, t.y, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '20px serif';
    ctx.fillText(TOWER_TYPES[t.type].icon, t.x, t.y + 1);
    ctx.fillStyle = '#ffd257';
    for (let i = 0; i < t.level; i++) ctx.fillRect(t.x - 12 + i * 9, t.y + 21, 6, 3);
  }

  for (const e of enemies) {
    if (t < e.slowUntil) {
      ctx.strokeStyle = 'rgba(159, 209, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 3, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const w = e.radius * 2;
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(e.x - e.radius, e.y - e.radius - 9, w, 5);
    ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#37e08b' : '#ff6b7a';
    ctx.fillRect(e.x - e.radius, e.y - e.radius - 9, w * Math.max(0, e.hp / e.maxHp), 5);
  }

  for (const p of projectiles) {
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.splash > 0 ? 5 : 3, 0, Math.PI * 2); ctx.fill();
  }

  ctx.font = 'bold 14px sans-serif';
  for (const f of floats) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  if (banner) {
    ctx.globalAlpha = Math.max(0, Math.min(1, banner.life));
    ctx.font = 'bold 42px Georgia, serif';
    ctx.fillStyle = '#ffd257';
    ctx.fillText(banner.text, W / 2, H / 2 - 40);
    ctx.globalAlpha = 1;
  }

  if (paused && !gameOver) {
    ctx.fillStyle = 'rgba(5, 3, 10, 0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = 'bold 36px Georgia, serif';
    ctx.fillStyle = '#e6ddf5';
    ctx.fillText('⏸ Pause', W / 2, H / 2);
  }
}

/* ---------------- UI ---------------- */
function updateUI() {
  ui.gold.textContent = String(state.gold);
  ui.lives.textContent = String(state.lives);
  ui.wave.textContent = String(state.wave);
  ui.record.textContent = String(state.record);
  ui.btnWave.disabled = waveActive || gameOver || paused;
  ui.btnPause.textContent = paused ? '▶' : '⏸';
  ui.btnSpeed.textContent = state.speed + '×';
  ui.btnSound.textContent = state.muted ? '🔇' : '🔊';
}

function renderShop() {
  ui.towerList.innerHTML = '';
  for (const id of TOWER_ORDER) {
    const def = TOWER_TYPES[id];
    const btn = document.createElement('button');
    btn.className = 'shop-item' + (selectedType === id ? ' selected' : '') + (state.gold < def.cost ? ' cant' : '');
    btn.innerHTML = '<span class="info"><span class="name">' + def.icon + ' ' + def.name + '</span>' +
      '<span class="desc">' + def.desc + ' · Schaden ' + def.dmg + ' · Reichweite ' + def.range + '</span></span>' +
      '<span class="cost">' + def.cost + ' 🪙</span>';
    btn.addEventListener('click', () => {
      selectedType = selectedType === id ? null : id;
      selectedTower = null;
      renderShop();
    });
    ui.towerList.appendChild(btn);
  }

  if (!selectedTower) {
    ui.towerInfo.innerHTML = '<p class="muted">Kein Turm ausgewählt – klicke auf einen gebauten Turm.</p>';
    return;
  }
  const t = selectedTower;
  const def = TOWER_TYPES[t.type];
  const upCost = t.level < MAX_LEVEL ? upgradeCost(t) : null;
  ui.towerInfo.innerHTML =
    '<p class="name">' + def.icon + ' <b>' + def.name + '</b> – Stufe ' + t.level + '/' + MAX_LEVEL + '</p>' +
    '<p class="muted">Schaden ' + Math.round(towerDmg(t)) + ' · Reichweite ' + Math.round(towerRange(t)) +
    ' · investiert ' + t.invested + ' 🪙</p>' +
    '<div class="info-row">' +
    (upCost !== null
      ? '<button id="btn-upgrade" class="btn primary" ' + (state.gold < upCost ? 'disabled' : '') + '>⬆ Upgrade (' + upCost + ' 🪙)</button>'
      : '<button class="btn" disabled>Max. Stufe</button>') +
    '<button id="btn-sell" class="btn danger">💰 Verkaufen (+' + sellValue(t) + ' 🪙)</button>' +
    '</div>';
  const upBtn = document.getElementById('btn-upgrade');
  if (upBtn) upBtn.addEventListener('click', upgradeSelected);
  document.getElementById('btn-sell').addEventListener('click', sellSelected);
}

/* ---------------- Eingabe ---------------- */
function toGame(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (W / rect.width),
    y: (e.clientY - rect.top) * (H / rect.height),
  };
}

canvas.addEventListener('mousemove', (e) => {
  const p = toGame(e);
  hover = { col: Math.floor(p.x / TILE), row: Math.floor(p.y / TILE) };
});
canvas.addEventListener('mouseleave', () => { hover = null; });
canvas.addEventListener('click', (e) => {
  const p = toGame(e);
  tryBuildAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  selectedType = null;
  selectedTower = null;
  renderShop();
});

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  updateUI();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P') togglePause();
  else if (e.key === ' ') { e.preventDefault(); startWave(); }
  else if (e.key === '1' || e.key === '2' || e.key === '3') {
    selectedType = TOWER_ORDER[Number(e.key) - 1];
    selectedTower = null;
    renderShop();
  } else if (e.key === 'Escape') {
    selectedType = null;
    selectedTower = null;
    renderShop();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !gameOver && !paused) { paused = true; updateUI(); }
});

ui.btnWave.addEventListener('click', startWave);
ui.btnPause.addEventListener('click', togglePause);
ui.btnSpeed.addEventListener('click', () => { state.speed = state.speed === 1 ? 2 : 1; updateUI(); });
ui.btnSound.addEventListener('click', () => { state.muted = !state.muted; updateUI(); });
ui.btnReset.addEventListener('click', () => {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignorieren */ }
  location.reload();
});
ui.btnRestart.addEventListener('click', () => {
  state = defaultState();
  towers = [];
  enemies = [];
  projectiles = [];
  floats = [];
  waveActive = false;
  spawnQueue = [];
  selectedType = null;
  selectedTower = null;
  paused = false;
  gameOver = false;
  banner = null;
  ui.gameover.classList.add('hidden');
  renderShop();
  updateUI();
});

/* ---------------- Hauptschleife ---------------- */
let last = performance.now();
function loop(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = (paused || gameOver) ? 0 : rawDt * state.speed;
  if (dt > 0) update(dt, now / 1000);
  draw(now / 1000);
  requestAnimationFrame(loop);
}

renderShop();
updateUI();
requestAnimationFrame(loop);
