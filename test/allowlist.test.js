/**
 * L'allowlist dell'utente.
 *
 * La regola che alimenta sopprime identità, credenziali e trasporto: una voce
 * sbagliata non produce un avviso in meno, produce un sito senza protezione.
 * Per questo i test insistono più su cosa NON deve coprire che su cosa copre.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEntry, parseAllowlist, formatAllowlist, isAllowlisted } from '../src/allowlist.js';
import { evaluateUrlAndPage } from '../src/scoring.js';

// ─── Normalizzazione: accettare quello che le persone incollano davvero ──────

test('un URL incollato per intero diventa il suo hostname', () => {
  assert.equal(normalizeEntry('https://www.esempio.it/login?x=1#top'), 'www.esempio.it');
  assert.equal(normalizeEntry('http://esempio.it:8080/'), 'esempio.it');
  assert.equal(normalizeEntry('  ESEMPIO.it  '), 'esempio.it');
  assert.equal(normalizeEntry('esempio.it.'), 'esempio.it');
  assert.equal(normalizeEntry('.esempio.it'), 'esempio.it');
  assert.equal(normalizeEntry('utente:segreto@esempio.it/area'), 'esempio.it');
});

test('quello che non è un hostname viene scartato invece di essere salvato storto', () => {
  for (const junk of ['', '   ', '#un commento', 'due parole', '...', '---', null, undefined]) {
    assert.equal(normalizeEntry(junk), null, `accettato: ${JSON.stringify(junk)}`);
  }
});

test('la textarea diventa un elenco senza vuoti né duplicati', () => {
  const entries = parseAllowlist('esempio.it\n\n  https://ESEMPIO.it/x  \n# nota\nposte.it,intranet.locale\n');
  assert.deepEqual(entries, ['esempio.it', 'poste.it', 'intranet.locale']);
  assert.equal(formatAllowlist(entries), 'esempio.it\nposte.it\nintranet.locale');
});

test('formatAllowlist regge un valore salvato malformato', () => {
  // storage.sync può restituire qualunque cosa vi sia finita dentro.
  assert.equal(formatAllowlist(null), '');
  assert.equal(formatAllowlist('non un array'), '');
});

// ─── Corrispondenza: il punto in cui una scorciatoia diventa una falla ───────

test('una voce copre il sito e i suoi sottodomini', () => {
  const list = ['esempio.it'];
  assert.equal(isAllowlisted('esempio.it', list), true);
  assert.equal(isAllowlisted('www.esempio.it', list), true);
  assert.equal(isAllowlisted('mail.interna.esempio.it', list), true);
});

test('una voce NON copre un dominio che se la porta appresso nel nome', () => {
  // È la forma d'attacco che il motore esiste per riconoscere: se l'allowlist
  // la accettasse, metterci il proprio istituto spegnerebbe la protezione
  // proprio sui siti che lo imitano.
  const list = ['poste.it'];
  assert.equal(isAllowlisted('poste.it.truffa.xyz', list), false);
  assert.equal(isAllowlisted('poste-it.xyz', list), false);
  assert.equal(isAllowlisted('nonposte.it', list), false);
  assert.equal(isAllowlisted('poste.it.com', list), false);
});

test('un elenco vuoto o malformato non copre nulla', () => {
  for (const list of [[], null, undefined, ['', '   ', '#nota']]) {
    assert.equal(isAllowlisted('esempio.it', list), false);
  }
});

// ─── Effetto sul verdetto ────────────────────────────────────────────────────

test('un sito in allowlist perde le segnalazioni che aveva', () => {
  const url = 'https://paypal-secure.xyz/login';

  const senza = evaluateUrlAndPage(url, { hasPassword: true });
  assert.ok(senza.rank >= 4, `atteso almeno 4 senza allowlist, ottenuto ${senza.rank}`);

  const con = evaluateUrlAndPage(url, { hasPassword: true, userAllowlisted: true });
  assert.equal(con.rank, 1);
  assert.ok(con.fired.some((f) => f.id === 'user-allowlisted'));
  assert.deepEqual(con.suppressed.sort(), ['credentials', 'identity', 'transport']);
});

test('l\'allowlist non spegne il veto di Safe Browsing', () => {
  // È deliberato: l'allowlist è un giudizio dell'utente su un sito, un
  // riscontro di Safe Browsing è un fatto verificato su quel sito. Il secondo
  // non lo si mette a tacere per distrazione.
  const v = evaluateUrlAndPage('https://esempio.it/', {
    userAllowlisted: true,
    safeBrowsingThreat: 'SOCIAL_ENGINEERING'
  });
  assert.equal(v.rank, 5);
});
