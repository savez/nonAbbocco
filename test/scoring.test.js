import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { evaluateUrlAndPage, rankFromLegacyScore, rankLabel } from '../src/scoring.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, 'corpus', name), 'utf8'));

const benign = load('benign.json');
const malicious = load('malicious.json');

/**
 * FASE P2 — questi test bloccano il comportamento ATTUALE, bug inclusi.
 *
 * `legacyRank` è ciò che il motore fa oggi; `maxRank`/`minRank` è ciò che
 * dovrebbe fare. Dove i due divergono c'è un difetto noto, e il test lo
 * afferma esplicitamente come difetto invece di far finta che non esista.
 * In P3 le asserzioni si invertono: si inizia a pretendere maxRank/minRank
 * e le righe `legacyRank` scompaiono, rendendo la correzione visibile nel diff.
 */

test('il rank storico è una funzione a soglie fisse sul punteggio', () => {
  assert.equal(rankFromLegacyScore(0), 1);
  assert.equal(rankFromLegacyScore(19), 1);
  assert.equal(rankFromLegacyScore(20), 2);
  assert.equal(rankFromLegacyScore(40), 3);
  assert.equal(rankFromLegacyScore(60), 4);
  assert.equal(rankFromLegacyScore(80), 5);
  assert.equal(rankFromLegacyScore(999), 5, 'nessuna saturazione nel motore storico');
});

test('il rank 1 non viene mai comunicato come "sicuro"', () => {
  const label = rankLabel(1).toLowerCase();
  assert.ok(!label.includes('sicur'), `il rank 1 non deve dirsi sicuro, invece dice: "${rankLabel(1)}"`);
  for (const rank of [1, 2, 3, 4, 5]) {
    assert.ok(rankLabel(rank).length > 0);
  }
});

test('un URL non parsabile non fa esplodere il motore', () => {
  const v = evaluateUrlAndPage('non-un-url');
  assert.equal(v.rank, 1);
  assert.deepEqual(v.anomalies, []);
});

test('comportamento storico invariato sul corpus benigno', async (t) => {
  for (const c of benign.cases) {
    await t.test(c.id, () => {
      const v = evaluateUrlAndPage(c.url, { hasPassword: c.hasPassword, formAction: c.formAction });
      assert.equal(v.rank, c.legacyRank,
        `${c.url}\n  atteso (comportamento storico): ${c.legacyRank}\n  ottenuto: ${v.rank} (score ${v.score})\n  regole scattate: ${v.fired.join(', ') || 'nessuna'}`);
    });
  }
});

test('comportamento storico invariato sul corpus malevolo', async (t) => {
  for (const c of malicious.cases) {
    await t.test(c.id, () => {
      const v = evaluateUrlAndPage(c.url, { hasPassword: c.hasPassword, formAction: c.formAction });
      assert.equal(v.rank, c.legacyRank,
        `${c.url}\n  atteso (comportamento storico): ${c.legacyRank}\n  ottenuto: ${v.rank} (score ${v.score})\n  regole scattate: ${v.fired.join(', ') || 'nessuna'}`);
    });
  }
});

test('i difetti noti sono documentati e ancora aperti', () => {
  const openFalsePositives = benign.cases.filter(c => c.legacyRank > c.maxRank);
  const openFalseNegatives = malicious.cases.filter(c => c.legacyRank < c.minRank);

  for (const c of [...openFalsePositives, ...openFalseNegatives]) {
    assert.ok(c.note && c.note.length > 20,
      `il difetto noto "${c.id}" deve spiegare il perché nel campo note`);
  }

  // Sentinella di avanzamento: se una correzione di P3 chiude un difetto,
  // questo conteggio cambia e il test costringe ad aggiornare il corpus
  // anziché lasciare in giro aspettative obsolete.
  assert.equal(openFalsePositives.length, 9,
    `falsi positivi ancora aperti: ${openFalsePositives.map(c => c.id).join(', ')}`);
  assert.equal(openFalseNegatives.length, 3,
    `falsi negativi ancora aperti: ${openFalseNegatives.map(c => c.id).join(', ')}`);
});

test('lo scoring non dipende dal fatto che sia una copia divergente', () => {
  // Il difetto 7 era che simulator.html conteneva un SECONDO motore con pesi
  // diversi. Questo test fissa i pesi canonici: se qualcuno reintroduce una
  // copia con i numeri del simulatore (HTTP+password a 45 invece di 50),
  // questa asserzione la intercetta.
  const httpPwd = evaluateUrlAndPage('http://esempio-neutro.test/login', { hasPassword: true });
  assert.equal(httpPwd.score, 50, 'HTTP con password vale 50, non i 45 del vecchio simulatore');
  assert.deepEqual(httpPwd.fired, ['legacy-http-password']);
});
