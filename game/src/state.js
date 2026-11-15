// state.js — single store, constants and a tiny event bus for MERIDIAN DEPOT.
// Original code written for the make.fun threejs-fps-02 entry. No external refs.
import * as THREE from 'three';

export const CFG = Object.freeze({
  SIM_DT: 1 / 60,
  ROUND_TIME: 75, // seconds per round
  BOMB_TIME: 35, // seconds from plant to explosion
  DEFUSE_TIME: 5, // seconds to defuse
  BUY_TIME: 15, // seconds of buy phase
  WIN_ROUNDS: 5, // rounds to win the match
  MAX_ROUNDS: 9, // match ends at 9 rounds even if nobody reaches 5
  START_MONEY: 800,
  WIN_REWARD: 3250,
  LOSS_REWARD: 1900,
  KILL_REWARD: 300,
  PLANT_REWARD: 300,
  // Movement / combat tuning (shared so bots and player agree).
  WALK_SPEED: 4.6,
  RUN_SPEED: 6.4,
  CROUCH_SPEED: 2.3,
  ACCEL: 42,
  DECEL: 34,
  EYE_HEIGHT: 1.62,
  CROUCH_EYE: 1.05,
  PLAYER_RADIUS: 0.4,
  PLAYER_HEIGHT: 1.7,
  CROUCH_HEIGHT: 1.1,
  GRAVITY: 18,
});

/** Minimal synchronous event bus. Listeners are plain functions. */
export class Bus {
  constructor() {
    this.handlers = new Map();
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    const list = this.handlers.get(event);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(event, payload) {
    const list = this.handlers.get(event);
    if (!list) return;
    // Copy so a listener that unsubscribes mid-emit cannot break the loop.
    for (const fn of list.slice()) fn(payload);
  }
}

let nextId = 1;

/** Build one player entity. `overrides` may set team / isBot / pos / weapon. */
export function createPlayer(overrides = {}) {
  const id = overrides.id ?? `p${nextId++}`;
  return {
    id,
    name: overrides.name ?? id,
    team: overrides.team ?? 'atlas',
    isBot: overrides.isBot ?? false,
    isLocal: overrides.isLocal ?? false,
    pos: overrides.pos ? overrides.pos.clone() : new THREE.Vector3(),
    yaw: overrides.yaw ?? 0,
    pitch: overrides.pitch ?? 0,
    hp: 100,
    alive: true,
    weapon: overrides.weapon ?? 'pistol',
    mag: overrides.mag ?? 12,
    reserve: overrides.reserve ?? 24,
    money: overrides.money ?? CFG.START_MONEY,
    crouched: false,
    kills: 0,
    deaths: 0,
    vel: new THREE.Vector3(),
    armor: overrides.armor ?? 0,
    radius: CFG.PLAYER_RADIUS,
    height: CFG.PLAYER_HEIGHT,
    // Runtime-only fields (bots / weapons may use them; never serialized).
    planting: false,
    plantT: 0,
    defusing: false,
    defuseT: 0,
    reloading: false,
    reloadT: 0,
    lastDamageAt: 0,
    lastAttackerId: null,
  };
}

/** Fresh match state. One store; modules read/write it directly. */
export function createState() {
  return {
    phase: 'menu', // 'menu' | 'buy' | 'playing' | 'roundEnd' | 'matchEnd'
    round: 1,
    score: { atlas: 0, onyx: 0 },
    timeLeft: CFG.ROUND_TIME,
    buyTimeLeft: CFG.BUY_TIME,
    players: [],
    bomb: {
      state: 'idle', // 'idle' | 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded'
      carrierId: null,
      site: null,
      plantT: 0,
      timer: 0, // countdown while planted (rounds.js decrements it)
      pos: new THREE.Vector3(),
    },
    localPlayerId: 'p0',
    kills: [], // recent killfeed entries {killer, victim, weapon, headshot, t}
    events: new Bus(),
    // Match bookkeeping.
    winner: null, // 'atlas' | 'onyx' | null
    roundWinner: null,
    roundEndReason: '',
    elapsed: 0, // seconds since match start (sim time)
    roundStartAt: 0,
    // --- Side switch (kontrak paruh) -------------------------------------
    // Paruh 1 (ronde 1-4): penyerang = onyx (bot Onyx menyerang + bawa bom,
    // Atlas bertahan). Paruh 2 (ronde 5-9): penyerang = atlas — PEMAIN jadi
    // penyerang dan MEMBAWA BOM (bomb.carrierId = 'p0'), bot Atlas menyerang,
    // bot Onyx bertahan. rounds.js memanggil applySideSwitch() tiap awal
    // ronde; bots.js membaca state.attackTeam untuk memilih perilaku.
    half: 1, // 1 | 2
    attackTeam: 'onyx', // 'onyx' | 'atlas'
    roundHistory: [], // [{round, winner, reason}] — satu entri per ronde selesai
    lossStreak: { atlas: 0, onyx: 0 }, // kekalahan beruntun per tim (bonus ekonomi)
    smokes: [], // asap aktif {pos, r, t} — ditulis weapon.js, dibaca canSee/bots
    settings: { difficulty: 'veteran' }, // 'recruit' | 'veteran' | 'elite'
  };
}

/** Set half + attackTeam dari nomor ronde saat ini. Ronde 1-4 = paruh 1. */
export function applySideSwitch(state) {
  state.half = state.round <= 4 ? 1 : 2;
  state.attackTeam = state.half === 1 ? 'onyx' : 'atlas';
  return state.attackTeam;
}

/** True bila pemain lokal sedang di tim penyerang (di paruh 2 ia bawa bom). */
export function isPlayerAttacker(state) {
  const p = localPlayer(state);
  return !!p && p.team === state.attackTeam;
}

/** Convenience: the local player entity, or null before spawn. */
export function localPlayer(state) {
  for (const p of state.players) if (p.id === state.localPlayerId) return p;
  return null;
}

/** Reset per-round fields without touching the match score. */
export function resetRoundState(state) {
  applySideSwitch(state);
  state.timeLeft = CFG.ROUND_TIME;
  state.buyTimeLeft = CFG.BUY_TIME;
  state.roundWinner = null;
  state.roundEndReason = '';
  state.bomb.state = 'idle';
  state.bomb.carrierId = null;
  state.bomb.site = null;
  state.bomb.plantT = 0;
  for (const p of state.players) {
    p.hp = 100;
    p.alive = true;
    p.planting = false;
    p.plantT = 0;
    p.defusing = false;
    p.defuseT = 0;
    p.reloading = false;
    p.reloadT = 0;
    p.vel.set(0, 0, 0);
  }
}
