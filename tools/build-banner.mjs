#!/usr/bin/env node
/**
 * Genera `assets/banner.svg`, la testata del README.
 *
 *   node tools/build-banner.mjs
 *
 * Il banner SOSTITUISCE il titolo del README: porta lui nome e tagline, così
 * il documento non li ripete.
 *
 * Perché SVG e non PNG: il testo resta nitido a qualunque densità di schermo,
 * il file pesa pochi KB e resta modificabile. Il marchio dell'amo, che è
 * geometria rasterizzata, viene incorporato come PNG in data URI — così è
 * letteralmente lo stesso disegno delle icone dell'estensione invece di una
 * ricostruzione a mano in path SVG che col tempo divergerebbe.
 *
 * I numeri nel banner (regole, marchi, domini) sono letti dal codice, quindi
 * non possono raccontare qualcosa di diverso da quello che il motore fa.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { drawMark, encodePng } from './lib/mark.mjs';
import { RULES } from '../src/rules.js';
import { BRANDS } from '../src/brands.js';
import { RANK_LABELS } from '../src/messages.it.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Layout. I numeri sono espliciti perché la composizione è stata verificata
// rendendo l'SVG in PNG e guardandola: la prima versione lasciava un terzo
// del banner vuoto a destra e l'etichetta "Sospetto moderato" toccava il
// bordo della sua card.
const W = 1010;
const H = 400;
const MARK = 168;
const MARK_X = 80;
const TEXT_X = 300;          // 52px di respiro dopo il marchio
const CARD_W = 122;
const CARD_GAP = 126;

// Il marchio, rasterizzato a 2x per restare nitido sui display retina.
const markPng = encodePng(MARK * 2, MARK * 2, drawMark(MARK * 2, { supersample: 3 }));
const markUri = `data:image/png;base64,${markPng.toString('base64')}`;

const brandCount = BRANDS.length;
const domainCount = BRANDS.reduce((n, b) => n + b.legit.length, 0);

/** La striscia dei cinque livelli, con le etichette vere dal codice. */
const RANK_COLOURS = ['#34d399', '#34d399', '#fbbf24', '#f97316', '#f43f5e'];

const rankStrip = [1, 2, 3, 4, 5].map((r, i) => {
  const x = TEXT_X + i * CARD_GAP;
  return `    <g transform="translate(${x} 268)">
      <rect width="${CARD_W}" height="60" rx="12" fill="#0f172a" stroke="${RANK_COLOURS[i]}" stroke-opacity="0.35"/>
      <circle cx="15" cy="21" r="3.5" fill="${RANK_COLOURS[i]}"/>
      <text x="26" y="25" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700" fill="${RANK_COLOURS[i]}">${r}</text>
      <text x="14" y="46" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">${RANK_LABELS[r]}</text>
    </g>`;
}).join('\n');

const stats = [
  [`${RULES.length}`, 'regole'],
  [`${brandCount}`, 'marchi'],
  [`${domainCount}`, 'domini noti'],
  ['~15µs', 'per controllo']
].map(([value, label], i) => {
  const x = TEXT_X + i * CARD_GAP;
  return `    <g transform="translate(${x} 222)">
      <text x="0" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="19" font-weight="800" fill="#f8fafc">${value}</text>
      <text x="0" y="16" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10.5" fill="#64748b">${label}</text>
    </g>`;
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="NonAbbocco — difesa anti-phishing per Chrome e Firefox con ranking di rischio da 1 a 5">
  <title>NonAbbocco</title>
  <desc>Estensione Chrome e Firefox anti-phishing: analizza URL e DOM, calcola un ranking di rischio da 1 a 5 e sostituisce le pagine di phishing con un interstiziale non manomettibile.</desc>

  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1120"/>
      <stop offset="0.55" stop-color="#0d1424"/>
      <stop offset="1" stop-color="#131a2e"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.16" cy="0.42" r="0.55">
      <stop offset="0" stop-color="#f43f5e" stop-opacity="0.20"/>
      <stop offset="1" stop-color="#f43f5e" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.82" cy="0.85" r="0.6">
      <stop offset="0" stop-color="#4f46e5" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#4f46e5" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f59e0b"/>
      <stop offset="0.5" stop-color="#f43f5e"/>
      <stop offset="1" stop-color="#4f46e5"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect width="${W}" height="${H}" fill="url(#glow2)"/>
  <rect width="${W}" height="4" fill="url(#rule)"/>

  <!-- Il marchio: lo stesso disegno delle icone dell'estensione -->
  <image x="${MARK_X}" y="${(H - MARK) / 2}" width="${MARK}" height="${MARK}" href="${markUri}" />

  <g transform="translate(${TEXT_X} 0)">
    <text x="0" y="132" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="62" font-weight="800" letter-spacing="-1.5" fill="#ffffff">NonAbbocco</text>
    <text x="0" y="168" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="20" font-weight="500" fill="#cbd5e1">Non abboccare all'esca del phishing.</text>
    <text x="0" y="192" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13.5" fill="#64748b">Estensione Chrome e Firefox · analisi locale · ranking di rischio 1-5</text>
  </g>

${stats}

${rankStrip}

  <text x="${W - 84}" y="${H - 24}" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11.5" fill="#475569">Manifest V3 · MIT · nessuna telemetria</text>
</svg>
`;

await mkdir(join(root, 'assets'), { recursive: true });
await writeFile(join(root, 'assets', 'banner.svg'), svg, 'utf8');

console.log(`Scritto assets/banner.svg (${(svg.length / 1024).toFixed(1)} KB)`);
console.log(`  ${RULES.length} regole · ${brandCount} marchi · ${domainCount} domini legittimi`);
