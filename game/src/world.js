// world.js — original map "MERIDIAN DEPOT": a 64x48 m industrial container yard.
// Dusk palette: warm sand ground, teal containers, amber accents. All geometry is
// BoxGeometry + MeshStandardMaterial; no external assets.
import * as THREE from 'three';

// Reused temporaries — never allocate in the hot path.
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mkCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  return [cv, cv.getContext('2d')];
}

function speckle(ctx, rnd, n, alpha, light) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rnd() * 60);
    ctx.fillStyle = light
      ? `rgba(${200 + v},${190 + v},${170 + v},${alpha})`
      : `rgba(20,16,12,${alpha})`;
    ctx.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

function toTexture(cv, rx, ry) {
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeTextures() {
  if (typeof document === 'undefined') return null;
  const out = {};

  {
    const [cv, ctx] = mkCanvas();
    const rnd = makeRng(11);
    ctx.fillStyle = '#9a8d7a';
    ctx.fillRect(0, 0, 256, 256);
    speckle(ctx, rnd, 4200, 0.16, false);
    speckle(ctx, rnd, 1800, 0.1, true);
    for (let i = 0; i < 12; i++) { // damp stains
      const x = rnd() * 256, y = rnd() * 256, r = 14 + rnd() * 42;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(52,44,36,0.35)');
      g.addColorStop(1, 'rgba(52,44,36,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,32,26,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) { // hairline cracks
      ctx.beginPath();
      let x = rnd() * 256, y = rnd() * 256;
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    out.concrete = toTexture(cv, 2, 2);
  }

  {
    const [cv, ctx] = mkCanvas();
    const rnd = makeRng(23);
    ctx.fillStyle = '#7d8894';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 2) { // horizontal brushing
      ctx.fillStyle = `rgba(255,255,255,${0.02 + rnd() * 0.04})`;
      ctx.fillRect(0, y, 256, 1);
    }
    for (let x = 0; x <= 256; x += 64) { // panel seams + rivets
      ctx.fillStyle = 'rgba(20,24,28,0.55)';
      ctx.fillRect(x - 2, 0, 4, 256);
      for (let y = 16; y < 256; y += 32) {
        ctx.fillStyle = 'rgba(30,34,38,0.8)';
        ctx.beginPath(); ctx.arc(x + 8, y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(x + 7, y - 1, 1, 0, Math.PI * 2); ctx.fill();
      }
    }
    out.metal = toTexture(cv, 2, 2);
  }

  {
    const [cv, ctx] = mkCanvas();
    ctx.fillStyle = '#151312';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#d9912e';
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(Math.PI / 4);
    for (let x = -360; x < 360; x += 64) ctx.fillRect(x, -360, 32, 720);
    ctx.restore();
    out.hazard = toTexture(cv, 1, 1);
  }

  {
    const [cv, ctx] = mkCanvas();
    for (let x = 0; x < 256; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, '#b9bec2');
      g.addColorStop(0.35, '#e8ebec');
      g.addColorStop(0.65, '#8d9296');
      g.addColorStop(1, '#b9bec2');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 16, 256);
    }
    ctx.fillStyle = 'rgba(30,32,34,0.35)';
    ctx.fillRect(0, 0, 256, 8);
    ctx.fillRect(0, 248, 256, 8);
    out.container = toTexture(cv, 2, 1);
  }

  {
    const [cv, ctx] = mkCanvas();
    const rnd = makeRng(47);
    ctx.fillStyle = '#5d5a54';
    ctx.fillRect(0, 0, 256, 256);
    speckle(ctx, rnd, 6000, 0.2, false);
    speckle(ctx, rnd, 2500, 0.12, true);
    for (let i = 0; i < 8; i++) { // worn patches
      const x = rnd() * 256, y = rnd() * 256, r = 20 + rnd() * 50;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(40,38,34,0.25)');
      g.addColorStop(1, 'rgba(40,38,34,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    out.asphalt = toTexture(cv, 6, 6);
  }

  return out;
}

export const MAP = Object.freeze({
  W: 64, // x: -32 .. 32
  D: 48, // z: -24 .. 24
  WALL_H: 4,
});

function makeMaterials(tex) {
  const t = tex || {};
  return {
    ground: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, map: t.asphalt || null }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, map: t.asphalt || null }),
    wall: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map: t.concrete || null }),
    wallTop: new THREE.MeshStandardMaterial({ color: 0x5d6b66, roughness: 0.8 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x2e7f7a, roughness: 0.6, metalness: 0.25, map: t.container || null }),
    tealDark: new THREE.MeshStandardMaterial({ color: 0x1f5b57, roughness: 0.65, metalness: 0.25, map: t.container || null }),
    rust: new THREE.MeshStandardMaterial({ color: 0x9a5a34, roughness: 0.7, metalness: 0.2, map: t.container || null }),
    amber: new THREE.MeshStandardMaterial({ color: 0xd9912e, roughness: 0.55, metalness: 0.3, map: t.container || null }),
    crate: new THREE.MeshStandardMaterial({ color: 0xa88a5c, roughness: 0.9, map: t.concrete || null }),
    crateDark: new THREE.MeshStandardMaterial({ color: 0x8a744e, roughness: 0.9, map: t.concrete || null }),
    warehouse: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.35, map: t.metal || null }),
    roof: new THREE.MeshStandardMaterial({ color: 0x3a464d, roughness: 0.8, metalness: 0.3 }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, map: t.hazard || null }),
  };
}
function box(scene, colliders, mat, cx, cy, cz, sx, sy, sz, collide = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(cx, cy, cz);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  if (collide) {
    colliders.push({
      min: new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      max: new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
    });
  }
  return m;
}

/** Build the map into `scene`. Returns colliders, spawns, sites, waypoints, bounds. */
export function buildWorld(scene) {
  const tex = makeTextures();
  const M = makeMaterials(tex);
  const colliders = [];

  scene.background = new THREE.Color(0x2b2620);
  scene.fog = new THREE.Fog(0x3a322a, 45, 140);
  const hemi = new THREE.HemisphereLight(0xffd9a0, 0x3a3230, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb45e, 1.6);
  sun.position.set(28, 34, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  scene.add(sun.target);

  const ground = new THREE.Mesh(new THREE.BoxGeometry(MAP.W + 8, 0.2, MAP.D + 8), M.ground);
  ground.position.set(0, -0.1, 0);
  ground.receiveShadow = true;
  scene.add(ground);
  const strip = (cx, cz, sx, sz) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.04, sz), M.asphalt);
    s.position.set(cx, 0.02, cz);
    s.receiveShadow = true;
    scene.add(s);
  };
  strip(0, 0, 7, MAP.D); // mid lane
  strip(26, 0, 6, MAP.D - 4); // A corridor (east)
  strip(-26, 0, 6, MAP.D - 4); // B corridor (west)

  const W = MAP.W / 2, D = MAP.D / 2, H = MAP.WALL_H;
  box(scene, colliders, M.wall, 0, H / 2, -D - 0.5, MAP.W + 2, H, 1);
  box(scene, colliders, M.wall, 0, H / 2, D + 0.5, MAP.W + 2, H, 1);
  box(scene, colliders, M.wall, -W - 0.5, H / 2, 0, 1, H, MAP.D + 2);
  box(scene, colliders, M.wall, W + 0.5, H / 2, 0, 1, H, MAP.D + 2);
  box(scene, colliders, M.amber, 0, H + 0.1, -D - 0.5, MAP.W + 2, 0.2, 1.1, false);
  box(scene, colliders, M.amber, 0, H + 0.1, D + 0.5, MAP.W + 2, 0.2, 1.1, false);

  // --- Site A: north-east warehouse (x ~ +22, z ~ -16) --------------------
  // Warehouse shell: three walls + roof, open to the south-west (entrance).
  box(scene, colliders, M.warehouse, 22, 2.5, -20.5, 14, 5, 1); // north wall
  box(scene, colliders, M.warehouse, 29.5, 2.5, -15, 1, 5, 12); // east wall
  box(scene, colliders, M.warehouse, 15.5, 2.5, -18, 1, 5, 5); // west stub
  box(scene, colliders, M.roof, 22, 5.2, -15, 15, 0.4, 12, false);
  // Amber door frame marking the entrance.
  box(scene, colliders, M.amber, 18.5, 1.6, -11, 0.3, 3.2, 0.3, false);
  box(scene, colliders, M.amber, 25.5, 1.6, -11, 0.3, 3.2, 0.3, false);
  // Crates inside A.
  box(scene, colliders, M.crate, 19, 0.6, -17, 2.4, 1.2, 2.4);
  box(scene, colliders, M.crateDark, 25, 0.6, -18, 2.4, 1.2, 2.4);
  box(scene, colliders, M.crate, 25, 1.8, -18, 2.4, 1.2, 2.4);

  // --- Site B: south-west container stack (x ~ -22, z ~ +16) --------------
  box(scene, colliders, M.teal, -22, 1.3, 19, 6, 2.6, 2.4); // ground container
  box(scene, colliders, M.tealDark, -22, 3.9, 19, 6, 2.6, 2.4); // stacked
  box(scene, colliders, M.rust, -27.5, 1.3, 14, 2.4, 2.6, 6); // rotated stack
  box(scene, colliders, M.amber, -16.5, 1.3, 13.5, 2.4, 2.6, 6);
  box(scene, colliders, M.crate, -19, 0.6, 19.5, 2.4, 1.2, 2.4);

  // --- Mid lane cover ------------------------------------------------------
  box(scene, colliders, M.teal, -4, 1.3, -6, 2.4, 2.6, 6); // mid-west container
  box(scene, colliders, M.rust, 4, 1.3, 2, 2.4, 2.6, 6); // mid-east container
  box(scene, colliders, M.crate, 0, 0.6, -12, 2.4, 1.2, 2.4); // mid-north crate
  box(scene, colliders, M.crateDark, 0, 0.6, 10, 2.4, 1.2, 2.4); // mid-south crate
  box(scene, colliders, M.crate, 0, 1.8, 10, 2.4, 1.2, 2.4); // stacked on it

  // --- A corridor cover (east) ---------------------------------------------
  box(scene, colliders, M.tealDark, 26, 1.3, -4, 6, 2.6, 2.4);
  box(scene, colliders, M.crate, 26, 0.6, 8, 2.4, 1.2, 2.4);
  box(scene, colliders, M.rust, 22, 1.3, 6, 2.4, 2.6, 6);

  // --- B corridor cover (west) ---------------------------------------------
  box(scene, colliders, M.teal, -26, 1.3, 4, 6, 2.6, 2.4);
  box(scene, colliders, M.crateDark, -26, 0.6, -8, 2.4, 1.2, 2.4);
  box(scene, colliders, M.amber, -22, 1.3, -6, 2.4, 2.6, 6);

  // --- Central yard scatter -------------------------------------------------
  box(scene, colliders, M.teal, 10, 1.3, -10, 6, 2.6, 2.4);
  box(scene, colliders, M.rust, -10, 1.3, 8, 6, 2.6, 2.4);
  box(scene, colliders, M.crate, 12, 0.6, 14, 2.4, 1.2, 2.4);
  box(scene, colliders, M.crateDark, -12, 0.6, -14, 2.4, 1.2, 2.4);
  // Tall silo-style pillar north-east of the centre lane (landmark, blocks
  // long sightline). It used to stand at x=0, dead on the spawnB->midN lane,
  // where it trapped the bomb carrier against its wall for whole rounds.
  box(scene, colliders, M.warehouse, 8, 3, -19, 3, 6, 3);

  // --- Site markers: flat amber pads on the ground --------------------------
  const padA = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 6), M.amber);
  padA.position.set(22, 0.05, -15.5);
  padA.receiveShadow = true;
  scene.add(padA);
  const padB = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 6), M.teal);
  padB.position.set(-22, 0.05, 16.5);
  padB.receiveShadow = true;
  scene.add(padB);

  // Hazard stripes marking both site entrances.
  const hzA = new THREE.Mesh(new THREE.BoxGeometry(8, 0.07, 0.8), M.hazard);
  hzA.position.set(22, 0.06, -11.2);
  hzA.receiveShadow = true;
  scene.add(hzA);
  const hzB = new THREE.Mesh(new THREE.BoxGeometry(8, 0.07, 0.8), M.hazard);
  hzB.position.set(-22, 0.06, 12.6);
  hzB.receiveShadow = true;
  scene.add(hzB);

  const sites = {
    A: {
      pos: new THREE.Vector3(22, 0, -15.5),
      box: { min: new THREE.Vector3(18, 0, -18.5), max: new THREE.Vector3(26, 3, -12.5) },
    },
    B: {
      pos: new THREE.Vector3(-22, 0, 16.5),
      box: { min: new THREE.Vector3(-26, 0, 13.5), max: new THREE.Vector3(-18, 3, 19.5) },
    },
  };

  const spawns = {
    // Atlas (attackers) start south; Onyx (defenders) start north.
    atlas: [
      new THREE.Vector3(-6, 0, 21),
      new THREE.Vector3(0, 0, 21.5),
      new THREE.Vector3(6, 0, 21),
      new THREE.Vector3(-12, 0, 20),
      new THREE.Vector3(12, 0, 20),
    ],
    onyx: [
      new THREE.Vector3(-6, 0, -21),
      new THREE.Vector3(0, 0, -21.5),
      new THREE.Vector3(6, 0, -21),
      new THREE.Vector3(-12, 0, -20),
      new THREE.Vector3(12, 0, -20),
    ],
  };

  // Waypoint graph for bots: ids are stable strings, links are neighbour ids.
  const waypoints = [
    { id: 'spawnA', pos: new THREE.Vector3(0, 0, 21), links: ['midS', 'aS', 'bS'], site: 'mid' },
    { id: 'spawnB', pos: new THREE.Vector3(0, 0, -21), links: ['midN', 'aN', 'bN'], site: 'mid' },
    { id: 'midS', pos: new THREE.Vector3(0, 0, 10), links: ['spawnA', 'mid', 'bS', 'aS'], site: 'mid' },
    { id: 'mid', pos: new THREE.Vector3(0, 0, 0), links: ['midS', 'midN', 'aMid', 'bMid'], site: 'mid' },
    { id: 'midN', pos: new THREE.Vector3(0, 0, -10), links: ['mid', 'spawnB', 'aN', 'bN'], site: 'mid' },
    { id: 'aS', pos: new THREE.Vector3(26, 0, 12), links: ['spawnA', 'aMid', 'midS'], site: 'A' },
    { id: 'aMid', pos: new THREE.Vector3(26, 0, 0), links: ['aS', 'aN', 'mid'], site: 'A' },
    { id: 'aN', pos: new THREE.Vector3(24, 0, -10), links: ['aMid', 'siteA', 'midN', 'spawnB'], site: 'A' },
    { id: 'siteA', pos: new THREE.Vector3(22, 0, -15.5), links: ['aN'], site: 'A' },
    { id: 'bS', pos: new THREE.Vector3(-26, 0, 12), links: ['spawnA', 'bMid', 'midS'], site: 'B' },
    { id: 'bMid', pos: new THREE.Vector3(-26, 0, 0), links: ['bS', 'bN', 'mid'], site: 'B' },
    { id: 'bN', pos: new THREE.Vector3(-24, 0, -10), links: ['bMid', 'siteB', 'midN', 'spawnB'], site: 'B' },
    { id: 'siteB', pos: new THREE.Vector3(-22, 0, 16.5), links: ['bS'], site: 'B' },
    { id: 'yardE', pos: new THREE.Vector3(12, 0, 8), links: ['midS', 'aS', 'mid'], site: 'mid' },
    { id: 'yardW', pos: new THREE.Vector3(-12, 0, -8), links: ['midN', 'bN', 'mid'], site: 'mid' },
  ];

  // Minimap walls: every solid box tall enough to block sight (ground, pads
  // and roof are too flat to matter and are excluded by the height test).
  const walls = [];
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.max.y - c.min.y < 1.0) continue;
    walls.push({
      x: (c.min.x + c.max.x) / 2,
      z: (c.min.z + c.max.z) / 2,
      w: c.max.x - c.min.x,
      d: c.max.z - c.min.z,
    });
  }

  return {
    colliders,
    spawns,
    sites,
    waypoints,
    walls,
    bounds: { minX: -W, maxX: W, minZ: -D, maxZ: D },
    // Methods on the world object (weapon.js calls world.hasLineOfSight and
    // setGrenadeWorld stores this object): same functions, bound to these
    // colliders; an explicit collider list overrides the world's own.
    hasLineOfSight(a, b, cs) { return hasLineOfSight(a, b, cs || colliders); },
    collideMove(pos, vel, dt, radius, height) {
      return collideMove(pos, vel, dt, colliders, radius, height);
    },
  };
}

/**
 * Plain minimap data for the HUD canvas: bounds, wall footprints, site
 * centres and the first spawn of each team. No THREE objects leak out.
 */
export function minimapData(world) {
  return {
    bounds: world.bounds,
    walls: world.walls || [],
    sites: {
      A: { x: world.sites.A.pos.x, z: world.sites.A.pos.z },
      B: { x: world.sites.B.pos.x, z: world.sites.B.pos.z },
    },
    spawns: {
      atlas: { x: world.spawns.atlas[0].x, z: world.spawns.atlas[0].z },
      onyx: { x: world.spawns.onyx[0].x, z: world.spawns.onyx[0].z },
    },
  };
}

// ---------------------------------------------------------------------------
// Collision helpers
// ---------------------------------------------------------------------------

/** True if point p (xz) lies inside the box, expanded by `pad` on x/z. */
function overlapsXZ(p, c, pad) {
  return (
    p.x > c.min.x - pad && p.x < c.max.x + pad &&
    p.z > c.min.z - pad && p.z < c.max.z + pad
  );
}

/**
 * Move `pos` by vel*dt with AABB sliding. `pos` is the feet position; the
 * player occupies [pos.y, pos.y+height]. Only colliders whose y-range
 * intersects the player block movement. Mutates and returns `pos`.
 * Axis-separated: try x, then z, so the player slides along walls.
 */
export function collideMove(pos, vel, dt, colliders, radius, height) {
  const top = pos.y + height;
  // X axis.
  _t1.copy(pos);
  _t1.x += vel.x * dt;
  let blocked = false;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.max.y <= pos.y + 0.05 || c.min.y >= top) continue;
    if (overlapsXZ(_t1, c, radius)) { blocked = true; break; }
  }
  if (!blocked) pos.x = _t1.x;
  // Z axis.
  _t1.copy(pos);
  _t1.z += vel.z * dt;
  blocked = false;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.max.y <= pos.y + 0.05 || c.min.y >= top) continue;
    if (overlapsXZ(_t1, c, radius)) { blocked = true; break; }
  }
  if (!blocked) pos.z = _t1.z;
  return pos;
}

/** Slab-method segment vs AABB test. Returns true if segment a->b hits box. */
function segmentHitsBox(a, b, c) {
  _t2.subVectors(b, a); // direction
  let tmin = 0;
  let tmax = 1;
  // x, y, z slabs.
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? a.x : axis === 1 ? a.y : a.z;
    const d = axis === 0 ? _t2.x : axis === 1 ? _t2.y : _t2.z;
    const mn = axis === 0 ? c.min.x : axis === 1 ? c.min.y : c.min.z;
    const mx = axis === 0 ? c.max.x : axis === 1 ? c.max.y : c.max.z;
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return false;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

/**
 * True when nothing blocks the straight line from `a` to `b`.
 * Low boxes (crates, pads) below the line do not block because the segment
 * test is fully 3D.
 */
export function hasLineOfSight(a, b, colliders) {
  for (let i = 0; i < colliders.length; i++) {
    if (segmentHitsBox(a, b, colliders[i])) return false;
  }
  return true;
}

/** True when `pos` is inside the site's box (y ignored above ground). */
export function pointInSite(pos, site) {
  return (
    pos.x >= site.box.min.x && pos.x <= site.box.max.x &&
    pos.z >= site.box.min.z && pos.z <= site.box.max.z
  );
}
