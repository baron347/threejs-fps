// weapon.js — senjata hitscan, granat, viewmodel untuk MERIDIAN DEPOT.
// Kode asli (worker 2). Kontrak yang dipakai dari worker 1:
//   - state.js: CFG (SIM_DT, EYE_HEIGHT, CROUCH_EYE, GRAVITY, KILL_REWARD...),
//     createPlayer(); state.events adalah Bus (state.events.emit(...)).
//   - player.js: applyDamage(target, amount, hitPart, attacker, state).
//     PENTING: applyDamage mengalikan damage headshot x3 SECARA INTERNAL,
//     jadi tryShoot mengoper dmg*headMul/3 untuk headshot agar pengali
//     efektifnya tepat sama dengan WEAPONS[kind].headMul. Kill reward +300
import * as THREE from 'three';
import { CFG } from './state.js';
import { applyDamage } from './player.js';
import { hasLineOfSight } from './world.js';

export const WEAPONS = Object.freeze({
  pistol: {
    name: 'P9 Sidearm', price: 0, dmg: 34, headMul: 3, mag: 12, reserve: 48,
    interval: 0.28, auto: false, spread: 0.012, moveSpread: 0.03, recoil: 0.011,
    range: 60, tracer: 'tracer',
  },
  rifle: {
    name: 'AR-7 Jackal', price: 2700, dmg: 30, headMul: 3.2, mag: 30, reserve: 90,
    interval: 0.12, auto: true, spread: 0.014, moveSpread: 0.045, recoil: 0.016,
    range: 80,
  },
  smg: {
    name: 'KX-9 Hornet', price: 1500, dmg: 22, headMul: 3, mag: 32, reserve: 128,
    interval: 0.08, auto: true, spread: 0.014, moveSpread: 0.06, recoil: 0.012,
    range: 45,
  },
  sniper: {
    name: 'LR-90 Longbow', price: 4000, dmg: 100, headMul: 4, mag: 5, reserve: 15,
    interval: 1.1, auto: false, spread: 0.001, moveSpread: 0.09, recoil: 0.05,
    range: 120, scope: true,
  },
});

export const RELOAD_TIME = Object.freeze({ pistol: 1.6, rifle: 2.2, smg: 1.8, sniper: 3.0 });
export const GRENADE_PRICE = Object.freeze({ he: 300, smoke: 200 });
export const ARMOR_PRICE = 650;
export const ARMOR_VALUE = 50;
export const GRENADE_RADIUS = 6;
export const SMOKE_RADIUS = 3.5;
export const SMOKE_TIME = 12;

const PITCH_MAX = (89 * Math.PI) / 180;

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _eye = new THREE.Vector3();
const _headMin = new THREE.Vector3();
const _headMax = new THREE.Vector3();
const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();
const _up2 = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();

function emit(state, name, payload) {
  if (state && state.events && typeof state.events.emit === 'function') {
    state.events.emit(name, payload);
  }
}

/** Pastikan penembak punya weapon-state; sinkronkan mag/reserve ke entity. */
export function ensureWeaponState(shooter) {
  const kind = WEAPONS[shooter.weapon] ? shooter.weapon : 'pistol';
  if (!shooter.wstate || shooter.wstate.kind !== kind) {
    shooter.wstate = createWeaponState(kind);
  }
  shooter.weapon = kind;
  return shooter.wstate;
}

export function createWeaponState(kind) {
  const w = WEAPONS[kind] || WEAPONS.pistol;
  return { kind, mag: w.mag, reserve: w.reserve, cooldown: 0, reloading: false, reloadT: 0 };
}

function syncAmmo(shooter) {
  const ws = shooter.wstate;
  if (!ws) return;
  shooter.mag = ws.mag;
  shooter.reserve = ws.reserve;
  shooter.reloading = ws.reloading;
  shooter.reloadT = ws.reloadT;
}

/** Posisi mata penembak (dipakai sebagai origin ray). */
export function eyePos(shooter, out) {
  out.copy(shooter.pos);
  out.y += shooter.crouched ? CFG.CROUCH_EYE : CFG.EYE_HEIGHT;
  return out;
}

/** Arah bidik dari yaw/pitch; untuk pemain lokal pakai arah kamera bila ada. */
function aimDir(shooter, out, camera) {
  if (shooter.isLocal && camera) {
    camera.getWorldDirection(out);
    return out;
  }
  const cp = Math.cos(shooter.pitch);
  out.set(-Math.sin(shooter.yaw) * cp, Math.sin(shooter.pitch), -Math.cos(shooter.yaw) * cp);
  return out;
}


/** Ray vs AABB (slab method). Kembalikan t masuk terdekat, atau Infinity. */
function rayAABB(origin, dir, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z;
    const d = axis === 0 ? dir.x : axis === 1 ? dir.y : dir.z;
    const mn = axis === 0 ? min.x : axis === 1 ? min.y : min.z;
    const mx = axis === 0 ? max.x : axis === 1 ? max.y : max.z;
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return Infinity;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

/**
 * Jarak terdekat ray (origin + dir*t, 0<=t<=range) ke segmen a-b.
 * Implementasi closest-point antara dua segmen (Ericson, Real-Time
 * Collision Detection 5.1.9); ray diperlakukan sebagai segmen [o, o+dir*range].
 * Kembalikan { t, dist }.
 */
function raySegmentClosest(origin, dir, range, a, b) {
  const d1x = dir.x * range, d1y = dir.y * range, d1z = dir.z * range;
  const d2x = b.x - a.x, d2y = b.y - a.y, d2z = b.z - a.z;
  const rX = origin.x - a.x, rY = origin.y - a.y, rZ = origin.z - a.z;
  const a1 = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rX + d2y * rY + d2z * rZ;
  let s;
  let t;
  if (a1 <= 1e-9 && e <= 1e-9) {
    s = 0; t = 0;
  } else if (a1 <= 1e-9) {
    s = 0; t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1x * rX + d1y * rY + d1z * rZ;
    if (e <= 1e-9) {
      t = 0; s = Math.min(1, Math.max(0, -c / a1));
    } else {
      const b2 = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a1 * e - b2 * b2;
      s = denom > 1e-9 ? Math.min(1, Math.max(0, (b2 * f - c * e) / denom)) : 0;
      t = (b2 * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a1)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b2 - c) / a1)); }
    }
  }
  const c1x = origin.x + d1x * s, c1y = origin.y + d1y * s, c1z = origin.z + d1z * s;
  const c2x = a.x + d2x * t, c2y = a.y + d2y * t, c2z = a.z + d2z * t;
  const dx = c1x - c2x, dy = c1y - c2y, dz = c1z - c2z;
  return { t: s * range, dist: Math.sqrt(dx * dx + dy * dy + dz * dz) };
}

/** Titik tengah kepala (untuk hitbox kepala terpisah). */
export function headCenter(entity, out) {
  out.set(entity.pos.x, entity.pos.y + entity.height - 0.22, entity.pos.z);
  return out;
}

/** Jarak terdekat dari titik p ke segmen a-b (untuk cek asap & granat). */
function pointSegmentDist(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  let t = lenSq > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq : 0;
  t = Math.min(1, Math.max(0, t));
  const dx = p.x - (a.x + abx * t), dy = p.y - (a.y + aby * t), dz = p.z - (a.z + abz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}


/**
 * Hitscan satu tembakan. Ray dari mata penembak + spread (gerak, bloom dari
 * tembakan beruntun, spreadBonus untuk bot). Hit terdekat menang antara
 * kapsul tubuh + box kepala musuh vs AABB collider.
 * Kembalikan { hit, target, headshot, point } atau null bila tidak bisa
 * menembak (cooldown / reload / mag kosong -> reload otomatis dimulai).
 */
export function tryShoot(shooter, state, world, camera) {
  if (!shooter || !shooter.alive) return null;
  const ws = ensureWeaponState(shooter);
  if (ws.cooldown > 0 || ws.reloading) return null;
  const def = WEAPONS[ws.kind];
  if (ws.mag <= 0) {
    reload(shooter);
    return null;
  }

  ws.mag -= 1;
  ws.cooldown = def.interval;
  shooter.bloom = Math.min(0.03, (shooter.bloom || 0) + 0.004);
  shooter.pitch = Math.min(PITCH_MAX, Math.max(-PITCH_MAX, shooter.pitch + def.recoil));
  shooter.yaw += (Math.random() - 0.5) * def.recoil * 0.4;
  syncAmmo(shooter);

  const origin = eyePos(shooter, _origin);
  const dir = aimDir(shooter, _dir, camera);
  const moving = Math.hypot(shooter.vel.x, shooter.vel.z) > 0.5;
  const spread = def.spread + (moving ? def.moveSpread : 0) + (shooter.bloom || 0) + (shooter.spreadBonus || 0);
  _right.crossVectors(dir, _up).normalize();
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _up2.crossVectors(_right, dir).normalize();
  const offX = (Math.random() * 2 - 1) * spread;
  const offY = (Math.random() * 2 - 1) * spread;
  dir.addScaledVector(_right, offX).addScaledVector(_up2, offY).normalize();

  let bestT = Infinity;
  let bestTarget = null;
  let bestHead = false;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p === shooter || !p.alive || p.team === shooter.team) continue;
    headCenter(p, _eye);
    _headMin.set(_eye.x - 0.24, _eye.y - 0.24, _eye.z - 0.24);
    _headMax.set(_eye.x + 0.24, _eye.y + 0.24, _eye.z + 0.24);
    const tHead = rayAABB(origin, dir, _headMin, _headMax);
    if (tHead < bestT && tHead <= def.range) {
      bestT = tHead; bestTarget = p; bestHead = true;
    }
    const r = p.radius || 0.4;
    _segA.set(p.pos.x, p.pos.y + 0.25, p.pos.z);
    _segB.set(p.pos.x, p.pos.y + p.height - 0.35, p.pos.z);
    const body = raySegmentClosest(origin, dir, def.range, _segA, _segB);
    if (body.dist <= r && body.t < bestT) {
      bestT = body.t; bestTarget = p; bestHead = false;
    }
  }

  let wallT = Infinity;
  const colliders = world.colliders || [];
  for (let i = 0; i < colliders.length; i++) {
    const t = rayAABB(origin, dir, colliders[i].min, colliders[i].max);
    if (t < wallT) wallT = t;
  }

  const hitT = Math.min(bestT, wallT, def.range);
  _hitPoint.copy(origin).addScaledVector(dir, hitT);
  const point = _hitPoint.clone();

  emit(state, 'shot', {
    shooterId: shooter.id, weapon: ws.kind,
    pos: origin.clone(), dir: dir.clone(), point,
  });
  if (state.recentShots) {
    state.recentShots.push({ pos: origin.clone(), team: shooter.team, age: 0 });
    if (state.recentShots.length > 24) state.recentShots.shift();
  }

  if (bestTarget && bestT <= wallT && bestT <= def.range) {
    const dmgMul = shooter.dmgMul || 1;
    const dmg = (bestHead ? (def.dmg * def.headMul) / 3 : def.dmg) * dmgMul;
    applyDamage(bestTarget, dmg, bestHead ? 'head' : 'body', shooter, state);
    return { hit: true, target: bestTarget, headshot: bestHead, point };
  }
  return { hit: false, target: null, headshot: false, point };
}

/** Mulai reload (durasi per senjata). Kembalikan false bila tidak bisa. */
export function reload(shooter) {
  const ws = ensureWeaponState(shooter);
  const def = WEAPONS[ws.kind];
  if (ws.reloading || ws.mag >= def.mag || ws.reserve <= 0) return false;
  ws.reloading = true;
  ws.reloadT = RELOAD_TIME[ws.kind];
  syncAmmo(shooter);
  return true;
}


/** Titik a-b terhalang asap? (segmen menyentuh bola asap aktif). */
function blockedBySmoke(a, b, state) {
  const smokes = state.smokes || [];
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i];
    if (s.t <= 0) continue;
    if (pointSegmentDist(s.pos, a, b) < s.r) return true;
  }
  return false;
}

/**
 * Line-of-sight gabungan: collider (hasLineOfSight dari world.js) + asap.
 * Dipakai bot untuk persepsi; world.hasLineOfSight sendiri tidak kenal asap.
 * `world` adalah hasil buildWorld (punya .colliders).
 */
export function canSee(a, b, state, world) {
  if (!hasLineOfSight(a, b, (world && world.colliders) || [])) return false;
  if (blockedBySmoke(a, b, state)) return false;
  return true;
}

/** Lempar granat (konsumsi 1 dari inventory). kind 'he' | 'smoke'. */
export function throwGrenade(shooter, kind, state, world) {
  if (!shooter || !shooter.alive) return false;
  if (kind !== 'he' && kind !== 'smoke') return false;
  shooter.grenades = shooter.grenades || { he: 0, smoke: 0 };
  if ((shooter.grenades[kind] || 0) <= 0) return false;
  shooter.grenades[kind] -= 1;

  const origin = eyePos(shooter, _origin);
  const dir = aimDir(shooter, _dir, null);
  if (!state.grenades) state.grenades = [];
  state.grenades.push({
    kind,
    ownerId: shooter.id,
    ownerTeam: shooter.team,
    pos: origin.clone().addScaledVector(dir, 0.5),
    vel: dir.clone().multiplyScalar(14).add(shooter.vel),
    t: kind === 'he' ? 1.6 : 1.2,
  });
  return true;
}

function explodeGrenade(g, state) {
  if (g.kind === 'smoke') {
    if (!state.smokes) state.smokes = [];
    state.smokes.push({ pos: g.pos.clone(), r: SMOKE_RADIUS, t: SMOKE_TIME });
    emit(state, 'smoke', { pos: g.pos.clone(), r: SMOKE_RADIUS });
    return;
  }
  emit(state, 'explodeGrenade', { pos: g.pos.clone(), ownerId: g.ownerId });
  let owner = null;
  for (const p of state.players) if (p.id === g.ownerId) owner = p;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (!p.alive) continue;
    const dx = p.pos.x - g.pos.x, dy = (p.pos.y + 0.9) - g.pos.y, dz = p.pos.z - g.pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > GRENADE_RADIUS) continue;
    _eye.set(p.pos.x, p.pos.y + 0.9, p.pos.z);
    if (_grenadeWorld && !hasLineOfSight(g.pos, _eye, _grenadeWorld.colliders || [])) continue;
    let dmg = 110 - ((110 - 20) * d) / GRENADE_RADIUS;
    if (p.team === g.ownerTeam) dmg *= 0.5; // friendly fire setengah
    applyDamage(p, Math.round(dmg), 'body', owner, state);
  }
}

// bila world belum didaftarkan, ledakan tidak memblokir — aman default).
let _grenadeWorld = null;

/** Daftarkan world agar ledakan granat bisa cek LOS dinding. */
export function setGrenadeWorld(world) {
  _grenadeWorld = world;
}

// --- Update per-frame --------------------------------------------------------

export function updateWeapons(dt, state) {
  if (!state.smokes) state.smokes = [];
  if (!state.grenades) state.grenades = [];
  if (!state.recentShots) state.recentShots = [];

  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (!p.wstate) continue;
    const ws = p.wstate;
    if (ws.cooldown > 0) ws.cooldown -= dt;
    if (p.bloom > 0) p.bloom = Math.max(0, p.bloom - dt * 0.05);
    if (ws.reloading) {
      ws.reloadT -= dt;
      if (ws.reloadT <= 0) {
        const def = WEAPONS[ws.kind];
        const need = def.mag - ws.mag;
        const take = Math.min(need, ws.reserve);
        ws.mag += take;
        ws.reserve -= take;
        ws.reloading = false;
        ws.reloadT = 0;
      }
      syncAmmo(p);
    }
  }

  // Granat aktif: parabola + fuse.
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.vel.y -= CFG.GRAVITY * dt;
    g.pos.addScaledVector(g.vel, dt);
    if (g.pos.y < 0.15) {
      g.pos.y = 0.15;
      if (Math.abs(g.vel.y) > 1) g.vel.y = -g.vel.y * 0.35;
      else g.vel.y = 0;
      g.vel.x *= 0.8;
      g.vel.z *= 0.8;
    }
    g.t -= dt;
    if (g.t <= 0) {
      state.grenades.splice(i, 1);
      explodeGrenade(g, state);
    }
  }

  // Asap kedaluwarsa.
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    state.smokes[i].t -= dt;
    if (state.smokes[i].t <= 0) state.smokes.splice(i, 1);
  }

  // Jejak suara tembakan (untuk pendengaran bot), umur maks 2 detik.
  for (let i = state.recentShots.length - 1; i >= 0; i--) {
    state.recentShots[i].age += dt;
    if (state.recentShots[i].age > 2) state.recentShots.splice(i, 1);
  }
}

// --- Toko (fase buy) ---------------------------------------------------------

export function buyWeapon(player, kind) {
  const def = WEAPONS[kind];
  if (!def) return false;
  if (player.money < def.price) return false;
  player.money -= def.price;
  player.weapon = kind;
  player.wstate = createWeaponState(kind);
  player.mag = def.mag;
  player.reserve = def.reserve;
  player.reloading = false;
  player.reloadT = 0;
  return true;
}

export function buyGrenade(player, kind) {
  const price = GRENADE_PRICE[kind];
  if (price === undefined) return false;
  if (player.money < price) return false;
  player.money -= price;
  player.grenades = player.grenades || { he: 0, smoke: 0 };
  player.grenades[kind] = (player.grenades[kind] || 0) + 1;
  return true;
}

export function buyArmor(player) {
  if (player.money < ARMOR_PRICE) return false;
  player.money -= ARMOR_PRICE;
  player.armor = ARMOR_VALUE;
  return true;
}

// --- Viewmodel ---------------------------------------------------------------

/**
 * Viewmodel sederhana (box + silinder gelap) di kanan-bawah kamera.
 * Kembalikan { group, setWeapon(kind), kick(), setReloading(bool), update(dt) }.
 * main.js: camera.add(vm.group) — pastikan camera sudah di-add ke scene.
 */
export function buildViewmodel(scene, camera) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.6 });
  const darker = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.7, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2fa8a0, roughness: 0.5, metalness: 0.4 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.42), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 10), darker);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.32);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), darker);
  grip.position.set(0, -0.12, 0.12);
  grip.rotation.x = 0.35;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.1), darker);
  mag.position.set(0, -0.11, -0.02);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
  sight.position.set(0, 0.09, -0.05);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.16), darker);
  stock.position.set(0, 0, 0.26);

  group.add(body, barrel, grip, mag, sight, stock);
  group.position.set(0.26, -0.22, -0.45);
  camera.add(group);

  const vm = {
    group,
    kickT: 0,
    reloading: false,
    reloadPhase: 0,
    setWeapon(kind) {
      // Panjang & aksen mengikuti kelas senjata.
      if (kind === 'sniper') {
        barrel.scale.set(1, 2.1, 1);
        barrel.position.z = -0.5;
        body.scale.set(1, 1, 1.35);
        accent.color.set(0xd9912e);
      } else if (kind === 'smg') {
        barrel.scale.set(1, 0.7, 1);
        barrel.position.z = -0.26;
        body.scale.set(1, 1, 0.8);
        accent.color.set(0xe07b39);
      } else if (kind === 'rifle') {
        barrel.scale.set(1, 1.2, 1);
        barrel.position.z = -0.36;
        body.scale.set(1, 1, 1.05);
        accent.color.set(0x2fa8a0);
      } else {
        barrel.scale.set(1, 0.45, 1);
        barrel.position.z = -0.22;
        body.scale.set(0.9, 0.9, 0.65);
        accent.color.set(0x9aa0a6);
      }
    },
    kick() {
      vm.kickT = 1;
    },
    setReloading(on) {
      vm.reloading = on;
      if (on) vm.reloadPhase = 0;
    },
    update(dt) {
      if (vm.kickT > 0) vm.kickT = Math.max(0, vm.kickT - dt * 6);
      let dip = 0;
      if (vm.reloading) {
        vm.reloadPhase = Math.min(1, vm.reloadPhase + dt * 1.4);
        dip = Math.sin(vm.reloadPhase * Math.PI) * 0.09;
        if (vm.reloadPhase >= 1) vm.reloading = false;
      }
      group.position.z = -0.45 + vm.kickT * 0.07;
      group.position.y = -0.22 - dip + vm.kickT * 0.02;
      group.rotation.x = vm.kickT * 0.12;
    },
  };
  return vm;
}
