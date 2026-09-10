#!/usr/bin/env node
/**
 * Genera le icone PNG dell'estensione in `icons/`.
 *
 *   node tools/make-icons.mjs
 *
 * Chrome e Firefox rifiutano un'estensione senza icone, e accettano PNG (non
 * SVG). Per non introdurre una dipendenza di build in un progetto che non ne
 * ha nessuna, l'immagine viene disegnata e codificata qui: un rasterizzatore
 * minimo con sovracampionamento 4x per i bordi morbidi, e un codificatore PNG
 * costruito sopra lo `zlib` di Node.
 *
 * Il segno: un amo da pesca bianco su fondo sfumato ambra→rosa→indaco, gli
 * stessi colori della pagina di progetto. L'amo perché il nome del progetto
 * dice di non abboccare all'esca.
 */

import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'icons');

const SIZES = [16, 32, 48, 128];
const SS = 4; // fattore di sovracampionamento

// ─── Codificatore PNG ────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * @param {number} size
 * @param {Uint8Array} rgba lunghezza size*size*4
 * @returns {Buffer}
 */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolor con alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtro adattivo
  ihdr[12] = 0; // non interlacciato

  // Ogni riga è preceduta dal byte del tipo di filtro (0 = nessuno).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4)
      .copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ─── Disegno ─────────────────────────────────────────────────────────────────

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const AMBER = [245, 158, 11];
const ROSE = [244, 63, 94];
const INDIGO = [79, 70, 229];

/** Sfondo: sfumata diagonale a tre tappe. */
function background(x, y, n) {
  const t = clamp01((x / n + y / n) / 2);
  return t < 0.5 ? mix(AMBER, ROSE, t * 2) : mix(ROSE, INDIGO, (t - 0.5) * 2);
}

/** Distanza di un punto dal segmento AB, per disegnare tratti spessi. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / len2);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distanza dall'arco di centro (cx,cy), raggio r, fra due angoli. */
function distToArc(px, py, cx, cy, r, a0, a1) {
  let a = Math.atan2(py - cy, px - cx);
  while (a < a0) a += Math.PI * 2;
  if (a <= a1) return Math.abs(Math.hypot(px - cx, py - cy) - r);
  return Math.min(
    Math.hypot(px - (cx + r * Math.cos(a0)), py - (cy + r * Math.sin(a0))),
    Math.hypot(px - (cx + r * Math.cos(a1)), py - (cy + r * Math.sin(a1)))
  );
}

/**
 * Il segno dell'amo, in coordinate normalizzate 0..1.
 * Restituisce la distanza dal tratto: negativa dentro, positiva fuori.
 */
function hookDistance(u, v) {
  const shaft = distToSegment(u, v, 0.5, 0.16, 0.5, 0.56);
  // La curva dell'amo: mezzo giro sotto l'asta.
  const bend = distToArc(u, v, 0.38, 0.56, 0.12, 0, Math.PI);
  // L'ardiglione, il piccolo dente rivolto verso l'alto.
  const barb = distToSegment(u, v, 0.26, 0.56, 0.32, 0.40);
  // L'occhiello in cima.
  const eye = Math.abs(Math.hypot(u - 0.5, v - 0.145) - 0.055);
  return Math.min(shaft, bend, barb, eye);
}

const STROKE = 0.048; // metà spessore del tratto, in unità normalizzate

function drawIcon(size) {
  const n = size * SS;
  const acc = new Float32Array(size * size * 4);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;

      // Quadrato con angoli arrotondati.
      const r = 0.22;
      const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
      const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
      const inside = Math.hypot(dx, dy) <= r;
      if (!inside) continue;

      const bg = background(x, y, n);
      const onHook = hookDistance(u, v) <= STROKE;
      const rgb = onHook ? [255, 255, 255] : bg;

      const i = (Math.floor(y / SS) * size + Math.floor(x / SS)) * 4;
      acc[i] += rgb[0];
      acc[i + 1] += rgb[1];
      acc[i + 2] += rgb[2];
      acc[i + 3] += 255;
    }
  }

  // Media dei sottocampioni: dà l'antialiasing sia sui bordi del quadrato sia
  // sul tratto dell'amo.
  const samples = SS * SS;
  const rgba = new Uint8Array(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const a = acc[p * 4 + 3] / samples;
    const covered = a / 255;
    for (let ch = 0; ch < 3; ch++) {
      rgba[p * 4 + ch] = covered > 0 ? Math.round(acc[p * 4 + ch] / (covered * samples)) : 0;
    }
    rgba[p * 4 + 3] = Math.round(a);
  }
  return rgba;
}

await mkdir(outDir, { recursive: true });

for (const size of SIZES) {
  const png = encodePng(size, drawIcon(size));
  await writeFile(join(outDir, `icon-${size}.png`), png);
  console.log(`  icons/icon-${size}.png  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log('\nRicordati di dichiararle nel manifest:');
console.log(JSON.stringify({ icons: Object.fromEntries(SIZES.map((s) => [s, `icons/icon-${s}.png`])) }, null, 2));
