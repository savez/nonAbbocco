/**
 * Il marchio di NonAbbocco: rasterizzatore e codificatore PNG.
 *
 * Condiviso da `tools/make-icons.mjs` (icone dell'estensione) e
 * `tools/build-banner.mjs` (banner del README), così che il segno sia
 * letteralmente lo stesso disegno in entrambi i posti e non due varianti che
 * col tempo divergono.
 *
 * Perché disegnare e codificare a mano: gli store vogliono PNG, non SVG, e il
 * progetto non ha alcuna dipendenza di build. Un rasterizzatore con
 * sovracampionamento e un codificatore PNG sopra lo `zlib` di Node costano
 * meno di una toolchain grafica.
 *
 * Il segno è un amo da pesca bianco su fondo sfumato ambra→rosa→indaco, gli
 * stessi colori della pagina di progetto. L'amo perché il nome dice di non
 * abboccare all'esca.
 */

import { deflateSync } from 'node:zlib';

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
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba lunghezza width*height*4
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // profondità di bit
  ihdr[9] = 6;  // truecolor con alpha
  ihdr[10] = 0; // compressione deflate
  ihdr[11] = 0; // filtro adattivo
  ihdr[12] = 0; // non interlacciato

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // tipo di filtro: nessuno
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ─── Geometria e colori ──────────────────────────────────────────────────────

export const AMBER = [245, 158, 11];
export const ROSE = [244, 63, 94];
export const INDIGO = [79, 70, 229];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Sfumata diagonale a tre tappe, in coordinate normalizzate. */
export function gradient(u, v) {
  const t = clamp01((u + v) / 2);
  return t < 0.5 ? mix(AMBER, ROSE, t * 2) : mix(ROSE, INDIGO, (t - 0.5) * 2);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / len2);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToArc(px, py, cx, cy, r, a0, a1) {
  let a = Math.atan2(py - cy, px - cx);
  while (a < a0) a += Math.PI * 2;
  if (a <= a1) return Math.abs(Math.hypot(px - cx, py - cy) - r);
  return Math.min(
    Math.hypot(px - (cx + r * Math.cos(a0)), py - (cy + r * Math.sin(a0))),
    Math.hypot(px - (cx + r * Math.cos(a1)), py - (cy + r * Math.sin(a1)))
  );
}

/** Distanza dal tratto dell'amo, in coordinate normalizzate 0..1. */
export function hookDistance(u, v) {
  return Math.min(
    distToSegment(u, v, 0.5, 0.16, 0.5, 0.56),      // asta
    distToArc(u, v, 0.38, 0.56, 0.12, 0, Math.PI),  // curva
    distToSegment(u, v, 0.26, 0.56, 0.32, 0.40),    // ardiglione
    Math.abs(Math.hypot(u - 0.5, v - 0.145) - 0.055) // occhiello
  );
}

export const STROKE = 0.048; // metà spessore del tratto

/**
 * Disegna il marchio quadrato.
 *
 * @param {number} size lato in pixel
 * @param {{supersample?: number, radius?: number, transparent?: boolean}} [options]
 * @returns {Uint8Array} RGBA
 */
export function drawMark(size, options = {}) {
  const ss = options.supersample ?? 4;
  const radius = options.radius ?? 0.22;
  const n = size * ss;
  const acc = new Float32Array(size * size * 4);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;

      // Quadrato con angoli arrotondati.
      const dx = Math.max(Math.abs(u - 0.5) - (0.5 - radius), 0);
      const dy = Math.max(Math.abs(v - 0.5) - (0.5 - radius), 0);
      if (Math.hypot(dx, dy) > radius) continue;

      const onHook = hookDistance(u, v) <= STROKE;
      const rgb = onHook ? [255, 255, 255] : gradient(u, v);

      const i = (Math.floor(y / ss) * size + Math.floor(x / ss)) * 4;
      acc[i] += rgb[0];
      acc[i + 1] += rgb[1];
      acc[i + 2] += rgb[2];
      acc[i + 3] += 255;
    }
  }

  // La media dei sottocampioni dà l'antialiasing sui bordi del quadrato e sul
  // tratto dell'amo.
  const samples = ss * ss;
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
