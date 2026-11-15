// bots.js — AI bot 5v5 untuk MERIDIAN DEPOT. Kode asli (worker 2).
// Bot adalah entity pemain biasa (isBot:true) dari createPlayer() state.js.
// Kontrak yang dipakai:
//   - world.js: buildWorld -> { colliders, spawns, sites, waypoints, bounds },
//     collideMove(pos, vel, dt, colliders, radius, height),
//     hasLineOfSight (dipakai lewat canSee di weapon.js, yang menambah asap).
//   - weapon.js: tryShoot, reload, canSee, createWeaponState, buyWeapon.
//   - rounds.js: plantBomb, defuseBomb (dipanggil bot saat channeling).
//   - player.js: applyDamage dipakai lewat tryShoot (kill reward +300 di sana).
// Tim: onyx = penyerang (bawa bom, plant di site A/B bergantian per ronde),
// atlas = bertahan (hold site, defuse bila bom planted). Pemain lokal atlas.
import * as THREE from 'three';
import { CFG, createPlayer } from './state.js';
import { collideMove } from './world.js';
import { tryShoot, reload, canSee, buyWeapon, buyArmor, WEAPONS } from './weapon.js';
import { plantBomb, defuseBomb } from './rounds.js';

/** Tingkat kesulitan dari state.settings.difficulty ('recruit'|'veteran'|'elite'). */
export const DIFFICULTY = Object.freeze({
  recruit: { reaction: 0.7, spreadMul: 1.6, dmgMul: 0.8 },
  veteran: { reaction: 0.45, spreadMul: 1.15, dmgMul: 1.0 },
  elite: { reaction: 0.28, spreadMul: 0.85, dmgMul: 1.1 },
});
export function difficultyOf(state) {
  const d = state && state.settings ? state.settings.difficulty : null;
  return DIFFICULTY[d] || DIFFICULTY.veteran;
}

/** Waypoint yang dianggap cover (dekat kontainer) — penyerang kadang berhenti aim. */
const COVER_WPS = new Set(['midS', 'midN', 'aMid', 'bMid', 'yardE', 'yardW']);

export const BOT_NAMES = Object.freeze({
  atlas: ['Rook', 'Sable', 'Ivy', 'Fenn'],
  onyx: ['Vex', 'Mara', 'Koda', 'Juno', 'Pike'],
});

// Senjata awal per tim (sesuai tugas): onyx 3 rifle + 2 smg, atlas 2 + 2.
const LOADOUT = Object.freeze({
  atlas: ['rifle', 'rifle', 'smg', 'smg'],
  onyx: ['rifle', 'rifle', 'rifle', 'smg', 'smg'],
});

const BOT_SPEED = 4.2; // m/s normal
const BOT_AIM_SPEED = 2.2; // m/s saat aim/menembak
const SEE_DIST = 42;
const FOV_COS = Math.cos((100 * Math.PI) / 180 / 2); // FOV 100 derajat
const HEAR_DIST = 25;
const TURN_RATE = 6; // rad/s

// Temporaries — tidak ada alokasi di hot loop.
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

/** Yaw yang menghadap dari `from` ke `to` (konvensi forward -sin/-cos). */
function yawTo(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clampAngle(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Waypoint terdekat dengan posisi (toleransi: kembalikan objek waypoint). */
function nearestWaypoint(world, pos) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < world.waypoints.length; i++) {
    const w = world.waypoints[i];
    const d = (w.pos.x - pos.x) ** 2 + (w.pos.z - pos.z) ** 2;
    if (d < bestD) { bestD = d; best = w; }
  }
  return best;
}

/**
 * BFS di graf waypoint: kembalikan array posisi (Vector3 waypoint + tujuan
 * akhir). Dipanggil hanya saat target berubah / bot stuck, bukan tiap frame.
 */
export function findPath(world, fromPos, toPos) {
  const wps = world.waypoints;
  const byId = new Map();
  for (const w of wps) byId.set(w.id, w);
  const start = nearestWaypoint(world, fromPos);
  const goal = nearestWaypoint(world, toPos);
  if (!start || !goal) return [{ id: null, pos: toPos.clone() }];
  if (start.id === goal.id) return [{ id: null, pos: toPos.clone() }];

  const prev = new Map();
  const queue = [start.id];
  prev.set(start.id, null);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === goal.id) break;
    const wp = byId.get(cur);
    if (!wp) continue;
    for (const nb of wp.links || []) {
      if (!prev.has(nb) && byId.has(nb)) {
        prev.set(nb, cur);
        queue.push(nb);
      }
    }
  }
  if (!prev.has(goal.id)) return [{ id: null, pos: toPos.clone() }]; // tidak ada rute: lurus saja
  const ids = [];
  let cur = goal.id;
  while (cur !== null) { ids.unshift(cur); cur = prev.get(cur); }
  const path = ids.map((id) => ({ id, pos: byId.get(id).pos.clone() }));
  path.push({ id: null, pos: toPos.clone() });
  return path;
}

/** Titik hold atlas: dekat site yang dijaga (offset acak kecil, deterministik). */
function holdPointFor(bot, world) {
  const site = world.sites[bot.ai.holdSite];
  if (!site) return new THREE.Vector3(0, 0, 0);
  const i = bot.ai.index;
  _t1.copy(site.pos);
  _t1.x += (i % 2 === 0 ? -3.5 : 3.5);
  _t1.z += (i < 2 ? 3 : -3);
  return _t1.clone();
}

/** Buat satu bot dari createPlayer + field runtime AI. */
function makeBot(state, world, team, index, name, weaponKind, spawnPos) {
  const bot = createPlayer({
    id: `bot-${team}-${index}`,
    name,
    team,
    isBot: true,
    pos: spawnPos,
    weapon: weaponKind,
    money: CFG.START_MONEY,
  });
  // Mag/reserve penuh sesuai senjata (createPlayer default pistol 12/24).
  const w = { rifle: [30, 90], smg: [32, 128], pistol: [12, 48], sniper: [5, 15] }[weaponKind];
  bot.mag = w[0];
  bot.reserve = w[1];
  bot.wstate = { kind: weaponKind, mag: w[0], reserve: w[1], cooldown: 0, reloading: false, reloadT: 0 };
  bot.bloom = 0;
  bot.spreadBonus = 0.01; // skill bot: spread lebih besar dari pemain
  bot.grenades = { he: 0, smoke: 0 };
  bot.yaw = team === 'onyx' ? Math.PI : 0; // onyx dari utara menghadap selatan, atlas sebaliknya
  bot.pitch = 0;
  // Hitbox kepala terpisah: helper di entity (kontrak).
  bot.headPos = function (out) {
    out = out || new THREE.Vector3();
    out.set(this.pos.x, this.pos.y + this.height - 0.22, this.pos.z);
    return out;
  };
  bot.ai = {
    index,
    mode: 'advance', // 'advance' | 'hold' | 'engage' | 'plant' | 'defuse' | 'retreat'
    targetSite: team === 'onyx' ? (state.round % 2 === 1 ? 'A' : 'B') : null,
    holdSite: team === 'atlas' ? (index < 2 ? 'A' : 'B') : null,
    path: null,
    pathI: 0,
    pathTarget: null,
    targetId: null,
    reactionT: 0,
    seenT: 0,
    burstLeft: 0,
    burstPause: 0,
    nextShotT: 0,
    aimErrYaw: 0,
    aimErrPitch: 0,
    thinkT: Math.random() * 0.15,
    heardPos: null,
    stuckT: 0,
    lastPos: spawnPos.clone(),
    holdT: 0,
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    strafeT: 0,
    coverT: 0, // jeda aim di waypoint cover
  };
  return bot;
}

/**
 * Spawn 4 bot atlas + 5 bot onyx (pemain lokal sudah ada sebagai atlas ke-5).
 * Carrier bom = bot onyx pertama ('Vex'). Idempotent: bila bot sudah ada,
 * tidak spawn ulang.
 */
export function spawnBots(state, world) {
  const existing = new Set(state.players.map((p) => p.id));
  const spawned = [];
  for (const team of ['atlas', 'onyx']) {
    const names = BOT_NAMES[team];
    const spawns = world.spawns[team];
    for (let i = 0; i < names.length; i++) {
      const id = `bot-${team}-${i}`;
      if (existing.has(id)) continue;
      const spawn = spawns[i % spawns.length].clone();
      spawn.x += (Math.random() - 0.5) * 1.2;
      spawn.z += (Math.random() - 0.5) * 1.2;
      spawn.y = 0;
      const bot = makeBot(state, world, team, i, names[i], LOADOUT[team][i], spawn);
      state.players.push(bot);
      spawned.push(bot);
    }
  }
  // Carrier bom: hanya bila penyerang = onyx (paruh 1). Paruh 2 carrier
  // adalah pemain lokal (diatur rounds.startRound per ronde).
  if (!state.bomb.carrierId && (state.attackTeam || 'onyx') === 'onyx') {
    const carrier = state.players.find((p) => p.id === 'bot-onyx-0');
    if (carrier) state.bomb.carrierId = carrier.id;
  }
  return spawned;
}

/** Bot membeli senjata di fase buy: rifle bila cukup, else smg, + armor. */
export function botBuyPhase(bot) {
  // Upgrade ke senjata terbaik yang mampu dibeli (pistol/SMG -> rifle bila mampu).
  if (bot.money >= 2700 && bot.weapon !== 'rifle') buyWeapon(bot, 'rifle');
  else if (bot.money >= 1500 && bot.weapon === 'pistol') buyWeapon(bot, 'smg');
  if (bot.money >= 650 && bot.armor <= 0) buyArmor(bot);
}

/** Set jalur bot menuju `dest` (Vector3). */
function setDestination(bot, world, dest) {
  bot.ai.path = findPath(world, bot.pos, dest);
  bot.ai.pathI = 0;
  bot.ai.pathTarget = dest.clone();
}

/** Musuh terdekat yang terlihat: jarak<42 + FOV 100° + LOS (termasuk asap). */
function perceive(bot, state, world) {
  let best = null;
  let bestD = Infinity;
  _eye.copy(bot.pos);
  _eye.y += bot.crouched ? CFG.CROUCH_EYE : CFG.EYE_HEIGHT;
  const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p === bot || !p.alive || p.team === bot.team) continue;
    const dx = p.pos.x - bot.pos.x;
    const dz = p.pos.z - bot.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > SEE_DIST || d >= bestD) continue;
    // FOV: cos sudut antara forward dan arah musuh.
    const cos = d > 0.01 ? (fx * dx + fz * dz) / d : 1;
    if (cos < FOV_COS) continue;
    _t1.set(p.pos.x, p.pos.y + 1.2, p.pos.z);
    if (!canSee(_eye, _t1, state, world)) continue;
    best = p;
    bestD = d;
  }
  return best ? { target: best, dist: bestD } : null;
}

/** Dengar tembakan musuh dalam 25m -> posisi suara (untuk investigasi). */
function hearShots(bot, state) {
  const shots = state.recentShots || [];
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (s.team === bot.team) continue;
    const dx = s.pos.x - bot.pos.x, dz = s.pos.z - bot.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < HEAR_DIST && d < bestD) { bestD = d; best = s.pos; }
  }
  return best;
}

/** Gerakkan bot menuju `dest` dengan kecepatan `speed`; kembalikan tiba? */
function moveToward(bot, world, dest, speed, dt) {
  _t1.subVectors(dest, bot.pos);
  _t1.y = 0;
  const d = _t1.length();
  if (d < 0.4) return true;
  _t1.multiplyScalar(speed / d);
  _vel.copy(_t1);
  collideMove(bot.pos, _vel, dt, world.colliders, bot.radius, bot.height);
  bot.vel.copy(_vel);
  // Hadap arah gerak (kecuali sedang engage — aim diatur terpisah).
  if (bot.ai.mode !== 'engage') {
    const want = yawTo(bot.pos, dest);
    bot.yaw += clampAngle(angleDiff(want, bot.yaw), -TURN_RATE * dt, TURN_RATE * dt);
  }
  // Clamp ke bounds.
  if (bot.pos.x < world.bounds.minX + bot.radius) bot.pos.x = world.bounds.minX + bot.radius;
  if (bot.pos.x > world.bounds.maxX - bot.radius) bot.pos.x = world.bounds.maxX - bot.radius;
  if (bot.pos.z < world.bounds.minZ + bot.radius) bot.pos.z = world.bounds.minZ + bot.radius;
  if (bot.pos.z > world.bounds.maxZ - bot.radius) bot.pos.z = world.bounds.maxZ - bot.radius;
  return d < 0.6;
}

/** Ikuti path waypoint; kembalikan true bila sudah sampai tujuan akhir. */
function followPath(bot, world, dt, state) {
  const ai = bot.ai;
  if (!ai.path || ai.pathI >= ai.path.length) return true;
  const speed = ai.mode === 'engage' ? BOT_AIM_SPEED : BOT_SPEED;
  const node = ai.path[ai.pathI];
  if (moveToward(bot, world, node.pos, speed, dt)) {
    // Sampai di waypoint cover: penyerang kadang berhenti 1-1.5s untuk aim.
    if (state && bot.team === (state.attackTeam || 'onyx') &&
        node.id && COVER_WPS.has(node.id) && Math.random() < 0.35) {
      ai.coverT = 1.0 + Math.random() * 0.5;
    }
    ai.pathI += 1;
  }
  return ai.pathI >= ai.path.length;
}

/** Jaga jarak antar pemain: min 2m antar bot satu tim (formasi longgar),
 *  1m untuk pasangan lain. Dorong pelan, tanpa alokasi. */
function separate(bot, state) {
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p === bot || !p.alive) continue;
    const sameTeamBots = bot.isBot && p.isBot && p.team === bot.team;
    const minD = sameTeamBots ? 2 : 1;
    const dx = bot.pos.x - p.pos.x, dz = bot.pos.z - p.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD * minD && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = (minD - d) * 0.5;
      bot.pos.x += (dx / d) * push;
      bot.pos.z += (dz / d) * push;
    }
  }
}

/** Update satu bot. Dipanggil dari updateBots tiap tick. */
function updateBot(bot, dt, state, world) {
  const ai = bot.ai;
  if (!bot.alive) return;

  // Freeze time: di luar fase 'playing' (buy / roundEnd / matchEnd) bot diam
  // di tempat dan tidak menembak — tidak ada pertempuran selama fase buy.
  if (state.phase !== 'playing') {
    bot.vel.set(0, 0, 0);
    return;
  }

  // --- Stuck detection (untuk re-path) --------------------------------------
  ai.stuckT += dt;
  if (ai.stuckT > 1.5) {
    const moved = Math.hypot(bot.pos.x - ai.lastPos.x, bot.pos.z - ai.lastPos.z);
    if (moved < 0.3 && (ai.mode === 'advance' || ai.mode === 'retreat')) {
      ai.path = null; // paksa re-path di bawah
    }
    ai.lastPos.copy(bot.pos);
    ai.stuckT = 0;
  }

  // --- Persepsi (throttle 0.15s, stagger per bot) ----------------------------
  ai.thinkT -= dt;
  let seen = null;
  if (ai.thinkT <= 0) {
    ai.thinkT = 0.15;
    seen = perceive(bot, state, world);
    if (seen) {
      if (ai.targetId !== seen.target.id) {
        // Musuh baru: reaction time dari tingkat kesulitan + jitter 0-150ms.
        const diff = difficultyOf(state);
        ai.reactionT = diff.reaction + Math.random() * 0.15;
        bot.spreadBonus = 0.01 * diff.spreadMul;
        bot.dmgMul = diff.dmgMul;
        ai.burstLeft = 0;
        ai.aimErrYaw = (Math.random() - 0.5) * 0.04;
        ai.aimErrPitch = (Math.random() - 0.5) * 0.03;
      }
      ai.targetId = seen.target.id;
      ai.seenT = 0;
    } else {
      ai.seenT += 0.15;
      if (ai.seenT > 1) ai.targetId = null;
    }
    // Pendengaran: hanya bila tidak sedang engage.
    if (!seen && ai.mode !== 'engage') {
      const heard = hearShots(bot, state);
      if (heard) ai.heardPos = heard.clone ? heard.clone() : heard;
    }
  }
  const target = ai.targetId
    ? state.players.find((p) => p.id === ai.targetId && p.alive)
    : null;

  const bombPlanted = state.bomb.state === 'planted';
  const bombDropped = state.bomb.state === 'dropped';
  const atkTeam = state.attackTeam || 'onyx';
  const isAttacker = bot.team === atkTeam;
  const isCarrier = state.bomb.carrierId === bot.id;
  // Site target penyerang bergantian per ronde (A di ronde ganjil, B genap).
  if (isAttacker) ai.targetSite = state.round % 2 === 1 ? 'A' : 'B';

  // --- Pilih mode ------------------------------------------------------------
  // Carrier bom tetap maju ke site kecuali musuh sudah sangat dekat (<12 m):
  // 'engage' yang meng-override 'advance' membuat carrier berhenti dan duel
  // di tengah jalan, sehingga bom tidak pernah sampai site.
  const targetDist = target
    ? Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z) : Infinity;
  const carrierPushing = isCarrier && isAttacker && !bombPlanted && targetDist > 6;
  // Bom jatuh: penyerang terdekat harus mengambilnya dulu, bukan duel —
  // 'advance' sudah mengarahkan ke bomb.pos; 'engage' tidak boleh menghalangi,
  // kecuali musuh sudah sangat dekat (<8 m).
  const recovering = bombDropped && isAttacker && targetDist > 8;
  // Bom sudah ditanam: defender harus defuse, bukan duel — 'engage' dan
  // 'retreat' tidak boleh menghalangi kecuali musuh sudah sangat dekat (<3 m).
  // (8 m terlalu jauh: defender berhenti duel di luar site dan tak pernah
  // sampai bom — diag 22 plant: 0 defender sampai 1,6 m.)
  const defusePushing = bombPlanted && !isAttacker && targetDist > 3;
  // Sudah channeling di atas bom: pertahankan defuse sampai selesai/mati —
  // tertembak tidak membatalkan channel, jadi 'engage' tidak boleh mencurinya.
  const defuseChanneling = bombPlanted && bot.defuseT > 0;
  if (target && !carrierPushing && !recovering && !defusePushing && !defuseChanneling) {
    ai.mode = 'engage';
  } else if (bot.hp < 30 && !bombPlanted && !carrierPushing && !recovering && !defusePushing) {
    ai.mode = 'retreat';
  } else if (bombPlanted) {
    // Semua bertahan lari ke site untuk defuse; penyerang jaga site.
    ai.mode = isAttacker ? 'hold' : 'defuse';
  } else if (isCarrier && isAttacker) {
    const site = world.sites[ai.targetSite];
    if (site && site.box &&
        bot.pos.x >= site.box.min.x && bot.pos.x <= site.box.max.x &&
        bot.pos.z >= site.box.min.z && bot.pos.z <= site.box.max.z) {
      ai.mode = 'plant';
    } else {
      ai.mode = 'advance';
    }
  } else if (isAttacker) {
    ai.mode = 'advance';
  } else {
    ai.mode = 'hold';
  }

  // --- Eksekusi mode ----------------------------------------------------------
  if (ai.mode === 'engage' && target) {
    // Aim ke musuh + error; strafe kiri-kanan; burst 3-5 peluru.
    _t1.set(target.pos.x, target.pos.y + 1.2, target.pos.z);
    _eye.copy(bot.pos);
    _eye.y += CFG.EYE_HEIGHT;
    _t2.subVectors(_t1, _eye);
    const dist = _t2.length();
    const wantYaw = Math.atan2(-_t2.x, -_t2.z) + ai.aimErrYaw;
    const wantPitch = Math.asin(Math.min(1, Math.max(-1, _t2.y / Math.max(0.01, dist)))) + ai.aimErrPitch;
    bot.yaw += clampAngle(angleDiff(wantYaw, bot.yaw), -TURN_RATE * dt, TURN_RATE * dt);
    bot.pitch += clampAngle(wantPitch - bot.pitch, -TURN_RATE * dt, TURN_RATE * dt);

    // Strafe pelan di antara burst; saat menembak bot berhenti (tanpa
    // moveSpread) — berhenti untuk membidik adalah yang game ini hargai.
    if (ai.burstLeft <= 0) {
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) {
        ai.strafeDir *= -1;
        ai.strafeT = 0.7 + Math.random() * 0.8;
      }
      _t3.set(Math.cos(bot.yaw) * ai.strafeDir, 0, -Math.sin(bot.yaw) * ai.strafeDir);
      _vel.copy(_t3).multiplyScalar(1.2);
      collideMove(bot.pos, _vel, dt, world.colliders, bot.radius, bot.height);
      bot.vel.copy(_vel);
    } else {
      // Berdiri diam saat menembak: bot.vel harus NOL, kalau tidak tryShoot
      // tetap menganggap bot bergerak (moveSpread) dari vel basi mode advance.
      bot.vel.set(0, 0, 0);
    }

    ai.reactionT -= dt;
    ai.nextShotT -= dt;
    const aimed = Math.abs(angleDiff(wantYaw, bot.yaw)) < 0.04;
    const hasLos = canSee(_eye, _t1, state, world);
    if (ai.reactionT <= 0 && aimed && hasLos && ai.nextShotT <= 0 && dist < 60) {
      if (ai.burstLeft <= 0) {
        ai.burstLeft = 3 + Math.floor(Math.random() * 3); // burst 3-5
        ai.burstPause = 0;
      }
      if (ai.burstLeft > 0) {
        const res = tryShoot(bot, state, world, null);
        if (res) {
          ai.burstLeft -= 1;
          // Interval bot lebih lambat dari pemain (skill): 1.6x interval senjata.
          const interval = (WEAPONS[bot.weapon] || WEAPONS.pistol).interval;
          ai.nextShotT = interval * 1.6;
          if (ai.burstLeft <= 0) ai.nextShotT = Math.max(ai.nextShotT, 0.5 + Math.random() * 0.4);
        } else if (bot.wstate && bot.wstate.mag <= 0) {
          reload(bot);
          ai.nextShotT = 0.5;
        }
      }
    }
  } else if (ai.mode === 'plant') {
    // Diam di site, channel plant 3s (plantBomb dipanggil tiap tick).
    bot.vel.set(0, 0, 0);
    const site = world.sites[ai.targetSite];
    plantBomb(bot, site, state);
  } else if (ai.mode === 'defuse') {
    // Ke bom planted, lalu channel defuse 5s.
    _t1.copy(state.bomb.pos);
    const d = Math.hypot(_t1.x - bot.pos.x, _t1.z - bot.pos.z);
    if (d > 1.6) {
      if (!ai.path || ai.pathTarget === null ||
          Math.hypot(ai.pathTarget.x - _t1.x, ai.pathTarget.z - _t1.z) > 1) {
        setDestination(bot, world, _t1);
      }
      followPath(bot, world, dt, state);
    } else {
      bot.vel.set(0, 0, 0);
      defuseBomb(bot, state);
    }
  } else if (ai.mode === 'retreat') {
    const spawn = world.spawns[bot.team][ai.index % world.spawns[bot.team].length];
    if (!ai.path || ai.pathTarget === null ||
        Math.hypot(ai.pathTarget.x - spawn.x, ai.pathTarget.z - spawn.z) > 1) {
      setDestination(bot, world, spawn);
    }
    if (followPath(bot, world, dt, state)) {
      // Sampai di spawn: pulih ke hold/advance.
      ai.mode = isAttacker ? 'advance' : 'hold';
      ai.path = null;
    }
  } else if (ai.mode === 'hold') {
    if (bombPlanted && isAttacker) {
      // Jaga site yang ditanam (bomb.site bisa objek site atau key 'A'/'B').
      const site = typeof state.bomb.site === 'string'
        ? world.sites[state.bomb.site]
        : state.bomb.site;
      if (site) {
        if (!ai.path || ai.pathTarget === null ||
            Math.hypot(ai.pathTarget.x - site.pos.x, ai.pathTarget.z - site.pos.z) > 2) {
          setDestination(bot, world, site.pos);
        }
        followPath(bot, world, dt, state);
      }
    } else if (!isAttacker) {
      // Hold point dekat site yang dijaga; aim ke lane (arah tengah map).
      const hp = holdPointFor(bot, world);
      if (Math.hypot(hp.x - bot.pos.x, hp.z - bot.pos.z) > 1) {
        if (!ai.path || ai.pathTarget === null ||
            Math.hypot(ai.pathTarget.x - hp.x, ai.pathTarget.z - hp.z) > 1) {
          setDestination(bot, world, hp);
        }
        followPath(bot, world, dt, state);
      } else {
        bot.vel.set(0, 0, 0);
        ai.holdT += dt;
        // Aim bergantian ke lane masuk site.
        const look = ai.holdSite === 'A'
          ? { x: 24, z: -8 }
          : { x: -24, z: 8 };
        const want = yawTo(bot.pos, look);
        bot.yaw += clampAngle(angleDiff(want, bot.yaw), -TURN_RATE * dt * 0.5, TURN_RATE * dt * 0.5);
      }
    } else {
      bot.vel.set(0, 0, 0);
    }
  } else {
    // advance: penyerang menuju site target; bom jatuh -> ambil dulu;
    // bila dengar suara, selidiki dulu; cover pause menahan di waypoint.
    if (ai.coverT > 0) {
      ai.coverT -= dt;
      bot.vel.set(0, 0, 0);
      // Aim ke arah site target selama jeda cover.
      const site = world.sites[ai.targetSite];
      if (site) {
        const want = yawTo(bot.pos, site.pos);
        bot.yaw += clampAngle(angleDiff(want, bot.yaw), -TURN_RATE * dt, TURN_RATE * dt);
      }
      separate(bot, state);
      return;
    }
    let dest = null;
    if (bombDropped && isAttacker) {
      dest = state.bomb.pos;
    } else if (ai.heardPos) {
      dest = ai.heardPos;
      const wp = nearestWaypoint(world, ai.heardPos);
      if (wp) dest = wp.pos;
      ai.heardPos = null;
    } else if (isAttacker) {
      const site = world.sites[ai.targetSite];
      dest = site ? site.pos : new THREE.Vector3(0, 0, 0);
    } else {
      dest = holdPointFor(bot, world);
    }
    if (!ai.path || ai.pathTarget === null ||
        Math.hypot(ai.pathTarget.x - dest.x, ai.pathTarget.z - dest.z) > 1) {
      setDestination(bot, world, dest);
    }
    followPath(bot, world, dt, state);
  }

  separate(bot, state);
}

/** Update semua bot hidup. Dipanggil tiap tick dari main loop. */
export function updateBots(dt, state, world) {
  if (state.shotFreeze) return; // screenshot preset: bots hold their staged pose
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p.isBot && p.alive) updateBot(p, dt, state, world);
  }
}
