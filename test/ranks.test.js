/**
 * La scala del rango deve essere completa.
 *
 * Il difetto che questo file impedisce di ripetere: `colorConfig` in
 * content.js definiva i colori solo per i ranghi 2, 3 e 4 e ripiegava
 * silenziosamente sul 3 per tutti gli altri. Il rango 5 — l'unico che significa
 * "non inserire alcun dato" — era colorato come un sospetto moderato, e
 * nessuno se ne accorgeva perché il ripiego non falliva mai rumorosamente.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RANK_RANGE, RANK_PALETTES, clampRank, rankPresentation } from '../src/ranks.js';
import { RANK_LABELS, RANK_SUBTITLES } from '../src/messages.it.js';

test('ogni rango ha etichetta, sottotitolo e palette', () => {
  assert.deepEqual(RANK_RANGE, [1, 2, 3, 4, 5]);

  for (const rank of RANK_RANGE) {
    const p = rankPresentation(rank);
    assert.equal(p.rank, rank);
    assert.equal(p.label, RANK_LABELS[rank], `etichetta mancante per il rango ${rank}`);
    assert.equal(p.subtitle, RANK_SUBTITLES[rank], `sottotitolo mancante per il rango ${rank}`);

    for (const key of ['bg', 'border', 'text', 'accent']) {
      assert.match(p.palette[key], /^#[0-9a-f]{6}$/, `${key} non valido per il rango ${rank}`);
    }
  }
});

test('nessun rango condivide la palette con un altro', () => {
  const seen = new Set();
  for (const rank of RANK_RANGE) {
    const signature = Object.values(RANK_PALETTES[rank]).join('|');
    assert.ok(!seen.has(signature), `il rango ${rank} è colorato come un altro`);
    seen.add(signature);
  }
});

test('il rango 1 non è verde: assenza di segnali non è una promessa di sicurezza', () => {
  // Il verde del rango 2 è la tinta più bassa che il progetto usa per dire
  // "guardato e trovato qualcosa di lieve". Il rango 1 deve stare fuori da
  // quella famiglia, perché significa solo "nessun segnale noto".
  assert.notEqual(RANK_PALETTES[1].accent, RANK_PALETTES[2].accent);
  assert.match(RANK_PALETTES[1].accent, /^#(64748b|475569|94a3b8)$/);
});

test('un rango fuori scala non finisce su un colore arbitrario', () => {
  assert.equal(clampRank(0), 1);
  assert.equal(clampRank(-3), 1);
  assert.equal(clampRank(9), 5);
  assert.equal(clampRank(undefined), 1);
  assert.equal(clampRank('4'), 4);
  assert.equal(rankPresentation(null).rank, 1);
});
