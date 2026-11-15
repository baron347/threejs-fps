// main.ts — hand-in program for the MERIDIAN DEPOT entry (make.fun threejs-fps-02).
// Node 22 standard library only. It copies this repository's game/ and
// screenshots/ beside this file into the output directory and writes
// dossier.json there with the vendored make.fun library, so the sealed scorer
// can re-build the same dossier byte for byte and compare.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Outside the grader's container MAKEFUN_OUTPUT_DIR stands in for /output;
// with no variable set the program writes to /output, as the platform does.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

if (!existsSync(gameDir)) {
  console.error(`game/ not found next to main.ts (${gameDir})`);
  process.exit(1);
}
if (!existsSync(join(gameDir, 'index.html'))) {
  console.error('game/index.html is missing — nothing to hand in');
  process.exit(1);
}
if (!existsSync(shotsDir)) {
  console.error('screenshots/ not found next to main.ts — the gate needs 3-4 shots');
  process.exit(1);
}

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });
}

// Caps from the scorer's reference (gate.json): text_max_bytes is the only
// one that shapes the dossier bytes; the rest refuse an entry the scorer
// would refuse — more than 4 screenshots or one over 256 KiB, more than 993
// files in game/ or 48 MiB of game files in all (game/ shares /output's own
// 1000-entry cap with screenshots/ and dossier.json, so leave them room).
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(out, 'dossier.json'), dossier);

const shotCount = readdirSync(join(out, 'screenshots')).filter((f) => !f.startsWith('.')).length;
console.log(`handed in to ${out} (${shotCount} screenshots, dossier ${dossier.length} bytes)`);
