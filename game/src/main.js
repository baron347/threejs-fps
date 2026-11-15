// main.js — bootstrap and fixed-step loop for MERIDIAN DEPOT.
// Update order per tick: input -> player -> bots -> weapons -> rounds -> hud.
// Modules weapon.js / bots.js / rounds.js / hud.js are written by other
// workers; this file only imports the interfaces agreed in the task spec.
import * as THREE from 'three';
import { CFG, createState, localPlayer } from './state.js';
import { buildWorld, pointInSite } from './world.js';
import { createLocalPlayer, updatePlayer, applyDamage } from './player.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { WEAPONS, tryShoot, reload, throwGrenade, setGrenadeWorld, buildViewmodel, updateWeapons } from './weapon.js';
import { spawnBots, updateBots } from './bots.js';
import { startMatch, updateRound, plantBomb, defuseBomb } from './rounds.js';
import { initHud } from './hud.js';
import { createParticles } from './particles.js';

const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot'); // menu | play | buy | end
const SELFTEST = params.get('selftest') === '1';

// --- Renderer / scene / camera ----------------------------------------------
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, CFG.EYE_HEIGHT, 21);

// --- Game objects ------------------------------------------------------------
const state = createState();
const world = buildWorld(scene);
const input = createInput(renderer.domElement);
const audio = createAudio();
createLocalPlayer(state, world);
spawnBots(state, world);
setGrenadeWorld(world);
buildViewmodel(scene, camera);
const fx = createParticles(scene); // tracer + spark/puff pool, update tiap frame
const hud = initHud(state); // owns all DOM phase/menu/buy panels + killfeed

// --- Bot bodies: bots are state entities; render one simple body per bot -----
// (Without this, enemies are invisible in the 3D view — only the minimap shows
// them. Bodies are team-coloured; the local player is first-person, no body.)
const botMeshes = new Map();
const botBodyGeo = new THREE.BoxGeometry(0.55, 1.05, 0.32);
const botHeadGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const botGunGeo = new THREE.BoxGeometry(0.09, 0.12, 0.55);
const botMats = {
  atlas: new THREE.MeshStandardMaterial({ color: 0xd9912e, roughness: 0.8 }),
  onyx: new THREE.MeshStandardMaterial({ color: 0xe0483e, roughness: 0.8 }),
};
const botHeadMat = new THREE.MeshStandardMaterial({ color: 0x2b2b26, roughness: 0.9 });
const botGunMat = new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.6, metalness: 0.4 });
function syncBotMeshes() {
  for (let i = 0; i < state.players.length; i++) {
    const pl = state.players[i];
    if (!pl.isBot) continue;
    let g = botMeshes.get(pl.id);
    if (!g) {
      g = new THREE.Group();
      const body = new THREE.Mesh(botBodyGeo, botMats[pl.team] || botMats.onyx);
      body.position.y = 0.95;
      const head = new THREE.Mesh(botHeadGeo, botHeadMat);
      head.position.y = 1.65;
      const gun = new THREE.Mesh(botGunGeo, botGunMat);
      gun.position.set(0.2, 1.15, -0.35);
      body.castShadow = true;
      head.castShadow = true;
      g.add(body, head, gun);
      scene.add(g);
      botMeshes.set(pl.id, g);
    }
    g.visible = pl.alive;
    if (pl.alive) {
      g.position.set(pl.pos.x, pl.pos.y, pl.pos.z);
      g.rotation.y = pl.yaw;
    }
  }
}

// --- Audio bridge: game events -> procedural sounds ---------------------------
state.events.on('shot', (e) => { if (e) audio.shot(e.weapon || 'rifle'); });
state.events.on('damage', (e) => {
  if (e && e.attackerId === state.localPlayerId) audio.hit();
});
state.events.on('plant', () => audio.plant());
state.events.on('explode', () => audio.explode());
state.events.on('explodeGrenade', () => audio.explode());
state.events.on('roundEnd', (e) => {
  if (!e || !e.winner) return;
  if (e.winner === 'atlas') audio.roundWin();
  else audio.roundLose();
});

// --- HUD helpers ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function show(el, on) { if (el) el.style.display = on ? '' : 'none'; }

hud.onStart(() => {
  const diff = $('difficulty');
  if (diff && diff.value) state.settings.difficulty = diff.value;
  audio.ensure();
  input.requestLock();
  startMatch(state, world);
});
hud.onHowto(() => {
  const how = $('howto');
  if (how) show(how, how.style.display === 'none');
});
// Clicking the canvas while playing re-locks the pointer.
renderer.domElement.addEventListener('click', () => {
  if (state.phase === 'playing' || state.phase === 'buy') input.requestLock();
});

// --- Local-player combat (input phase of the tick) ---------------------------
// Firing: auto weapons fire while held, semi-auto only on the rising edge.
// R reload (edge), G = HE grenade, F = smoke grenade, hold E = plant/defuse,
// right mouse = sniper scope (FOV 75 -> 38).
let prevMouseDown = false;
function updateLocalCombat() {
  const p = localPlayer(state);
  if (!p || !p.alive) { prevMouseDown = input.mouseDown; return; }
  // Fase buy bukan fase tempur: pemain tidak bisa menembak/melempar granat
  // sebelum ronde dimulai.
  if (state.phase !== 'playing') { prevMouseDown = input.mouseDown; return; }
  const def = WEAPONS[p.weapon] || WEAPONS.pistol;
  const held = input.mouseDown && input.locked;
  const edge = held && !prevMouseDown;
  prevMouseDown = input.mouseDown;
  if (held && (def.auto || edge)) {
    const res = tryShoot(p, state, world, camera);
    if (res === null && p.mag <= 0) audio.dryFire();
  }
  if (input.consumePressed('KeyR')) reload(p);
  if (input.consumePressed('KeyG')) throwGrenade(p, 'he', state, world);
  if (input.consumePressed('KeyF')) throwGrenade(p, 'smoke', state, world);
  if (input.keys.has('KeyE')) {
    if (p.team === state.attackTeam && state.bomb.state === 'carried' && state.bomb.carrierId === p.id) {
      const site = pointInSite(p.pos, world.sites.A) ? world.sites.A
        : pointInSite(p.pos, world.sites.B) ? world.sites.B : null;
      if (site) plantBomb(p, site, state);
    } else if (state.bomb.state === 'planted' && p.team !== state.attackTeam) {
      defuseBomb(p, state);
    }
  }
  const wantScope = input.mouseDownRight && p.weapon === 'sniper';
  const targetFov = wantScope ? 38 : 75;
  if (Math.abs(camera.fov - targetFov) > 0.5) {
    camera.fov += (targetFov - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
}

// --- Fixed-step loop -----------------------------------------------------------
let last = performance.now();
let acc = 0;

function tick(now) {
  requestAnimationFrame(tick);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // tab-switch clamp

  if (state.phase === 'playing' || state.phase === 'buy' || state.phase === 'roundEnd') {
    acc += dt;
    let steps = 0;
    while (acc >= CFG.SIM_DT && steps < 5) {
      updatePlayer(CFG.SIM_DT, state, world, input, camera);
      updateLocalCombat();
      updateBots(CFG.SIM_DT, state, world);
      updateWeapons(CFG.SIM_DT, state);
      updateRound(CFG.SIM_DT, state, world);
      state.elapsed += CFG.SIM_DT; // jam sim maju per fixed tick, bukan per frame
      acc -= CFG.SIM_DT;
      steps++;
    }
    if (steps === 5) acc = 0; // drop backlog, never spiral
  } else {
    // Menu / round-end / match-end: keep the camera where it is, drain input.
    input.consumeMouse();
  }

  hud.update();
  syncBotMeshes();
  fx.update(dt);
  renderer.render(scene, camera);
}

// --- Screenshot presets (?shot=...) — no pointer lock --------------------------
function applyShotPreset() {
  if (!SHOT) return;
  if (SHOT === 'menu') {
    state.phase = 'menu';
    camera.position.set(0, 6, 26);
    camera.lookAt(0, 1, 0);
  } else if (SHOT === 'play') {
    startMatch(state, world);
    // JANGAN paksa 'playing': startRound mulai di fase 'buy' 15 detik, dan
    // updateRound yang mengalihkannya ke 'playing'. Untuk screenshot, habiskan
    // buy phase lewat transisi aslinya (satu tick dengan buyTimeLeft 0).
    state.buyTimeLeft = 0;
    updateRound(CFG.SIM_DT, state, world);
    // Put the local player mid-map, facing site A, with two bots in view.
    // (Staged west of the mid-east container so the sightline stays clear.)
    const p = localPlayer(state);
    if (p) {
      p.pos.set(-6, 0, 6);
      p.yaw = -0.75; // faces north-east, towards site A
      p.pitch = 0;
      camera.position.set(p.pos.x, CFG.EYE_HEIGHT, p.pos.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = p.yaw;
      camera.rotation.x = 0;
    }
    const bots = state.players.filter((pl) => pl.isBot && pl.team === 'onyx');
    if (bots[0]) { bots[0].pos.set(1, 0, -1); bots[0].yaw = 2.5; }
    if (bots[1]) { bots[1].pos.set(5, 0, -4); bots[1].yaw = 2.45; }
    state.shotFreeze = true; // staged shot: bots hold position, no combat during capture
  } else if (SHOT === 'buy') {
    startMatch(state, world);
    state.phase = 'buy';
    state.buyTimeLeft = CFG.BUY_TIME;
  } else if (SHOT === 'end') {
    // Stage the match-end scoreboard: final score 5-4 to Atlas after 9 rounds.
    startMatch(state, world);
    state.score = { atlas: 5, onyx: 4 };
    state.round = 9;
    state.half = 2;
    state.roundHistory = [
      { round: 1, winner: 'atlas', reason: 'Elimination' },
      { round: 2, winner: 'onyx', reason: 'Bomb detonated' },
      { round: 3, winner: 'atlas', reason: 'Bomb defused' },
      { round: 4, winner: 'onyx', reason: 'Elimination' },
      { round: 5, winner: 'atlas', reason: 'Elimination' },
      { round: 6, winner: 'onyx', reason: 'Bomb detonated' },
      { round: 7, winner: 'atlas', reason: 'Bomb defused' },
      { round: 8, winner: 'onyx', reason: 'Time expired' },
      { round: 9, winner: 'atlas', reason: 'Elimination' },
    ];
    // Plausible staged tallies so the scoreboard table renders full.
    const tallies = { p0: [12, 5], 'bot-atlas-0': [8, 7], 'bot-atlas-1': [6, 8], 'bot-atlas-2': [9, 6], 'bot-atlas-3': [5, 9], 'bot-onyx-0': [11, 6], 'bot-onyx-1': [7, 8], 'bot-onyx-2': [8, 7], 'bot-onyx-3': [6, 9], 'bot-onyx-4': [4, 10] };
    for (const pl of state.players) {
      const t = tallies[pl.id];
      if (t) { pl.kills = t[0]; pl.deaths = t[1]; }
    }
    state.phase = 'matchEnd';
    state.events.emit('matchEnd', { winner: 'atlas', score: state.score });
  }
  hud.update(); // sync menu / HUD / buy panels to the preset phase
}

// --- Self-test (?selftest=1): 600 headless sim steps ---------------------------
function runSelfTest() {
  const el = $('selftest');
  const fail = (msg) => {
    if (el) { el.textContent = 'SELFTEST FAIL: ' + msg; el.style.display = 'block'; }
    console.error('SELFTEST FAIL:', msg);
  };
  try {
    startMatch(state, world);
    const p = localPlayer(state);
    if (!p || !p.alive) throw new Error('local player did not spawn alive');
    const bots = state.players.filter((pl) => pl.isBot);
    if (bots.length < 2) throw new Error('expected >=2 bots, got ' + bots.length);
    // One forced shot: local player damages the first living bot.
    const target = bots.find((b) => b.alive);
    if (!target) throw new Error('no living bot to shoot');
    const hpBefore = target.hp;
    applyDamage(target, 25, 'body', p, state);
    if (target.hp >= hpBefore) throw new Error('forced shot dealt no damage');
    // One bot update + 600 fixed steps of the full sim (no rendering).
    updateBots(CFG.SIM_DT, state, world);
    for (let i = 0; i < 600; i++) {
      updatePlayer(CFG.SIM_DT, state, world, input, camera);
      updateLocalCombat();
      updateBots(CFG.SIM_DT, state, world);
      updateWeapons(CFG.SIM_DT, state);
      updateRound(CFG.SIM_DT, state, world);
      state.elapsed += CFG.SIM_DT;
    }
    if (state.phase !== 'playing' && state.phase !== 'buy' && state.phase !== 'roundEnd') {
      throw new Error('unexpected phase after 600 steps: ' + state.phase);
    }
    if (el) { el.textContent = 'SELFTEST PASS'; el.style.display = 'block'; }
    console.log('SELFTEST PASS');
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  }
}

// --- Resize ----------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Boot ------------------------------------------------------------------------
applyShotPreset();
if (SELFTEST) {
  runSelfTest();
} else {
  requestAnimationFrame(tick);
}
