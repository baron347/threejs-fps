// player.js — local player controls and damage model for MERIDIAN DEPOT.
// WASD + Shift run + Ctrl/C crouch, AABB collision, clamped pitch, head bob.
// Damage: headshot x3, armor absorbs 50% first, death emits events.
import * as THREE from 'three';
import { CFG } from './state.js';
import { collideMove } from './world.js';

// Reused temporaries — never allocate in the hot path.
const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _acc = new THREE.Vector3();

const PITCH_MAX = (89 * Math.PI) / 180;

/** Create (or fetch) the local player entity and place it at a spawn. */
export function createLocalPlayer(state, world) {
  let p = null;
  for (const pl of state.players) if (pl.id === state.localPlayerId) p = pl;
  if (!p) {
    p = {
      id: state.localPlayerId,
      name: 'You',
      team: 'atlas',
      isBot: false,
      isLocal: true,
      pos: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      hp: 100,
      alive: true,
      weapon: 'pistol',
      mag: 12,
      reserve: 24,
      money: CFG.START_MONEY,
      crouched: false,
      kills: 0,
      deaths: 0,
      vel: new THREE.Vector3(),
      armor: 0,
      radius: CFG.PLAYER_RADIUS,
      height: CFG.PLAYER_HEIGHT,
      planting: false,
      plantT: 0,
      defusing: false,
      defuseT: 0,
      reloading: false,
      reloadT: 0,
      lastDamageAt: 0,
      lastAttackerId: null,
    };
    state.players.push(p);
  }
  const spawn = world.spawns.atlas[0];
  p.pos.copy(spawn);
  p.pos.y = 0;
  p.yaw = 0; // yaw 0 faces -Z (north): towards mid / site A from the south spawn
  p.pitch = 0;
  p.vel.set(0, 0, 0);
  return p;
}

/**
 * Per-tick local player update.
 * `input` is the object from createInput: { keys:Set, mouseDX, mouseDY,
 * consumeMouse(), ... }. `camera` is the THREE camera to drive.
 */
export function updatePlayer(dt, state, world, input, camera) {
  const p = state.players.find((pl) => pl.id === state.localPlayerId);
  if (!p || !p.alive) return;

  // --- Look ----------------------------------------------------------------
  const m = input.consumeMouse();
  p.yaw -= m.dx * 0.0022;
  p.pitch -= m.dy * 0.0022;
  if (p.pitch > PITCH_MAX) p.pitch = PITCH_MAX;
  if (p.pitch < -PITCH_MAX) p.pitch = -PITCH_MAX;

  // --- Crouch ---------------------------------------------------------------
  const wantCrouch = input.keys.has('ControlLeft') || input.keys.has('ControlRight') || input.keys.has('KeyC');
  p.crouched = wantCrouch;
  p.height = wantCrouch ? CFG.CROUCH_HEIGHT : CFG.PLAYER_HEIGHT;

  // --- Move -----------------------------------------------------------------
  const run = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
  const speed = wantCrouch ? CFG.CROUCH_SPEED : run ? CFG.RUN_SPEED : CFG.WALK_SPEED;

  _fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  _right.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  _wish.set(0, 0, 0);
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) _wish.add(_fwd);
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) _wish.sub(_fwd);
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) _wish.add(_right);
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) _wish.sub(_right);

  if (_wish.lengthSq() > 0) {
    _wish.normalize().multiplyScalar(speed);
    // Accelerate towards the wish velocity (horizontal only).
    _acc.subVectors(_wish, p.vel);
    _acc.y = 0;
    const maxDelta = CFG.ACCEL * dt;
    if (_acc.length() > maxDelta) _acc.setLength(maxDelta);
    p.vel.add(_acc);
  } else {
    // Decelerate to a stop.
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const drop = CFG.DECEL * dt;
    if (sp <= drop) { p.vel.x = 0; p.vel.z = 0; }
    else {
      const s = (sp - drop) / sp;
      p.vel.x *= s;
      p.vel.z *= s;
    }
  }

  collideMove(p.pos, p.vel, dt, world.colliders, p.radius, p.height);
  // Clamp inside the map bounds.
  if (p.pos.x < world.bounds.minX + p.radius) p.pos.x = world.bounds.minX + p.radius;
  if (p.pos.x > world.bounds.maxX - p.radius) p.pos.x = world.bounds.maxX - p.radius;
  if (p.pos.z < world.bounds.minZ + p.radius) p.pos.z = world.bounds.minZ + p.radius;
  if (p.pos.z > world.bounds.maxZ - p.radius) p.pos.z = world.bounds.maxZ - p.radius;

  // --- Camera ---------------------------------------------------------------
  const eyeH = wantCrouch ? CFG.CROUCH_EYE : CFG.EYE_HEIGHT;
  const planarSpeed = Math.hypot(p.vel.x, p.vel.z);
  const bobPhase = (p._bobPhase ?? 0) + planarSpeed * dt * 1.6;
  p._bobPhase = bobPhase;
  const bobAmp = wantCrouch ? 0.012 : 0.03;
  const bob = planarSpeed > 0.5 ? Math.sin(bobPhase * 2) * bobAmp * Math.min(1, planarSpeed / CFG.WALK_SPEED) : 0;

  camera.position.set(p.pos.x, p.pos.y + eyeH + bob, p.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;
  camera.rotation.z = 0;
}

/**
 * Apply damage to `target`. Headshots deal x3. Armor absorbs 50% of the
 * incoming damage first (armor points are spent 1:1 with absorbed damage).
 * On death: alive=false, deaths++, killer kills++, emit 'death' and 'damage'.
 * Returns the final hp damage dealt.
 */
export function applyDamage(target, amount, hitPart, attacker, state) {
  if (!target || !target.alive) return 0;
  let dmg = amount;
  const headshot = hitPart === 'head';
  if (headshot) dmg *= 3;

  let absorbed = 0;
  if (target.armor > 0) {
    absorbed = Math.min(target.armor, dmg * 0.5);
    target.armor -= absorbed;
    dmg -= absorbed;
  }
  dmg = Math.max(0, Math.round(dmg));
  target.hp -= dmg;
  target.lastDamageAt = state.elapsed;
  if (attacker) target.lastAttackerId = attacker.id;

  state.events.emit('damage', {
    victim: target,
    attacker,
    targetId: target.id,
    attackerId: attacker ? attacker.id : null,
    amount: dmg,
    absorbed,
    headshot,
    hp: Math.max(0, target.hp),
    killed: target.hp <= 0,
  });

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths += 1;
    target.planting = false;
    target.defusing = false;
    if (attacker && attacker !== target) {
      attacker.kills += 1;
      attacker.money += CFG.KILL_REWARD;
    }
    state.events.emit('death', {
      victim: target,
      killer: attacker,
      victimId: target.id,
      killerId: attacker ? attacker.id : null,
      weapon: attacker ? attacker.weapon : null,
      headshot,
    });
    state.kills.push({
      killer: attacker ? attacker.name : '—',
      victim: target.name,
      weapon: attacker ? attacker.weapon : '',
      headshot,
      t: state.elapsed,
    });
    if (state.kills.length > 6) state.kills.shift();
  }
  return dmg;
}
