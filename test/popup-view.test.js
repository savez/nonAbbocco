/**
 * Il modello di vista del popup.
 *
 * Il popup non ricalcola il verdetto: legge quello che il background ha già
 * prodotto. Quello che resta da verificare è la traduzione — che l'indirizzo
 * venga spezzato nel punto giusto, che le quattro categorie ci siano sempre
 * tutte, che le soppressioni non vengano scambiate per accuse, e che lo stato
 * vuoto non menta dicendo "sicuro".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPopupView, splitAddress, categoryRows, formatAge,
  CATEGORY_ORDER, MAX_LEVEL
} from '../src/popup-view.js';
import { CATEGORIES, evaluateUrlAndPage } from '../src/scoring.js';

/** Una voce come quella che `background.js` archivia in storage.session. */
function entryFor(url, page = {}, at = 0) {
  const verdict = evaluateUrlAndPage(url, page);
  const { hostname } = new URL(url);
  return { url, hostname, hostnameUnicode: hostname, registrableDomain: null, verdict, at };
}

test('l\'ordine delle categorie coincide con quello del motore', () => {
  // Il popup prende l'ordine da CATEGORY_LABELS invece di importare il motore,
  // che tirerebbe dentro 192 KB di Public Suffix List per niente. Questa è la
  // rete che impedisce alla scorciatoia di divergere in silenzio.
  assert.deepEqual(CATEGORY_ORDER, CATEGORIES);
});

test('le quattro categorie ci sono sempre tutte, anche a zero', () => {
  const rows = categoryRows({ identity: 2 }, []);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.key), CATEGORIES);
  assert.equal(rows.find((r) => r.key === 'identity').level, 2);
  assert.equal(rows.find((r) => r.key === 'transport').level, 0);
  for (const row of rows) assert.ok(row.label && row.question);
});

test('il livello di una categoria resta dentro la scala', () => {
  const rows = categoryRows({ identity: 99, credentials: -4 }, []);
  assert.equal(rows.find((r) => r.key === 'identity').level, MAX_LEVEL);
  assert.equal(rows.find((r) => r.key === 'credentials').level, 0);
});

test('una categoria soppressa è marcata come tale', () => {
  const rows = categoryRows({}, ['identity']);
  assert.equal(rows.find((r) => r.key === 'identity').suppressed, true);
  assert.equal(rows.find((r) => r.key === 'transport').suppressed, false);
});

// ─── Anatomia dell'indirizzo ─────────────────────────────────────────────────

test('l\'indirizzo è spezzato sul dominio registrabile', () => {
  // È l'inganno centrale: "paypal.com." è un prefisso che chiunque può
  // scrivere, il sito è di verifica-account.xyz.
  assert.deepEqual(
    splitAddress('paypal.com.verifica-account.xyz', 'verifica-account.xyz'),
    { prefix: 'paypal.com.', registrable: 'verifica-account.xyz', unicode: null }
  );
});

test('senza sottodominio il prefisso è vuoto', () => {
  assert.deepEqual(
    splitAddress('posteitaliane.it', 'posteitaliane.it'),
    { prefix: '', registrable: 'posteitaliane.it', unicode: null }
  );
});

test('con un suffisso ignoto non si indovina dove spezzare', () => {
  // Meglio non evidenziare nulla che evidenziare il pezzo sbagliato: è la
  // stessa scelta che src/psl.js fa restituendo `known: false`.
  assert.deepEqual(
    splitAddress('qualcosa.suffisso-inesistente', null),
    { prefix: '', registrable: 'qualcosa.suffisso-inesistente', unicode: null }
  );
});

test('la forma Unicode è mostrata solo quando differisce da quella ASCII', () => {
  assert.equal(splitAddress('xn--80ak6aa92e.com', 'xn--80ak6aa92e.com', 'аррӏе.com').unicode, 'аррӏе.com');
  assert.equal(splitAddress('apple.com', 'apple.com', 'apple.com').unicode, null);
});

test('un hostname vuoto non produce un indirizzo', () => {
  assert.equal(splitAddress('', null), null);
});

// ─── Stato vuoto ─────────────────────────────────────────────────────────────

test('senza verdetto il popup non dice "sicuro"', () => {
  for (const empty of [null, undefined, {}, { verdict: null }]) {
    const view = buildPopupView(empty, 0);
    assert.equal(view.state, 'unknown');
    assert.ok(view.headline && view.detail);
    assert.doesNotMatch(`${view.headline} ${view.detail}`, /sicur/i);
  }
});

// ─── Verdetti reali ──────────────────────────────────────────────────────────

test('un dominio legittimo dà rango 1, nessun segnale e una soppressione', () => {
  const view = buildPopupView(entryFor('https://www.posteitaliane.it/'), 0);

  assert.equal(view.state, 'ok');
  assert.equal(view.rank, 1);
  assert.equal(view.label, 'Nessun segnale noto');
  // È esattamente il caso su cui il motore legacy sbagliava, dando 3/5.
  assert.deepEqual(view.signals, []);
  assert.ok(view.suppressions.some((s) => s.id === 'trusted-brand-domain'));
});

test('le soppressioni non finiscono fra i segnali', () => {
  const view = buildPopupView(entryFor('https://www.posteitaliane.it/'), 0);
  for (const signal of view.signals) assert.notEqual(signal.kind, 'suppress');
  assert.ok(view.suppressions.every((s) => s.message));
});

test('un attacco da manuale porta segnali e categorie sopra zero', () => {
  const view = buildPopupView(entryFor('https://paypal.com.verifica-account.xyz/login', {
    hasPassword: true,
    title: 'PayPal - Accedi',
    visibleText: 'Il tuo account verrà sospeso entro 24 ore.'
  }), 0);

  assert.ok(view.rank >= 4, `atteso almeno 4, ottenuto ${view.rank}`);
  assert.ok(view.signals.length > 0);
  assert.ok(view.categories.find((c) => c.key === 'identity').level >= 2);
  assert.ok(view.categories.find((c) => c.key === 'credentials').level >= 1);
  assert.equal(view.partial, false);
});

test('il popup dice quando l\'utente ha scavalcato il blocco', () => {
  const entry = entryFor('https://paypal-secure.xyz/login', { hasPassword: true });

  assert.equal(buildPopupView(entry, 0).bypassed, false);
  assert.equal(buildPopupView({ ...entry, bypassed: true }, 0).bypassed, true);

  // Il bypass NON abbassa il verdetto: spegne il blocco, non il giudizio.
  assert.equal(
    buildPopupView({ ...entry, bypassed: true }, 0).rank,
    buildPopupView(entry, 0).rank
  );
});

test('un verdetto sul solo indirizzo è dichiarato come parziale', () => {
  const onlyUrl = buildPopupView(entryFor('https://paypal-secure.xyz/'), 0);
  assert.equal(onlyUrl.partial, true);

  const withDom = buildPopupView(entryFor('https://paypal-secure.xyz/', { hasPassword: true }), 0);
  assert.equal(withDom.partial, false);
});

test('ogni segnale mostrato ha un messaggio leggibile, non un id di regola', () => {
  const view = buildPopupView(entryFor('http://185.220.101.5/banca/accedi', { hasPassword: true }), 0);
  assert.ok(view.signals.length > 0);
  for (const signal of view.signals) {
    assert.ok(signal.message.length > 20, `messaggio troppo corto: ${signal.message}`);
    assert.notEqual(signal.message, signal.id);
  }
});

// ─── Età dell'analisi ────────────────────────────────────────────────────────

test('l\'età dell\'analisi è detta in parole', () => {
  const min = 60000;
  assert.equal(formatAge(0, 30 * 1000), 'pochi istanti fa');
  assert.equal(formatAge(0, min), 'un minuto fa');
  assert.equal(formatAge(0, 5 * min), '5 minuti fa');
  assert.equal(formatAge(0, 60 * min), "un'ora fa");
  assert.equal(formatAge(0, 5 * 60 * min), '5 ore fa');
  assert.equal(formatAge(0, 24 * 60 * min), 'ieri');
  assert.equal(formatAge(0, 72 * 60 * min), '3 giorni fa');
});

test('un orologio incoerente non produce un\'età assurda', () => {
  // storage.session sopravvive al riavvio del service worker; l'orologio di
  // sistema può spostarsi nel frattempo.
  assert.equal(formatAge(1000, 0), 'al caricamento della pagina');
  assert.equal(formatAge(undefined, 0), 'al caricamento della pagina');
});
