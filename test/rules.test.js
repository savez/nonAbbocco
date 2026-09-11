import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

import { RULES, RULE_IDS } from '../src/rules.js';
import { RULE_MESSAGES } from '../src/messages.it.js';
import { CATEGORIES, buildUrlSignals, evaluateUrlAndPage } from '../src/scoring.js';

const KINDS = ['veto', 'strong', 'weak', 'suppress'];
const PHASES = ['url', 'dom', 'either'];

test('ogni regola è ben formata', () => {
  for (const rule of RULES) {
    assert.ok(rule.id && /^[a-z0-9-]+$/.test(rule.id), `id non valido: ${rule.id}`);
    assert.ok(KINDS.includes(rule.kind), `${rule.id}: kind "${rule.kind}" non valido`);
    assert.ok(PHASES.includes(rule.phase), `${rule.id}: phase "${rule.phase}" non valida`);
    assert.equal(typeof rule.test, 'function', `${rule.id}: test deve essere una funzione`);

    if (rule.kind === 'suppress') {
      assert.ok(Array.isArray(rule.suppresses) && rule.suppresses.length,
        `${rule.id}: una soppressione deve dichiarare cosa azzera`);
      for (const c of rule.suppresses) {
        assert.ok(CATEGORIES.includes(c), `${rule.id}: categoria soppressa sconosciuta "${c}"`);
      }
    } else {
      assert.ok(CATEGORIES.includes(rule.category),
        `${rule.id}: categoria "${rule.category}" non valida`);
    }
  }
});

test('gli id delle regole sono unici', () => {
  assert.equal(new Set(RULE_IDS).size, RULE_IDS.length,
    `id duplicati: ${RULE_IDS.filter((id, i) => RULE_IDS.indexOf(id) !== i).join(', ')}`);
});

test('ogni regola ha un messaggio per l\'utente', () => {
  // Una regola che scatta senza poter spiegare cosa ha visto è inutile
  // nell'interstiziale: l'utente vedrebbe un allarme senza motivo.
  const senzaMessaggio = RULE_IDS.filter((id) => typeof RULE_MESSAGES[id] !== 'function');
  assert.deepEqual(senzaMessaggio, [],
    `regole senza voce in src/messages.it.js: ${senzaMessaggio.join(', ')}`);
});

test('non ci sono messaggi orfani', () => {
  const ids = new Set(RULE_IDS);
  const orfani = Object.keys(RULE_MESSAGES).filter((id) => !ids.has(id));
  assert.deepEqual(orfani, [],
    `messaggi che non corrispondono a nessuna regola: ${orfani.join(', ')}`);
});

test('ogni test di regola è puro e tollera segnali incompleti', () => {
  // Il service worker valuta le regole di fase `url` prima che il DOM esista,
  // quindi ogni test deve sopravvivere all'assenza dei segnali DOM senza
  // lanciare. È il motivo per cui i test usano l'optional chaining.
  const soloUrl = buildUrlSignals('https://esempio.test/percorso');
  for (const rule of RULES) {
    assert.doesNotThrow(() => rule.test(soloUrl), `${rule.id} lancia su segnali di solo URL`);
    assert.doesNotThrow(() => rule.test({}), `${rule.id} lancia su segnali vuoti`);
  }
});

test('i messaggi si rendono senza lanciare, con i parametri veri', () => {
  // Percorre casi che fanno scattare regole diverse e rende ogni messaggio,
  // così che un parametro rinominato nella regola ma non nel messaggio venga
  // intercettato qui invece che davanti all'utente.
  const casi = [
    ['https://paypal.com.verifica.xyz/login', { hasPassword: true }],
    ['https://paypal-secure.xyz/login', { hasPassword: true }],
    ['https://xn--80ak6aa92e.com/', {}],
    ['https://xn--pypal-4ve.com/login', { hasPassword: true }],
    ['https://paypal.com@evil.xyz/', { hasPassword: true }],
    ['http://185.220.101.5/login', { hasPassword: true }],
    ['https://random-kit.pages.dev/signin', { hasPassword: true }],
    ['https://a.b.c.d.e.qualcosa.xyz/account', { hasPassword: true }],
    ['https://esempio-neutro.com:8443/login', { hasPassword: true }],
    ['http://192.168.1.1/login', { hasPassword: true }],
    ['https://poste.it/', { hasPassword: true }],
    ['data:text/html,<form><input type=password></form>', { hasPassword: true }],
    ['https://paypal-secure.xyz/login', { hasPassword: true, userAllowlisted: true }],
    // Attenzione: qui serve un TLD reale. I domini .test e .example non sono
    // nella Public Suffix List, quindi il dominio registrabile resta ignoto e
    // le regole sui marchi tacciono di proposito.
    ['https://sito-cliente.com/login', {
      hasPassword: true, formAction: 'https://raccolta-dati.xyz/raccogli',
      title: 'Accedi a PayPal', visibleText: 'Verifica entro 24 ore o il tuo account sarà sospeso',
      fieldNames: ['otp', 'cvv', 'iban']
    }],
    ['https://esempio-neutro.com/', { safeBrowsingThreat: 'SOCIAL_ENGINEERING' }]
  ];

  const visti = new Set();
  for (const [url, page] of casi) {
    const v = evaluateUrlAndPage(url, page);
    for (const f of v.fired) {
      visti.add(f.id);
      assert.equal(typeof f.message, 'string', `${f.id}: messaggio non renderizzato`);
      assert.ok(f.message.length > 10, `${f.id}: messaggio troppo corto — "${f.message}"`);
      assert.ok(!f.message.includes('undefined'),
        `${f.id}: parametro mancante nel messaggio — "${f.message}"`);
    }
  }

  // Sentinella di copertura: se aggiungi una regola e nessuno dei casi qui
  // sopra la fa scattare, non stai verificando il suo messaggio.
  const nonCoperte = RULE_IDS.filter((id) => !visti.has(id));
  assert.deepEqual(nonCoperte, [],
    `regole mai fatte scattare da questo test: ${nonCoperte.join(', ')}. Aggiungi un caso.`);
});

test('ogni regola compare nel catalogo pubblicato', () => {
  // La promessa che il codice faceva da tempo — «la suite controlla che ogni
  // regola sia documentata» — puntava a un `test/docs-sync.test.js` e a un
  // `docs/DETECTION.md` che non sono mai esistiti. La documentazione per regola
  // esiste davvero, ma sta nel catalogo della pagina di progetto, che
  // `tools/build-page.mjs` genera da RULES: non può descrivere un motore
  // diverso da quello che gira. Quello che POTEVA restare indietro è il file
  // generato, se qualcuno aggiunge una regola e non lancia `npm run page`.
  const page = readFileSync(join(here, '..', 'simulator.html'), 'utf8');
  for (const rule of RULES) {
    assert.ok(page.includes(rule.id),
      `la regola "${rule.id}" non compare in simulator.html: rigenera con \`npm run page\``);
  }
});
