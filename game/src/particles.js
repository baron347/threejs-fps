// particles.js — partikel + tracer untuk MERIDIAN DEPOT. Kode asli (worker 2).
// Buffer pre-allocated (maks 600 partikel, ring buffer reuse) — tanpa alokasi
// per frame di hot loop. Tracer: pool 8 Line yang fade ~60ms.
// main.js memanggil: const fx = createParticles(scene); tiap frame
// fx.update(dt) (atau updateParticles(dt) untuk instance aktif terakhir).
// Tidak ada darah: hit memakai spark/puff kuning-putih (spawnHit).
import * as THREE from 'three';

export const MAX_PARTICLES = 600;
export const MAX_TRACERS = 8;

let activeInstance = null;

/** Instance partikel aktif terakhir (untuk export updateParticles(dt)). */
export function updateParticles(dt) {
  if (activeInstance) activeInstance.update(dt);
}

export function createParticles(scene) {
  // --- Points buffer (pre-allocated) ---------------------------------------
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i++) positions[i * 3 + 1] = -1000; // parkir mati
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.14,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // Per-partikel (array biasa, dialokasi sekali di sini, bukan per frame).
  const vel = new Float32Array(MAX_PARTICLES * 3);
  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  const grav = new Float32Array(MAX_PARTICLES);
  const baseColor = new Float32Array(MAX_PARTICLES * 3);
  let cursor = 0;

  // --- Pool tracer -----------------------------------------------------------
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i++) {
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const tm = new THREE.LineBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(tg, tm);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0, maxLife: 0.06 });
  }
  let tracerCursor = 0;

  function spawnOne(x, y, z, vx, vy, vz, r, g, b, ttl, gv) {
    const i = cursor;
    cursor = (cursor + 1) % MAX_PARTICLES;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
    baseColor[i * 3] = r;
    baseColor[i * 3 + 1] = g;
    baseColor[i * 3 + 2] = b;
    life[i] = ttl;
    maxLife[i] = ttl;
    grav[i] = gv;
  }

  const api = {
    points,
    tracers: tracers.map((t) => t.line),

    /** Integrasi + fade (warna -> hitam = tak terlihat di AdditiveBlending). */
    update(dt) {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          positions[i * 3 + 1] = -1000;
          colors[i * 3] = 0;
          colors[i * 3 + 1] = 0;
          colors[i * 3 + 2] = 0;
          continue;
        }
        vel[i * 3 + 1] -= grav[i] * dt;
        positions[i * 3] += vel[i * 3] * dt;
        positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
        positions[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (positions[i * 3 + 1] < 0.02) {
          positions[i * 3 + 1] = 0.02;
          vel[i * 3 + 1] = 0;
        }
        const f = life[i] / maxLife[i];
        colors[i * 3] = baseColor[i * 3] * f;
        colors[i * 3 + 1] = baseColor[i * 3 + 1] * f;
        colors[i * 3 + 2] = baseColor[i * 3 + 2] * f;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        if (t.life <= 0) {
          t.line.visible = false;
          t.line.material.opacity = 0;
        } else {
          t.line.material.opacity = 0.9 * (t.life / t.maxLife);
        }
      }
    },

    /** Jumlah partikel hidup (untuk HUD/debug performa). */
    aliveCount() {
      let n = 0;
      for (let i = 0; i < MAX_PARTICLES; i++) if (life[i] > 0) n += 1;
      return n;
    },

    /** Matikan semua partikel & tracer (dipakai saat ronde baru dimulai). */
    clear() {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        life[i] = 0;
        positions[i * 3 + 1] = -1000;
        colors[i * 3] = 0;
        colors[i * 3 + 1] = 0;
        colors[i * 3 + 2] = 0;
      }
      for (const t of tracers) {
        t.life = 0;
        t.line.visible = false;
        t.line.material.opacity = 0;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },

    /** Percikan benturan dinding/lantai. material: 'metal' | 'concrete' | 'default'. */
    spawnImpact(point, normal, material) {
      const n = 8;
      let r = 1.0, g = 0.8, b = 0.45; // metal: oranye-putih
      if (material === 'concrete') { r = 0.62; g = 0.58; b = 0.5; }
      else if (material === 'wood') { r = 0.8; g = 0.6; b = 0.35; }
      const nx = normal ? normal.x : 0, ny = normal ? normal.y : 1, nz = normal ? normal.z : 0;
      for (let k = 0; k < n; k++) {
        const sp = 2 + Math.random() * 3.5;
        spawnOne(
          point.x, point.y, point.z,
          nx * sp + (Math.random() - 0.5) * 3,
          ny * sp + Math.random() * 2.5,
          nz * sp + (Math.random() - 0.5) * 3,
          r, g, b, 0.3 + Math.random() * 0.3, 9,
        );
      }
    },

    /** Kilat moncong laras (3-4 partikel kuning-oranye searah tembak). */
    spawnMuzzle(pos, dir) {
      for (let k = 0; k < 4; k++) {
        spawnOne(
          pos.x, pos.y, pos.z,
          dir.x * 6 + (Math.random() - 0.5) * 2,
          dir.y * 6 + (Math.random() - 0.5) * 2,
          dir.z * 6 + (Math.random() - 0.5) * 2,
          1.0, 0.72, 0.25, 0.06 + Math.random() * 0.04, 0,
        );
      }
    },

    /** Ledakan granat HE: 40 api + 10 asap abu-abu. */
    spawnExplosion(pos) {
      for (let k = 0; k < 40; k++) {
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        const sp = 3 + Math.random() * 6;
        const hot = Math.random();
        spawnOne(
          pos.x, pos.y + 0.2, pos.z,
          Math.sin(ph) * Math.cos(th) * sp,
          Math.abs(Math.cos(ph)) * sp * 0.9 + 1.5,
          Math.sin(ph) * Math.sin(th) * sp,
          1.0, 0.35 + hot * 0.5, 0.1 + hot * 0.2,
          0.5 + Math.random() * 0.5, 6,
        );
      }
      for (let k = 0; k < 10; k++) {
        spawnOne(
          pos.x + (Math.random() - 0.5), pos.y + 0.3 + Math.random() * 0.5, pos.z + (Math.random() - 0.5),
          (Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2,
          0.32, 0.3, 0.28, 1.2 + Math.random() * 0.8, -0.4,
        );
      }
    },

    /** Hit pada pemain: puff spark kuning-putih (tanpa darah). */
    spawnHit(point) {
      for (let k = 0; k < 6; k++) {
        spawnOne(
          point.x, point.y, point.z,
          (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3,
          1.0, 0.9, 0.55, 0.2 + Math.random() * 0.1, 2,
        );
      }
    },

    /** Kepul asap granat smoke (abu-abu, naik pelan). */
    spawnSmokePuff(pos) {
      for (let k = 0; k < 10; k++) {
        spawnOne(
          pos.x + (Math.random() - 0.5) * 1.5,
          pos.y + Math.random() * 0.8,
          pos.z + (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6,
          0.45, 0.45, 0.46, 1.2 + Math.random() * 0.8, -0.4,
        );
      }
    },

    /** Garis tembak dari `from` ke `to`, fade ~60ms (pool 8). */
    spawnTracer(from, to, color) {
      const t = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
      const attr = t.line.geometry.attributes.position;
      attr.array[0] = from.x; attr.array[1] = from.y; attr.array[2] = from.z;
      attr.array[3] = to.x; attr.array[4] = to.y; attr.array[5] = to.z;
      attr.needsUpdate = true;
      t.line.material.color.set(color === undefined ? 0xffd27a : color);
      t.life = t.maxLife;
      t.line.material.opacity = 0.9;
      t.line.visible = true;
    },
  };

  activeInstance = api;
  return api;
}
