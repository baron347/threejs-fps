// rounds.js — ronde, paruh/side-switch, bom, ekonomi untuk MERIDIAN DEPOT.
// Kode asli (worker 2). Kontrak yang dipakai:
//   - state.js: CFG, createState (phase 'menu'|'buy'|'playing'|'roundEnd'|'matchEnd',
//     score, round, timeLeft, buyTimeLeft, players, bomb{state,carrierId,site,
//     plantT,pos}, localPlayerId, events=Bus, kills[]), resetRoundState().
//   - weapon.js: buyWeapon, buyArmor (bot auto-buy), createWeaponState.
//   - bots.js: spawnBots, botBuyPhase (import siklik dengan rounds.js: bots.js
//     memakai plantBomb/defuseBomb dari sini; semua pemakaian terjadi di dalam
//     fungsi saat runtime, bukan saat evaluasi modul — aman di ESM).
//   - player.js: applyDamage menangani kill reward +300 dan emit death/damage.
//
// SIDE SWITCH: state.half (1|2), state.attackTeam ('onyx'|'atlas'),
// state.roundHistory[]. Paruh 1 (ronde 1-4): penyerang onyx. Paruh 2
// (ronde 5-9): penyerang atlas — pemain lokal jadi carrier (bomb.carrierId
// 'p0'). Skor LANJUT melewati halftime; menang tetap first-to-5.
// Bila carrier mati saat membawa bom, bom JATUH (state 'dropped') dan bisa
// diambil penyerang lain yang berjalan di atasnya.
// Field state yang dibuat di sini bila belum ada (createState worker 1 belum
// memilikinya): half, attackTeam, roundHistory, lossStreak, buyDone,
// roundEndT. rounds.js memastikan defaultnya di startMatch.
import { CFG, resetRoundState } from './state.js';
import { buyWeapon, buyArmor } from './weapon.js';
import { spawnBots, botBuyPhase } from './bots.js';

export const DEFUSE_REWARD = 300;
export const LOSS_STREAK_BONUS_2 = 500;
export const LOSS_STREAK_BONUS_3 = 1000;
export const BOMB_PICKUP_DIST = 1.2;
export const DEFUSE_DIST = 1.6;

function emit(state, name, payload) {
  if (state && state.events && typeof state.events.emit === 'function') {
    state.events.emit(name, payload);
  }
}

/** Tim bertahan = lawan dari tim penyerang. */
export function attackerTeam(state) {
  return state.attackTeam || 'onyx';
}
export function defenderTeam(state) {
  return attackerTeam(state) === 'onyx' ? 'atlas' : 'onyx';
}

/** Pastikan field paruh/ekonomi ada (defensif bila createState belum punya). */
function ensureMatchFields(state) {
  if (state.half === undefined) state.half = 1;
  if (!state.attackTeam) state.attackTeam = 'onyx';
  if (!state.roundHistory) state.roundHistory = [];
  if (!state.lossStreak) state.lossStreak = { atlas: 0, onyx: 0 };
  if (state.buyDone === undefined) state.buyDone = false;
  if (state.roundEndT === undefined) state.roundEndT = 0;
  if (!state.bomb) state.bomb = { state: 'idle', carrierId: null, site: null, plantT: 0, pos: null };
}

function findPlayer(state, id) {
  for (const p of state.players) if (p.id === id) return p;
  return null;
}

/** Pilih carrier ronde ini: onyx -> bot-onyx-0; atlas -> pemain lokal p0. */
function pickCarrier(state) {
  const atk = attackerTeam(state);
  if (atk === 'atlas') {
    const local = findPlayer(state, state.localPlayerId);
    if (local && local.alive) return local;
    for (const p of state.players) if (p.team === 'atlas' && p.isBot && p.alive) return p;
    return null;
  }
  for (const p of state.players) if (p.id === 'bot-onyx-0' && p.alive) return p;
  for (const p of state.players) if (p.team === 'onyx' && p.isBot && p.alive) return p;
  return null;
}

function respawnPlayer(p, world, indexInTeam) {
  const spawns = world.spawns[p.team];
  const spawn = spawns[indexInTeam % spawns.length];
  p.pos.copy(spawn);
  p.pos.x += (Math.random() - 0.5) * 0.8;
  p.pos.z += (Math.random() - 0.5) * 0.8;
  p.pos.y = 0;
  // Hadap tengah map.
  p.yaw = Math.atan2(-(0 - p.pos.x), -(0 - p.pos.z));
  p.pitch = 0;
  p.hp = 100;
  p.alive = true;
  p.vel.set(0, 0, 0);
  p.planting = false;
  p.plantT = 0;
  p.defusing = false;
  p.defuseT = 0;
  p.reloading = false;
  p.reloadT = 0;
  p.crouched = false;
  p.height = CFG.PLAYER_HEIGHT;
  // Isi ulang amunisi senjata yang sedang dipakai (uang & senjata dipertahankan).
  if (p.wstate) {
    const def = { pistol: [12, 48], rifle: [30, 90], smg: [32, 128], sniper: [5, 15] }[p.weapon] || [12, 48];
    p.wstate.mag = def[0];
    p.wstate.reserve = def[1];
    p.wstate.reloading = false;
    p.wstate.reloadT = 0;
    p.mag = def[0];
    p.reserve = def[1];
  }
}

/** Mulai match baru: reset skor/ronde/uang, spawn bot bila belum ada. */
export function startMatch(state, world) {
  ensureMatchFields(state);
  state.score = { atlas: 0, onyx: 0 };
  state.round = 1;
  state.half = 1;
  state.attackTeam = 'onyx';
  state.roundHistory = [];
  state.lossStreak = { atlas: 0, onyx: 0 };
  state.winner = null;
  state.roundWinner = null;
  state.roundEndReason = '';
  for (const p of state.players) {
    p.money = CFG.START_MONEY;
    p.kills = 0;
    p.deaths = 0;
    p.armor = 0;
    p.weapon = 'pistol';
    p.wstate = null;
    p.mag = 12;
    p.reserve = 48;
    p.grenades = { he: 0, smoke: 0 };
  }
  const bots = state.players.filter((p) => p.isBot).length;
  if (bots < 9) spawnBots(state, world);
  emit(state, 'matchStart', { attackTeam: state.attackTeam });
  startRound(state, world);
}

/** Mulai satu ronde: respawn semua, bom ke carrier, fase buy 15 detik. */
export function startRound(state, world) {
  ensureMatchFields(state);
  resetRoundState(state);
  state.phase = 'buy';
  state.buyTimeLeft = CFG.BUY_TIME;
  state.timeLeft = CFG.ROUND_TIME;
  state.buyDone = false;
  state.roundEndT = 0;

  const teamIdx = { atlas: 0, onyx: 0 };
  for (const p of state.players) {
    respawnPlayer(p, world, teamIdx[p.team] || 0);
    teamIdx[p.team] = (teamIdx[p.team] || 0) + 1;
  }

  const carrier = pickCarrier(state);
  if (carrier) {
    state.bomb.state = 'carried';
    state.bomb.carrierId = carrier.id;
    state.bomb.site = null;
    state.bomb.pos.copy(carrier.pos);
    state.bomb.timer = 0;
  } else {
    state.bomb.state = 'idle';
    state.bomb.carrierId = null;
  }
  emit(state, 'roundStart', {
    round: state.round, half: state.half, attackTeam: state.attackTeam,
    carrierId: state.bomb.carrierId,
  });
}

/**
 * Akhiri ronde: skor++, reward (menang +3250, kalah +1900 + bonus loss streak),
 * lalu hitung mundur 4.5 detik sebelum ronde berikut / halftime / match end.
 */
export function endRound(state, world, winner, reason) {
  if (!state || state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
  ensureMatchFields(state);
  state.score[winner] += 1;
  state.roundWinner = winner;
  state.roundEndReason = reason;
  state.roundHistory.push({ round: state.round, half: state.half, winner, reason });

  const loser = winner === 'atlas' ? 'onyx' : 'atlas';
  state.lossStreak[winner] = 0;
  state.lossStreak[loser] += 1;
  const streak = state.lossStreak[loser];
  const streakBonus = streak >= 3 ? LOSS_STREAK_BONUS_3 : streak >= 2 ? LOSS_STREAK_BONUS_2 : 0;
  for (const p of state.players) {
    if (p.team === winner) p.money += CFG.WIN_REWARD;
    else p.money += CFG.LOSS_REWARD + streakBonus;
  }

  state.phase = 'roundEnd';
  state.roundEndT = 4.5;
  emit(state, 'roundEnd', {
    winner, reason, score: { ...state.score },
    lossStreak: { ...state.lossStreak }, streakBonus,
  });
}

/** Akhiri match. */
export function endMatch(state, winner) {
  if (!state || state.phase === 'matchEnd') return;
  state.phase = 'matchEnd';
  state.winner = winner;
  emit(state, 'matchEnd', { winner, score: { ...state.score } });
}

function countAlive(state, team) {
  let n = 0;
  for (const p of state.players) if (p.team === team && p.alive) n += 1;
  return n;
}

/** Cek bom jatuh & diambil lagi (dipanggil tiap tick saat phase playing). */
function updateBombCarry(state) {
  const bomb = state.bomb;
  if (bomb.state === 'carried') {
    const carrier = bomb.carrierId ? findPlayer(state, bomb.carrierId) : null;
    if (!carrier || !carrier.alive) {
      // Carrier mati -> bom jatuh di posisi terakhirnya.
      bomb.state = 'dropped';
      if (carrier) bomb.pos.copy(carrier.pos);
      bomb.carrierId = null;
      emit(state, 'bombDropped', { pos: bomb.pos.clone() });
    } else {
      bomb.pos.copy(carrier.pos);
    }
  } else if (bomb.state === 'dropped') {
    const atk = attackerTeam(state);
    for (const p of state.players) {
      if (p.team !== atk || !p.alive) continue;
      const d = Math.hypot(p.pos.x - bomb.pos.x, p.pos.z - bomb.pos.z);
      if (d < BOMB_PICKUP_DIST) {
        bomb.state = 'carried';
        bomb.carrierId = p.id;
        bomb.pos.copy(p.pos);
        emit(state, 'bombPickup', { playerId: p.id });
        break;
      }
    }
  }
}

/** Bot beli otomatis sekali di awal fase buy. */
function runBotBuy(state) {
  for (const p of state.players) {
    if (!p.isBot || !p.alive) continue;
    botBuyPhase(p);
  }
}

/** Update timer & aturan ronde. Dipanggil tiap tick dari main loop. */
export function updateRound(dt, state, world) {
  if (!state) return;
  ensureMatchFields(state);

  if (state.phase === 'buy') {
    state.buyTimeLeft -= dt;
    if (!state.buyDone && state.buyTimeLeft < CFG.BUY_TIME - 0.5) {
      state.buyDone = true;
      runBotBuy(state);
    }
    if (state.buyTimeLeft <= 0) {
      state.phase = 'playing';
      emit(state, 'buyEnd', { round: state.round });
    }
    return;
  }

  if (state.phase === 'playing') {
    updateBombCarry(state);
    const bomb = state.bomb;
    const atk = attackerTeam(state);
    const def = defenderTeam(state);

    if (bomb.state === 'planted') {
      bomb.timer -= dt;
      if (bomb.timer <= 0) {
        bomb.state = 'exploded';
        emit(state, 'explode', { site: bomb.site ? bomb.site.pos : null });
        endRound(state, world, atk, 'bomb_exploded');
        return;
      }
    } else if (bomb.state === 'defused') {
      endRound(state, world, def, 'defused');
      return;
    } else {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        endRound(state, world, def, 'time_expired');
        return;
      }
    }

    // Eliminasi — kecuali bom sudah planted (lanjut sampai defuse/meledak).
    const atlasAlive = countAlive(state, 'atlas');
    const onyxAlive = countAlive(state, 'onyx');
    if (bomb.state === 'planted') {
      if (countAlive(state, def) === 0) {
        endRound(state, world, atk, 'eliminated');
        return;
      }
      // Penyerang habis tapi bom planted: ronde lanjut (defuse atau meledak).
    } else if (atlasAlive === 0 && onyxAlive === 0) {
      endRound(state, world, def, 'eliminated');
      return;
    } else if (atlasAlive === 0) {
      endRound(state, world, 'onyx', 'eliminated');
      return;
    } else if (onyxAlive === 0) {
      endRound(state, world, 'atlas', 'eliminated');
      return;
    }
    return;
  }

  if (state.phase === 'roundEnd') {
    state.roundEndT -= dt;
    if (state.roundEndT > 0) return;
    const atlasScore = state.score.atlas;
    const onyxScore = state.score.onyx;
    if (atlasScore >= CFG.WIN_ROUNDS || onyxScore >= CFG.WIN_ROUNDS ||
        state.round >= CFG.MAX_ROUNDS) {
      endMatch(state, atlasScore > onyxScore ? 'atlas' : 'onyx');
      return;
    }
    // HALFTIME setelah ronde 4: ganti sisi, skor lanjut.
    if (state.round === 4) {
      state.half = 2;
      state.attackTeam = state.attackTeam === 'onyx' ? 'atlas' : 'onyx';
      emit(state, 'halftime', {
        half: 2, attackTeam: state.attackTeam, score: { ...state.score },
      });
    }
    state.round += 1;
    startRound(state, world);
  }
}

// --- Plant / defuse (channel, dipanggil tiap tick selama tombol ditekan) -----

function inSiteBox(pos, site) {
  if (!site || !site.box) return false;
  return (
    pos.x >= site.box.min.x && pos.x <= site.box.max.x &&
    pos.z >= site.box.min.z && pos.z <= site.box.max.z
  );
}

/**
 * Plant bom. Hanya carrier dari tim penyerang, di dalam box site, channel 3s.
 * Dipanggil tiap fixed tick (SIM_DT) selama tombol E ditekan; bergerak atau
 * tertembak membatalkan channel. Kembalikan progress 0..1, atau 'planted',
 * atau null bila tidak memenuhi syarat.
 */
export function plantBomb(player, site, state) {
  if (!player || !player.alive) return null;
  if (player.team !== attackerTeam(state)) return null;
  if (state.bomb.carrierId !== player.id) return null;
  if (state.bomb.state !== 'carried') return null;
  if (!inSiteBox(player.pos, site)) {
    player.plantT = 0;
    player.plantAnchor = null;
    return null;
  }
  // Batal hanya bila bergerak (>0.5m); tertembak tidak membatalkan (seperti CS).
  if (!player.plantAnchor) {
    player.plantAnchor = { x: player.pos.x, z: player.pos.z };
  }
  const moved = Math.hypot(player.pos.x - player.plantAnchor.x, player.pos.z - player.plantAnchor.z);
  if (moved > 0.5) {
    player.plantT = 0;
    player.plantAnchor = null;
    return null;
  }
  player.planting = true;
  player.plantT += CFG.SIM_DT;
  if (player.plantT >= 3) {
    player.plantT = 0;
    player.planting = false;
    player.plantAnchor = null;
    state.bomb.state = 'planted';
    state.bomb.site = site;
    state.bomb.pos.copy(player.pos);
    state.bomb.timer = CFG.BOMB_TIME;
    state.bomb.carrierId = null;
    player.money += CFG.PLANT_REWARD;
    emit(state, 'plant', { site: site.pos ? site.pos.clone() : null, playerId: player.id });
    return 'planted';
  }
  return Math.min(1, player.plantT / 3);
}

/**
 * Defuse bom. Hanya tim bertahan, dekat bom planted (<1.6m), channel 5s.
 * Bergerak membatalkan; tertembak tidak (seperti CS). Selesai -> +300, bomb 'defused'
 * (updateRound lalu menutup ronde untuk tim bertahan).
 */
export function defuseBomb(player, state) {
  if (!player || !player.alive) return null;
  if (player.team === attackerTeam(state)) return null;
  if (state.bomb.state !== 'planted') return null;
  const d = Math.hypot(player.pos.x - state.bomb.pos.x, player.pos.z - state.bomb.pos.z);
  if (d > DEFUSE_DIST) {
    player.defuseT = 0;
    player.defuseAnchor = null;
    return null;
  }
  if (!player.defuseAnchor) {
    player.defuseAnchor = { x: player.pos.x, z: player.pos.z };
  }
  const moved = Math.hypot(player.pos.x - player.defuseAnchor.x, player.pos.z - player.defuseAnchor.z);
  if (moved > 0.3) {
    player.defuseT = 0;
    player.defuseAnchor = null;
    return null;
  }
  player.defusing = true;
  player.defuseT += CFG.SIM_DT;
  if (player.defuseT >= CFG.DEFUSE_TIME) {
    player.defuseT = 0;
    player.defusing = false;
    player.defuseAnchor = null;
    state.bomb.state = 'defused';
    player.money += DEFUSE_REWARD;
    emit(state, 'defuse', { playerId: player.id });
    return 'defused';
  }
  return Math.min(1, player.defuseT / CFG.DEFUSE_TIME);
}

// Re-export helper belanja untuk main.js (menu buy pemain lokal).
export { buyWeapon, buyArmor };
