#!/usr/bin/env node
/**
 * Genera le icone PNG dell'estensione in `icons/`.
 *
 *   node tools/make-icons.mjs
 *
 * Chrome e Firefox rifiutano un'estensione senza icone, e accettano PNG (non
 * SVG). Il disegno vive in `tools/lib/mark.mjs`, condiviso con il generatore
 * del banner, così che il marchio sia lo stesso in tutti i posti.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { drawMark, encodePng } from './lib/mark.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'icons');

const SIZES = [16, 32, 48, 128];

await mkdir(outDir, { recursive: true });

for (const size of SIZES) {
  // Alle dimensioni piccole servono più sottocampioni, altrimenti il tratto
  // sottile dell'amo si sgretola.
  const png = encodePng(size, size, drawMark(size, { supersample: size <= 32 ? 8 : 4 }));
  await writeFile(join(outDir, `icon-${size}.png`), png);
  console.log(`  icons/icon-${size}.png  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log('\nDichiarate nel manifest come:');
console.log(JSON.stringify({ icons: Object.fromEntries(SIZES.map((s) => [s, `icons/icon-${s}.png`])) }, null, 2));
