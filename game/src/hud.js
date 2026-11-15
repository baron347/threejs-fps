
import { CFG, localPlayer } from './state.js';
import { WEAPONS, buyArmor, buyGrenade, buyWeapon } from './weapon.js';
import { MAP } from './world.js';

const KILLFEED_MAX = 5;
const KILLFEED_TTL_MS = 6000;
const BANNER_MS = 4500;
const HITMARKER_MS = 120;
const FLASH_MS = 180;
const PLANT_TIME = 3; // seconds to plant; mirrors rounds.js
const MINIMAP_MS = 100; // redraw the minimap at most this often
const MINIMAP_SIZE = 140;
const ENEMY_SHOT_VISIBLE_MS = 3000; // an enemy that just fired stays visible

const GRENADE_COPY = {
  he: { name: 'HE Grenade', price: 300 },
  smoke: { name: 'Smoke Grenade', price: 200 },
};

const MINIMAP_TAKEOVER = true;

const FALLBACK_WALLS = [
  [22, 2.5, -20.5, 14, 5, 1], [29.5, 2.5, -15, 1, 5, 12], [15.5, 2.5, -18, 1, 5, 5],
  [19, 0.6, -17, 2.4, 1.2, 2.4], [25, 0.6, -18, 2.4, 1.2, 2.4], [25, 1.8, -18, 2.4, 1.2, 2.4],
  [-22, 1.3, 19, 6, 2.6, 2.4], [-22, 3.9, 19, 6, 2.6, 2.4], [-27.5, 1.3, 14, 2.4, 2.6, 6],
  [-16.5, 1.3, 13.5, 2.4, 2.6, 6], [-19, 0.6, 19.5, 2.4, 1.2, 2.4],
  [-4, 1.3, -6, 2.4, 2.6, 6], [4, 1.3, 2, 2.4, 2.6, 6],
  [0, 0.6, -12, 2.4, 1.2, 2.4], [0, 0.6, 10, 2.4, 1.2, 2.4], [0, 1.8, 10, 2.4, 1.2, 2.4],
  [26, 1.3, -4, 6, 2.6, 2.4], [26, 0.6, 8, 2.4, 1.2, 2.4], [22, 1.3, 6, 2.4, 2.6, 6],
  [-26, 1.3, 4, 6, 2.6, 2.4], [-26, 0.6, -8, 2.4, 1.2, 2.4], [-22, 1.3, -6, 2.4, 2.6, 6],
  [10, 1.3, -10, 6, 2.6, 2.4], [-10, 1.3, 8, 6, 2.6, 2.4],
  [12, 0.6, 14, 2.4, 1.2, 2.4], [-12, 0.6, -14, 2.4, 1.2, 2.4],
  [8, 3, -19, 3, 6, 3],
];
const FALLBACK_SITES = {
  A: { x: 22, z: -15.5, minX: 18, maxX: 26, minZ: -18.5, maxZ: -12.5 },
  B: { x: -22, z: 16.5, minX: -26, maxX: -18, minZ: 13.5, maxZ: 19.5 },
};
const FALLBACK_BOUNDS = { minX: -MAP.W / 2, maxX: MAP.W / 2, minZ: -MAP.D / 2, maxZ: MAP.D / 2 };

const FALLBACK_COLLIDERS = FALLBACK_WALLS.map(([cx, cy, cz, sx, sy, sz]) => ({
  min: { x: cx - sx / 2, y: cy - sy / 2, z: cz - sz / 2 },
  max: { x: cx + sx / 2, y: cy + sy / 2, z: cz + sz / 2 },
}));

function segmentBlocked(a, b, boxes) {
  for (let i = 0; i < boxes.length; i++) {
    const c = boxes[i];
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    let tmin = 0;
    let tmax = 1;
    let hit = true;
    for (let axis = 0; axis < 3; axis++) {
      const o = axis === 0 ? a.x : axis === 1 ? a.y : a.z;
      const dv = axis === 0 ? d.x : axis === 1 ? d.y : d.z;
      const mn = axis === 0 ? c.min.x : axis === 1 ? c.min.y : c.min.z;
      const mx = axis === 0 ? c.max.x : axis === 1 ? c.max.y : c.max.z;
      if (Math.abs(dv) < 1e-9) {
        if (o < mn || o > mx) { hit = false; break; }
      } else {
        let t1 = (mn - o) / dv;
        let t2 = (mx - o) / dv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { hit = false; break; }
      }
    }
    if (hit) return true;
  }
  return false;
}

let hudWorld = null;
export function setHudWorld(world) {
  hudWorld = world || null;
}

const HUD_CSS = [
  '#minimap{position:absolute;top:14px;left:18px;width:140px;height:140px;border:1px solid rgba(217,145,46,.45);border-radius:6px;background:rgba(24,20,16,.78)}',
  '#hud-status{position:absolute;top:162px;left:18px;font-size:13px;line-height:1.7;color:#f0e6d2;text-shadow:0 1px 4px #000}',
  '#hud-status .bomb{color:#f2b04d;font-weight:800}',
  '#hud-status .armor{color:#7fc96b;font-weight:700}',
  '#plant-bar{position:absolute;left:50%;bottom:110px;transform:translateX(-50%);width:260px;text-align:center}',
  '#plant-bar i{display:block;height:8px;background:#3a2f24;border:1px solid rgba(0,0,0,.5);border-radius:4px}',
  '#plant-bar span{display:block;margin-top:4px;font-size:13px;letter-spacing:1px;color:#f0e6d2;text-shadow:0 1px 4px #000}',
  '#scoreboard{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:520px;max-width:92vw;background:rgba(24,20,16,.94);border:1px solid rgba(217,145,46,.45);border-radius:6px;padding:16px 20px;display:none;pointer-events:none}',
  '#scoreboard h2{color:#f2b04d;font-size:18px;margin-bottom:8px;letter-spacing:1px}',
  '#scoreboard table{width:100%;border-collapse:collapse;font-size:14px}',
  '#scoreboard th{text-align:left;color:#c9b896;font-size:12px;letter-spacing:1px;padding:3px 6px;border-bottom:1px solid rgba(217,145,46,.35)}',
  '#scoreboard td{padding:4px 6px}',
  '#scoreboard .t-atlas{color:#f2b04d;font-weight:700}',
  '#scoreboard .t-onyx{color:#6fc3be;font-weight:700}',
  '#scoreboard .hist{margin-top:10px;font-size:13px;color:#c9b896;line-height:1.7}',
  '#match-end .match-table{margin-top:10px;text-align:left;font-size:14px;line-height:1.6}',
  '#match-end .match-table table{width:100%;border-collapse:collapse}',
  '#match-end .match-table td{padding:2px 8px}',
  '#match-end .match-table .t-atlas{color:#f2b04d;font-weight:700}',
  '#match-end .match-table .t-onyx{color:#6fc3be;font-weight:700}',
  '#match-end .match-hist{margin-top:8px;font-size:13px;color:#c9b896}',
  '.buy-item.disabled{opacity:.45;cursor:default}',
  '.buy-item.owned{border-color:#7fc96b}',
].join('\n');

function $(id) {
  return document.getElementById(id);
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(1, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fmtMoney(n) {
  return `$${Math.floor(n).toLocaleString('en-US')}`;
}

function teamName(team) {
  return team === 'onyx' ? 'Onyx' : 'Atlas';
}

function siteName(site) {
  if (!site) return '';
  if (typeof site === 'string') return site;
  const p = site.pos || site;
  if (typeof p.x !== 'number' || typeof p.z !== 'number') return '';
  const dA = Math.hypot(p.x - 22, p.z - (-15.5));
  const dB = Math.hypot(p.x - (-22), p.z - 16.5);
  if (Math.min(dA, dB) > 12) return '';
  return dA <= dB ? 'A' : 'B';
}

function bombTimeLeft(state) {
  const bomb = state.bomb;
  if (!bomb) return 0;
  if (typeof bomb.timer === 'number') return Math.max(0, bomb.timer);
  return CFG.BOMB_TIME;
}

/** Show/hide an element the page hides with display:none in its stylesheet. */
function show(el, visible, display = 'block') {
  if (el) el.style.display = visible ? display : 'none';
}

function setText(el, value) {
  if (el && el.textContent !== value) el.textContent = value;
}

export function initHud(state) {
  const els = {
    hud: $('hud'),
    healthNum: $('health-num'),
    healthBar: $('health-bar'),
    healthFill: null,
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    timer: $('timer'),
    scoreAtlas: $('score-atlas'),
    scoreOnyx: $('score-onyx'),
    money: $('money'),
    roundNum: $('round-num'),
    topWrap: $('top-wrap'),
    killfeed: $('killfeed'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    banner: $('banner'),
    menu: $('menu'),
    btnStart: $('btn-start'),
    btnHowto: $('btn-howto'),
    buyMenu: $('buy-menu'),
    damageFlash: $('damage-flash'),
    roundEnd: $('round-end'),
    matchEnd: $('match-end'),
    selftest: $('selftest'),
  };
  if (els.healthBar) els.healthFill = els.healthBar.querySelector('div');

  if (!document.getElementById('hud-extra-css')) {
    const style = document.createElement('style');
    style.id = 'hud-extra-css';
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
  }

  let minimap = $('minimap');
  const minimapOwned = MINIMAP_TAKEOVER || !minimap;
  if (!minimap && els.hud) {
    minimap = document.createElement('canvas');
    minimap.id = 'minimap';
    minimap.width = MINIMAP_SIZE;
    minimap.height = MINIMAP_SIZE;
    els.hud.appendChild(minimap);
  }
  els.minimap = minimap;
  els.minimapCtx = minimap ? minimap.getContext('2d') : null;

  let status = $('hud-status');
  if (!status && els.hud) {
    status = document.createElement('div');
    status.id = 'hud-status';
    status.innerHTML = '<div class="armor"></div><div class="grenades"></div><div class="bomb"></div>';
    els.hud.appendChild(status);
  }
  els.status = status;
  els.statusArmor = status ? status.querySelector('.armor') : null;
  els.statusGrenades = status ? status.querySelector('.grenades') : null;
  els.statusBomb = status ? status.querySelector('.bomb') : null;

  let scoreboard = $('scoreboard');
  if (!scoreboard && els.hud) {
    scoreboard = document.createElement('div');
    scoreboard.id = 'scoreboard';
    els.hud.appendChild(scoreboard);
  }
  els.scoreboard = scoreboard;

  let progress = $('plant-bar');
  if (!progress && els.hud) {
    progress = document.createElement('div');
    progress.id = 'plant-bar';
    progress.style.display = 'none';
    const fill = document.createElement('i');
    const label = document.createElement('span');
    progress.append(fill, label);
    els.hud.appendChild(progress);
  }
  els.progress = progress;
  els.progressFill = progress ? progress.querySelector('i') : null;
  els.progressLabel = progress ? progress.querySelector('span') : null;

  if (!Array.isArray(state.roundHistory)) state.roundHistory = [];

  let bannerTimer = 0;
  let hitTimer = 0;
  let flashTimer = 0;
  let startHandler = null;
  let howtoHandler = null;
  let buyOpen = false;
  let scoreVisible = false;
  let lastMinimapDraw = 0;
  let lastScoreDraw = 0;
  let lastShotAt = 0;
  let lastCrossScale = 1;
  const lastShotById = new Map(); // shooterId -> performance.now()
  const last = {
    hp: -1, mag: -1, reserve: -1, timer: '', atlas: -1, onyx: -1,
    money: -1, round: -1, phase: '', status: '',
  };

  function addKillfeed(killer, victim, weapon, headshot) {
    if (!els.killfeed) return;
    const row = document.createElement('div');
    const k = document.createElement('span');
    k.className = 'killer';
    k.textContent = killer || '???';
    const w = document.createElement('span');
    w.textContent = ` ${weapon || ''} `;
    const v = document.createElement('span');
    v.className = 'victim';
    v.textContent = victim || '???';
    row.append(k, w, v);
    if (headshot) {
      const hs = document.createElement('span');
      hs.className = 'hs';
      hs.textContent = ' HEADSHOT';
      row.appendChild(hs);
    }
    els.killfeed.prepend(row);
    while (els.killfeed.children.length > KILLFEED_MAX) {
      els.killfeed.removeChild(els.killfeed.lastChild);
    }
    setTimeout(() => row.remove(), KILLFEED_TTL_MS);
  }

  function showBanner(text, sub) {
    if (!els.banner) return;
    const main = els.banner.querySelector('.banner-main');
    const subEl = els.banner.querySelector('.banner-sub');
    if (main) {
      main.textContent = text;
      if (subEl) subEl.textContent = sub || '';
    } else {
      els.banner.textContent = sub ? `${text} — ${sub}` : text;
    }
    show(els.banner, true);
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => show(els.banner, false), BANNER_MS);
  }

  function showHitmarker(killed, headshot) {
    if (!els.hitmarker) return;
    els.hitmarker.classList.add('show');
    els.hitmarker.classList.toggle('headshot', !!(headshot || killed));
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => {
      els.hitmarker.classList.remove('show', 'headshot');
    }, HITMARKER_MS);
  }

  function flashDamage() {
    if (!els.damageFlash) return;
    show(els.damageFlash, true);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => show(els.damageFlash, false), FLASH_MS);
  }

  function buyRow(dataset, name, priceText) {
    const item = document.createElement('div');
    item.className = 'buy-item';
    Object.assign(item.dataset, dataset);
    const left = document.createElement('span');
    const nameEl = document.createElement('span');
    nameEl.className = 'buy-name';
    nameEl.textContent = name;
    left.appendChild(nameEl);
    const price = document.createElement('span');
    price.className = 'buy-price';
    price.textContent = priceText;
    item.append(left, price);
    return item;
  }

  function buildBuyMenu() {
    if (!els.buyMenu) return;
    const grid = els.buyMenu.querySelector('.buy-grid');
    const host = grid || els.buyMenu;
    if (grid && grid.children.length === 0) {
      for (const [kind, def] of Object.entries(WEAPONS)) {
        host.appendChild(buyRow({ weapon: kind }, def.name, def.price > 0 ? fmtMoney(def.price) : 'Owned'));
      }
      for (const [kind, def] of Object.entries(GRENADE_COPY)) {
        host.appendChild(buyRow({ grenade: kind }, def.name, fmtMoney(def.price)));
      }
      host.appendChild(buyRow({ armor: 'vest' }, 'Kevlar Vest', fmtMoney(650)));
    }
    for (const item of els.buyMenu.querySelectorAll('.buy-item[data-buy]')) {
      const kind = item.dataset.buy;
      if (kind === 'armor') {
        item.dataset.armor = 'vest';
      } else if (WEAPONS[kind]) {
        item.dataset.weapon = kind;
        const price = item.querySelector('.price, .buy-price');
        if (price) price.textContent = WEAPONS[kind].price > 0 ? fmtMoney(WEAPONS[kind].price) : 'Owned';
        const name = item.querySelector('.name, .buy-name');
        if (name) name.textContent = WEAPONS[kind].name;
      }
      delete item.dataset.buy;
    }
    const ensure = (sel, make) => {
      if (!els.buyMenu.querySelector(sel)) host.appendChild(make());
    };
    for (const [kind, def] of Object.entries(WEAPONS)) {
      ensure(`[data-weapon="${kind}"]`, () => buyRow({ weapon: kind }, def.name, def.price > 0 ? fmtMoney(def.price) : 'Owned'));
    }
    for (const [kind, def] of Object.entries(GRENADE_COPY)) {
      ensure(`[data-grenade="${kind}"]`, () => buyRow({ grenade: kind }, def.name, fmtMoney(def.price)));
    }
    ensure('[data-armor]', () => buyRow({ armor: 'vest' }, 'Kevlar Vest', fmtMoney(650)));
    refreshBuyAffordability();
  }

  function refreshBuyAffordability() {
    if (!els.buyMenu) return;
    const me = localPlayer(state);
    const cash = me ? me.money : 0;
    for (const item of els.buyMenu.querySelectorAll('[data-weapon]')) {
      const def = WEAPONS[item.dataset.weapon];
      const owned = !!me && me.weapon === item.dataset.weapon;
      const afford = !!def && (def.price <= 0 || owned || cash >= def.price);
      item.classList.toggle('disabled', !afford);
      item.classList.toggle('owned', owned);
    }
    for (const item of els.buyMenu.querySelectorAll('[data-grenade]')) {
      const def = GRENADE_COPY[item.dataset.grenade];
      item.classList.toggle('disabled', !def || cash < def.price);
    }
    const armorBtn = els.buyMenu.querySelector('[data-armor]');
    if (armorBtn) {
      const owned = !!me && me.armor >= 100;
      armorBtn.classList.toggle('disabled', cash < 650 || owned);
      armorBtn.classList.toggle('owned', owned);
    }
  }

  function showBuyMenu() {
    if (state.phase !== 'buy') return;
    buildBuyMenu();
    show(els.buyMenu, true);
    buyOpen = true;
  }

  function hideBuyMenu() {
    show(els.buyMenu, false);
    buyOpen = false;
  }

  function onBuyClick(event) {
    const item = event.target.closest('.buy-item');
    if (!item || item.classList.contains('disabled')) return;
    const me = localPlayer(state);
    if (!me || state.phase !== 'buy') return;
    if (item.dataset.weapon) buyWeapon(me, item.dataset.weapon);
    else if (item.dataset.grenade) buyGrenade(me, item.dataset.grenade);
    else if (item.dataset.armor) buyArmor(me);
    refreshBuyAffordability();
  }

  function onKey(event) {
    if ((event.key === 'b' || event.key === 'B') && state.phase === 'buy') {
      if (buyOpen) hideBuyMenu();
      else showBuyMenu();
    }
    if (event.code === 'Tab' && (state.phase === 'playing' || state.phase === 'buy' || state.phase === 'roundEnd')) {
      event.preventDefault();
      setScoreboardVisible(true);
    }
  }

  function onKeyUp(event) {
    if (event.code === 'Tab') setScoreboardVisible(false);
  }

  function scoreRows() {
    const players = state.players.slice().sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths));
    return players.map((p) => (
      `<tr><td class="t-${p.team}">${p.name}${p.isLocal ? ' (YOU)' : ''}</td>` +
      `<td class="t-${p.team}">${teamName(p.team)}</td>` +
      `<td>${p.kills}</td><td>${p.deaths}</td></tr>`
    )).join('');
  }

  function historyLines() {
    if (!state.roundHistory.length) return '<div>No rounds finished yet.</div>';
    return state.roundHistory.map((h) => (
      `<div>Round ${h.round} — ${teamName(h.winner)} · ${h.reason || ''}</div>`
    )).join('');
  }

  function renderScoreboard() {
    if (!els.scoreboard) return;
    els.scoreboard.innerHTML =
      `<h2>SCOREBOARD — ATLAS ${state.score.atlas} : ${state.score.onyx} ONYX</h2>` +
      `<table><tr><th>PLAYER</th><th>TEAM</th><th>KILLS</th><th>DEATHS</th></tr>${scoreRows()}</table>` +
      `<div class="hist">${historyLines()}</div>`;
  }

  function setScoreboardVisible(visible) {
    scoreVisible = visible;
    if (visible) renderScoreboard();
    show(els.scoreboard, visible);
  }

  function setPhaseUI(phase) {
    if (els.menu) els.menu.style.display = phase === 'menu' ? '' : 'none';
    if (els.hud) els.hud.classList.toggle('on', phase !== 'menu');
    show(els.crosshair, phase === 'playing');
    show(els.topWrap, phase !== 'roundEnd' && phase !== 'matchEnd');
    if (phase !== 'buy') hideBuyMenu();
    if (phase === 'buy') showBuyMenu();
    if (phase !== 'roundEnd') show(els.roundEnd, false);
    if (phase !== 'matchEnd') show(els.matchEnd, false);
    if (phase === 'menu' || phase === 'matchEnd') setScoreboardVisible(false);
    last.phase = phase;
  }

  function showRoundEnd(winner, reason) {
    if (!els.roundEnd) return;
    const title = els.roundEnd.querySelector('.big') || els.roundEnd.querySelector('.round-end-title');
    const detail = els.roundEnd.querySelector('.sub') || els.roundEnd.querySelector('.round-end-reason');
    setText(title, winner ? `${teamName(winner)} win the round` : 'Round over');
    setText(detail, reason || `Atlas ${state.score.atlas} — ${state.score.onyx} Onyx`);
    show(els.roundEnd, true);
  }

  function showMatchEnd(winner, score) {
    if (!els.matchEnd) return;
    const final = score || state.score;
    const title = els.matchEnd.querySelector('.big') || els.matchEnd.querySelector('.match-end-title');
    const detail = els.matchEnd.querySelector('.sub') || els.matchEnd.querySelector('.match-end-score');
    setText(title, winner ? `${teamName(winner)} win the match` : 'Match over');
    setText(detail, `Atlas ${final.atlas} — ${final.onyx} Onyx · First to ${CFG.WIN_ROUNDS} rounds`);
    let table = els.matchEnd.querySelector('.match-table');
    if (!table) {
      table = document.createElement('div');
      table.className = 'match-table';
      els.matchEnd.appendChild(table);
    }
    let hist = els.matchEnd.querySelector('.match-hist');
    if (!hist) {
      hist = document.createElement('div');
      hist.className = 'match-hist';
      els.matchEnd.appendChild(hist);
    }
    table.innerHTML =
      `<table><tr><th>PLAYER</th><th>TEAM</th><th>K</th><th>D</th></tr>${scoreRows()}</table>`;
    hist.innerHTML = historyLines();
    show(els.matchEnd, true);
  }

  function minimapData() {
    const w = hudWorld || state.world || null;
    const colliders = w && w.colliders ? w.colliders : FALLBACK_COLLIDERS;
    const sites = w && w.sites ? w.sites : FALLBACK_SITES;
    const bounds = w && w.bounds ? w.bounds : FALLBACK_BOUNDS;
    return { colliders, sites, bounds };
  }

  function drawMinimap(now) {
    const ctx = els.minimapCtx;
    if (!ctx) return;
    const { colliders, sites, bounds } = minimapData();
    const S = MINIMAP_SIZE;
    const pad = 6;
    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const scale = Math.min((S - pad * 2) / spanX, (S - pad * 2) / spanZ);
    const offX = (S - spanX * scale) / 2;
    const offY = (S - spanZ * scale) / 2;
    const toX = (x) => offX + (x - bounds.minX) * scale;
    const toY = (z) => offY + (z - bounds.minZ) * scale;

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(29,26,22,0.9)';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#8a7f70';
    for (const c of colliders) {
      const x = toX(c.min.x);
      const y = toY(c.min.z);
      const w = Math.max(1, (c.max.x - c.min.x) * scale);
      const h = Math.max(1, (c.max.z - c.min.z) * scale);
      ctx.fillRect(x, y, w, h);
    }
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const key of ['A', 'B']) {
      const s = sites[key];
      if (!s) continue;
      const box = s.box || (s.minX !== undefined
        ? { min: { x: s.minX, z: s.minZ }, max: { x: s.maxX, z: s.maxZ } }
        : null);
      const px = s.pos ? s.pos.x : s.x;
      const pz = s.pos ? s.pos.z : s.z;
      const x0 = box ? toX(box.min.x) : toX(px) - 4 * scale;
      const y0 = box ? toY(box.min.z) : toY(pz) - 3 * scale;
      const w = box ? (box.max.x - box.min.x) * scale : 8 * scale;
      const h = box ? (box.max.z - box.min.z) * scale : 6 * scale;
      ctx.strokeStyle = key === 'A' ? '#d9912e' : '#2e7f7a';
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(x0, y0, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = key === 'A' ? '#f2b04d' : '#6fc3be';
      ctx.fillText(key, x0 + w / 2, y0 + h / 2);
    }
    const bomb = state.bomb;
    if (bomb && bomb.pos && (bomb.state === 'planted' || bomb.state === 'dropped' ||
        (bomb.state === 'idle' && (bomb.pos.x !== 0 || bomb.pos.z !== 0)))) {
      const blink = bomb.state !== 'planted' || Math.floor(now / 400) % 2 === 0;
      if (blink) {
        ctx.fillStyle = bomb.state === 'planted' ? '#f28c1d' : '#ffe14d';
        ctx.beginPath();
        ctx.arc(toX(bomb.pos.x), toY(bomb.pos.z), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const me = localPlayer(state);
    const eye = me ? { x: me.pos.x, y: me.pos.y + CFG.EYE_HEIGHT, z: me.pos.z } : null;
    for (const p of state.players) {
      if (!p.alive) continue;
      if (p.isLocal) {
        const ang = Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw));
        ctx.save();
        ctx.translate(toX(p.pos.x), toY(p.pos.z));
        ctx.rotate(ang);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-4, -4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.team === (me ? me.team : 'atlas')) {
        ctx.fillStyle = '#2fa8a0';
        ctx.beginPath();
        ctx.arc(toX(p.pos.x), toY(p.pos.z), 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const chest = { x: p.pos.x, y: p.pos.y + 1.0, z: p.pos.z };
        const seen = eye ? !segmentBlocked(eye, chest, colliders) : false;
        const heard = now - (lastShotById.get(p.id) || 0) < ENEMY_SHOT_VISIBLE_MS;
        if (seen || heard) {
          ctx.fillStyle = '#e0483e';
          ctx.beginPath();
          ctx.arc(toX(p.pos.x), toY(p.pos.z), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.strokeStyle = 'rgba(217,145,46,0.45)';
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }

  function updateHud() {
    const now = performance.now();
    const me = localPlayer(state);
    const hp = me ? Math.max(0, Math.ceil(me.hp)) : 0;
    if (hp !== last.hp) {
      last.hp = hp;
      setText(els.healthNum, String(hp));
      if (els.healthNum) els.healthNum.classList.toggle('low', hp <= 30);
      if (els.healthFill) els.healthFill.style.width = `${hp}%`;
    }
    const mag = me ? me.mag : 0;
    const reserve = me ? me.reserve : 0;
    if (mag !== last.mag) {
      last.mag = mag;
      setText(els.ammoMag, String(mag));
    }
    if (reserve !== last.reserve) {
      last.reserve = reserve;
      setText(els.ammoReserve, ` / ${reserve}`);
    }
    const t = state.phase === 'buy' ? state.buyTimeLeft : state.timeLeft;
    const timerText = state.phase === 'buy' ? `BUY ${fmtTime(t)}` : fmtTime(t);
    if (timerText !== last.timer) {
      last.timer = timerText;
      setText(els.timer, timerText);
      if (els.timer) els.timer.classList.toggle('urgent', t <= 10 && state.phase !== 'menu');
    }
    if (state.score.atlas !== last.atlas) {
      last.atlas = state.score.atlas;
      setText(els.scoreAtlas, String(state.score.atlas));
    }
    if (state.score.onyx !== last.onyx) {
      last.onyx = state.score.onyx;
      setText(els.scoreOnyx, String(state.score.onyx));
    }
    const cash = me ? me.money : 0;
    if (cash !== last.money) {
      last.money = cash;
      setText(els.money, fmtMoney(cash));
    }
    if (state.round !== last.round) {
      last.round = state.round;
      setText(els.roundNum, `ROUND ${state.round} / ${CFG.MAX_ROUNDS}`);
    }
    if (state.phase !== last.phase) setPhaseUI(state.phase);

    if (els.crosshair) {
      const alive = !me || me.alive;
      show(els.crosshair, state.phase === 'playing' && alive);
      if (state.phase === 'playing' && alive && me) {
        const speed = Math.hypot(me.vel.x, me.vel.z);
        const bloom = me.bloom || 0;
        const kick = now - lastShotAt < 150 ? 0.45 : 0;
        const s = 1 + Math.min(0.9, speed * 0.05 + bloom * 12 + kick);
        if (Math.abs(s - lastCrossScale) > 0.02) {
          lastCrossScale = s;
          els.crosshair.style.transform = `translate(-50%, -50%) scale(${s.toFixed(2)})`;
        }
      } else if (lastCrossScale !== 1) {
        lastCrossScale = 1;
        els.crosshair.style.transform = '';
      }
    }

    if (els.status) {
      const armorLine = me && me.armor > 0 ? `ARMOR ${Math.ceil(me.armor)}` : '';
      const he = me && me.grenades ? (me.grenades.he || 0) : 0;
      const smoke = me && me.grenades ? (me.grenades.smoke || 0) : 0;
      const grenadeLine = he + smoke > 0 ? `HE x${he} · SMOKE x${smoke}` : '';
      let bombLine = '';
      const bomb = state.bomb;
      if (bomb) {
        if (bomb.state === 'planted') {
          const remain = bombTimeLeft(state);
          bombLine = `BOMB PLANTED — ${fmtTime(remain)}${siteName(bomb.site) ? ' @ ' + siteName(bomb.site) : ''}`;
        } else if (bomb.state === 'carried') {
          const carrier = state.players.find((p) => p.id === bomb.carrierId);
          bombLine = carrier
            ? (carrier.isLocal ? 'BOMB CARRIER: YOU — plant at A or B' : `BOMB CARRIER: ${carrier.name}`)
            : 'BOMB CARRIER: —';
        } else if (bomb.state === 'dropped' ||
            (bomb.state === 'idle' && state.phase !== 'menu' && bomb.pos && (bomb.pos.x !== 0 || bomb.pos.z !== 0))) {
          bombLine = 'BOMB DROPPED — recover it';
        }
      }
      const key = `${armorLine}|${grenadeLine}|${bombLine}`;
      if (key !== last.status) {
        last.status = key;
        setText(els.statusArmor, armorLine);
        setText(els.statusGrenades, grenadeLine);
        setText(els.statusBomb, bombLine);
      }
      const showStatus = (state.phase === 'playing' || state.phase === 'buy') && !!key.replaceAll('|', '');
      els.status.style.display = showStatus ? 'block' : 'none';
    }

    let label = '';
    let frac = 0;
    if (me && me.planting) {
      label = 'Planting bomb…';
      frac = Math.min(1, me.plantT / PLANT_TIME);
    } else if (me && me.defusing) {
      label = 'Defusing bomb…';
      frac = Math.min(1, me.defuseT / CFG.DEFUSE_TIME);
    } else if (state.bomb.state === 'planted') {
      label = 'Bomb planted — find cover';
      frac = Math.max(0, bombTimeLeft(state) / CFG.BOMB_TIME);
    }
    if (els.progress) {
      els.progress.style.display = label ? 'block' : 'none';
      if (label) {
        if (els.progressFill) {
          els.progressFill.style.background = `linear-gradient(90deg,#2e7f7a,#d9912e) 0 0/${Math.round(frac * 100)}% 100% no-repeat, #3a2f24`;
        }
        setText(els.progressLabel, label);
      }
    }

    if (minimapOwned && now - lastMinimapDraw >= MINIMAP_MS) {
      lastMinimapDraw = now;
      drawMinimap(now);
    }
    if (scoreVisible && now - lastScoreDraw >= 500) {
      lastScoreDraw = now;
      renderScoreboard();
    }
  }

  if (els.buyMenu) els.buyMenu.addEventListener('click', onBuyClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  if (els.btnStart) {
    els.btnStart.addEventListener('click', () => { if (startHandler) startHandler(); });
  }
  if (els.btnHowto) {
    els.btnHowto.addEventListener('click', () => { if (howtoHandler) howtoHandler(); });
  }

  state.events.on('killfeed', (e) => {
    if (e) addKillfeed(e.killer, e.victim, e.weapon, e.headshot);
  });
  state.events.on('death', (e) => {
    if (!e) return;
    const killer = typeof e.killer === 'string' ? e.killer : e.killer?.name;
    const victim = typeof e.victim === 'string' ? e.victim : e.victim?.name;
    if (killer && victim) addKillfeed(killer, victim, e.weapon, e.headshot);
  });
  state.events.on('damage', (e) => {
    if (!e) return;
    const victimId = typeof e.victim === 'string' ? e.victim : e.victim?.id;
    const attackerId = typeof e.attacker === 'string' ? e.attacker : e.attacker?.id;
    if (victimId === state.localPlayerId) flashDamage();
    if (attackerId === state.localPlayerId) showHitmarker(e.killed, e.headshot);
  });
  state.events.on('shot', (e) => {
    if (!e) return;
    if (e.shooterId) lastShotById.set(e.shooterId, performance.now());
    if (e.shooterId === state.localPlayerId) lastShotAt = performance.now();
  });
  state.events.on('plant', (e) => {
    const site = siteName((e && e.site) || state.bomb.site);
    const planter = e && e.playerId
      ? state.players.find((p) => p.id === e.playerId)
      : (e && e.planter) || null;
    const planterTeam = (e && e.team) || (planter && planter.team) || null;
    const me = localPlayer(state);
    const suffix = site ? ` at ${site}` : '';
    if (planterTeam && me && planterTeam !== me.team) {
      showBanner(`Enemy planted the bomb${suffix}!`, 'Defuse it before it blows');
    } else {
      showBanner(`Bomb planted${suffix}!`, 'Hold the site — 35 seconds');
    }
  });
  state.events.on('defuse', () => showBanner('Bomb defused', 'Site secure'));
  state.events.on('explode', () => showBanner('Bomb detonated', 'The site is gone'));
  state.events.on('halftime', (e) => {
    showBanner('Half-time — sides switch', e && e.attackTeam ? `Now ${teamName(e.attackTeam)} attack` : '');
  });
  state.events.on('roundEnd', (e) => {
    if (e) {
      const roundNo = e.round ?? state.round;
      if (!state.roundHistory.some((h) => h.round === roundNo)) {
        state.roundHistory.push({ round: roundNo, winner: e.winner, reason: e.reason || '' });
      }
      showBanner(`${teamName(e.winner)} win the round`, e.reason || '');
      showRoundEnd(e.winner, e.reason);
    }
  });
  state.events.on('matchEnd', (e) => {
    if (e) showMatchEnd(e.winner, e.score);
  });

  setPhaseUI(state.phase);
  updateHud();

  return {
    update: updateHud,
    updateHud,
    showBuyMenu,
    hideBuyMenu,
    showBanner,
    addKillfeed,
    setPhaseUI,
    showRoundEnd,
    showMatchEnd,
    flashDamage,
    showHitmarker,
    drawMinimap,
    setScoreboardVisible,
    onStart(handler) { startHandler = handler; },
    onHowto(handler) { howtoHandler = handler; },
    isBuyOpen() { return buyOpen; },
    destroy() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
      if (els.buyMenu) els.buyMenu.removeEventListener('click', onBuyClick);
      clearTimeout(bannerTimer);
      clearTimeout(hitTimer);
      clearTimeout(flashTimer);
    },
  };
}

let singleton = null;
let singletonState = null;

export function updateHud(state) {
  if (!singleton || singletonState !== state) {
    singleton = initHud(state);
    singletonState = state;
  }
  singleton.update();
}

export { fmtTime, fmtMoney };
