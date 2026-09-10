import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  evaluateUrlAndPage, buildUrlSignals, evaluate, mergeVerdicts,
  rankFromCategories, rankLabel, tokenize, isPrivateAddress, CATEGORIES
} from '../src/scoring.js';
import { RULES } from '../src/rules.js';
import { BRANDS, LEGIT_DOMAINS } from '../src/brands.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, 'corpus', name), 'utf8'));

const benign = load('benign.json');
const malicious = load('malicious.json');

const evalCase = (c) =>
  evaluateUrlAndPage(c.url, { hasPassword: c.hasPassword, formAction: c.formAction });

const detail = (v) =>
  `rank ${v.rank} · livelli ${CATEGORIES.map((k) => `${k[0]}${v.categories[k]}`).join(' ')} · ` +
  `regole [${v.fired.map((f) => f.id).join(', ') || 'nessuna'}]`;

// ─── Il corpus è il contratto ────────────────────────────────────────────────

test('nessun falso positivo sui siti legittimi', async (t) => {
  for (const c of benign.cases) {
    await t.test(c.id, () => {
      const v = evalCase(c);
      assert.ok(v.rank <= c.maxRank,
        `${c.url}\n  rank massimo accettabile: ${c.maxRank}\n  ottenuto: ${detail(v)}\n  ${c.note}`);
    });
  }
});

test('nessun falso negativo sulle pagine di phishing', async (t) => {
  for (const c of malicious.cases) {
    await t.test(c.id, () => {
      const v = evalCase(c);
      assert.ok(v.rank >= c.minRank,
        `${c.url}\n  rank minimo richiesto: ${c.minRank}\n  ottenuto: ${detail(v)}\n  ${c.note}`);
    });
  }
});

test('i casi malevoli scattano per la ragione giusta, non per caso', async (t) => {
  for (const c of malicious.cases.filter((x) => x.mustFire)) {
    await t.test(c.id, () => {
      const fired = new Set(evalCase(c).fired.map((f) => f.id));
      for (const id of c.mustFire) {
        assert.ok(fired.has(id),
          `${c.url}\n  deve scattare "${id}" ma sono scattate solo: [${[...fired].join(', ')}]`);
      }
    });
  }
});

// ─── Le regressioni chiuse restano chiuse ────────────────────────────────────

test('i falsi positivi del vecchio motore additivo sono chiusi', () => {
  const fixed = benign.cases.filter((c) => c.wasFalsePositive);
  assert.ok(fixed.length >= 8, 'il corpus deve conservare i falsi positivi storici come regressione');

  for (const c of fixed) {
    const v = evalCase(c);
    assert.ok(v.rank < c.wasFalsePositive,
      `"${c.id}" prendeva rank ${c.wasFalsePositive} e ora prende ${v.rank}: la regressione è tornata`);
  }
});

test('i falsi negativi del vecchio motore additivo sono chiusi', () => {
  const fixed = malicious.cases.filter((c) => c.wasFalseNegative);
  assert.ok(fixed.length >= 3);


  for (const c of fixed) {
    const v = evalCase(c);
    assert.ok(v.rank > c.wasFalseNegative,
      `"${c.id}" prendeva rank ${c.wasFalseNegative} e ora prende ${v.rank}: la regressione è tornata`);
  }
});

test('un IDN legittimo e un omografo non sono più la stessa cosa', () => {
  // Il vecchio motore dava +40 alla sola presenza di "xn--", quindi assegnava
  // lo stesso rank 3 a bücher.de e ad аррӏе.com. Il rank dell'attacco non è
  // cambiato: è cambiato che il sito legittimo non viene più punito, e che
  // l'attacco ora scatta perché SOMIGLIA a un marchio, non perché è IDN.
  const legittimo = evaluateUrlAndPage('https://xn--bcher-kva.de/');
  const omografo = evaluateUrlAndPage('https://xn--80ak6aa92e.com/');

  assert.equal(legittimo.rank, 1, `bücher.de deve essere pulito: ${detail(legittimo)}`);
  assert.ok(omografo.rank >= 3, `аррӏе.com deve restare segnalato: ${detail(omografo)}`);
  assert.ok(omografo.fired.some((f) => f.id === 'homograph-brand-collision'),
    'deve scattare per collisione con un marchio, non per la presenza di punycode');
  assert.ok(!legittimo.fired.some((f) => f.category === 'identity'),
    'nessuna regola di identità deve scattare su un IDN legittimo');
});

test('lo stesso attacco riceve lo stesso verdetto, ovunque stia la parola chiave', () => {
  // L'incoerenza che ha motivato il modello a categorie: il vecchio motore
  // dava 55 punti a uno e 85 all'altro solo per la posizione di "login".
  const nelPath = evaluateUrlAndPage('https://paypal-secure.xyz/login', { hasPassword: true });
  const nellHost = evaluateUrlAndPage('https://login-paypal.xyz/', { hasPassword: true });
  assert.equal(nelPath.rank, nellHost.rank,
    `stesso attacco, verdetti diversi: path=${detail(nelPath)} host=${detail(nellHost)}`);
});

// ─── Il modello di calibrazione ──────────────────────────────────────────────

test('chiedere una password non è di per sé sospetto', () => {
  // La regola che rende il modello utilizzabile: `credentials` conta solo in
  // congiunzione. Se alzasse il rank da sola, ogni pagina di login del web
  // sarebbe un allarme.
  assert.equal(rankFromCategories({ identity: 0, credentials: 3, transport: 0, reputation: 0 }), 1);
  assert.equal(rankFromCategories({ identity: 1, credentials: 0, transport: 0, reputation: 0 }), 2);
  assert.equal(rankFromCategories({ identity: 1, credentials: 1, transport: 0, reputation: 0 }), 3);
  assert.equal(rankFromCategories({ identity: 2, credentials: 0, transport: 0, reputation: 0 }), 3);
  assert.equal(rankFromCategories({ identity: 2, credentials: 1, transport: 0, reputation: 0 }), 4);
});

test('il veto porta a 5 e solo Safe Browsing può emetterlo', () => {
  assert.equal(rankFromCategories({ identity: 0, credentials: 0, transport: 0, reputation: 0 }, 'safebrowsing-hit'), 5);

  const vetoRules = RULES.filter((r) => r.kind === 'veto');
  assert.equal(vetoRules.length, 1, 'un solo veto: il rank 5 è legato alla variante con attribuzione Google');
  assert.equal(vetoRules[0].id, 'safebrowsing-hit');

  const v = evaluateUrlAndPage('https://esempio-neutro.test/', { safeBrowsingThreat: 'SOCIAL_ENGINEERING' });
  assert.equal(v.rank, 5);
  assert.equal(v.veto, 'safebrowsing-hit');
});

test('molti segnali deboli non equivalgono a una prova forte', () => {
  const onlyWeak = evaluate({
    ...buildUrlSignals('https://qualcosa.xyz/login/account/verify'),
    isEphemeralHosting: true,
    subdomainTokens: ['a', 'b', 'c', 'd']
  }, { phase: 'url' });

  const weakFired = onlyWeak.fired.filter((f) => f.kind === 'weak' && f.category === 'identity');
  assert.ok(weakFired.length >= 2, `attese più regole debole di identità, scattate: ${weakFired.length}`);
  assert.equal(onlyWeak.categories.identity, 1,
    'la saturazione deve fermare a 1 le categorie alimentate solo da regole debole');
});

test('le soppressioni battono tutto', () => {
  const v = evaluateUrlAndPage('http://192.168.1.1:8080/login', { hasPassword: true });
  assert.ok(v.suppressed.includes('identity'));
  assert.ok(v.suppressed.includes('transport'));
  assert.equal(v.categories.identity, 0);
  assert.equal(v.categories.transport, 0);
  assert.equal(v.rank, 1);
});

test("l'allowlist utente azzera ogni categoria", () => {
  const senza = evaluateUrlAndPage('https://paypal-secure.xyz/login', { hasPassword: true });
  const con = evaluateUrlAndPage('https://paypal-secure.xyz/login', { hasPassword: true, userAllowlisted: true });
  assert.equal(senza.rank, 4);
  assert.equal(con.rank, 1);
});

test('la fusione dei verdetti è monotona: il rank sale, non scende', () => {
  const alto = { rank: 4, categories: { identity: 2, credentials: 1, transport: 0, reputation: 0 }, fired: [], suppressed: [], veto: null };
  const basso = { rank: 1, categories: { identity: 0, credentials: 0, transport: 0, reputation: 0 }, fired: [], suppressed: [], veto: null };

  assert.equal(mergeVerdicts(alto, basso).rank, 4,
    'un DOM innocuo non deve poter ritirare un interstiziale già mostrato');
  assert.equal(mergeVerdicts(basso, alto).rank, 4);
});

test('il rank 1 non viene mai comunicato come "sicuro"', () => {
  for (const rank of [1, 2, 3, 4, 5]) {
    assert.ok(rankLabel(rank).length > 0);
  }
  assert.ok(!rankLabel(1).toLowerCase().includes('sicur'),
    `il rank 1 dice: "${rankLabel(1)}" — l'assenza di segnali non è una garanzia`);
});

// ─── Il matching per token, che è ciò che rende ampliabile la brand list ─────

test('il matching per token non marca le parole che contengono un marchio', () => {
  // Con la ricerca per sottostringa questi erano tutti falsi positivi:
  // "timbrature" contiene "tim", "penelope" contiene "enel", e così via.
  const innocenti = [
    'https://www.timbrature.it/', 'https://www.multimedia.it/',
    'https://www.penelope.it/', 'https://www.skyscanner.it/',
    'https://www.ultimatestore.com/', 'https://www.sentimento.it/'
  ];
  for (const url of innocenti) {
    const v = evaluateUrlAndPage(url, { hasPassword: false });
    assert.equal(v.categories.identity, 0, `${url} → ${detail(v)}`);
  }
});

test('tokenize spezza sui confini e non nel mezzo delle parole', () => {
  assert.deepEqual(tokenize('paypal-secure'), ['paypal', 'secure']);
  assert.deepEqual(tokenize('timbrature'), ['timbrature']);
  assert.deepEqual(tokenize('tim-fatture'), ['tim', 'fatture']);
});

test('gli indirizzi privati sono riconosciuti, quelli pubblici no', () => {
  for (const ip of ['192.168.1.1', '10.0.0.1', '127.0.0.1', '172.16.0.1', '169.254.1.1', '100.64.0.1', '::1']) {
    assert.ok(isPrivateAddress(ip), `${ip} deve essere privato`);
  }
  for (const ip of ['185.220.101.5', '8.8.8.8', '1.1.1.1', '172.32.0.1']) {
    assert.ok(!isPrivateAddress(ip), `${ip} deve essere pubblico`);
  }
});

// ─── Coerenza dei dati ───────────────────────────────────────────────────────

test('ogni marchio dichiara domini legittimi coerenti', () => {
  const ids = new Set();
  for (const brand of BRANDS) {
    assert.ok(!ids.has(brand.id), `id di marchio duplicato: ${brand.id}`);
    ids.add(brand.id);
    assert.ok(brand.labels.length > 0, `${brand.id} non ha token`);
    assert.ok(brand.legit.length > 0,
      `${brand.id} non dichiara domini legittimi: senza allowlist completa è una fabbrica di falsi positivi`);
    for (const domain of brand.legit) {
      assert.ok(domain.includes('.') && domain === domain.toLowerCase(),
        `dominio malformato in ${brand.id}: ${domain}`);
    }
  }
});

test('un dominio legittimo non insospettisce mai per il proprio marchio', () => {
  for (const brand of BRANDS) {
    for (const domain of brand.legit) {
      const v = evaluateUrlAndPage(`https://${domain}/login`, { hasPassword: true });
      assert.equal(v.categories.identity, 0,
        `${domain} appartiene a ${brand.name} ma prende identità ${v.categories.identity}: ${detail(v)}`);
    }
  }
});

test('un URL non parsabile non fa esplodere il motore', () => {
  for (const bad of ['non-un-url', '', 'http://', '://x']) {
    const v = evaluateUrlAndPage(bad);
    assert.equal(v.rank, 1);
  }
});

// ─── Budget di performance ───────────────────────────────────────────────────

test('il controllo costa microsecondi, non millisecondi', () => {
  // Requisito di prodotto: il controllo sta nel percorso di ogni navigazione,
  // quindi non deve essere percepibile. I limiti sono larghi rispetto alle
  // misure reali (~4 microsecondi per URL su hardware da sviluppo): servono a
  // intercettare una regressione catastrofica, non a misurare la macchina.
  const urls = [
    'https://www.posteitaliane.it/', 'https://paypal.com.verifica.xyz/login',
    'https://random-kit.pages.dev/signin', 'https://xn--80ak6aa92e.com/',
    'http://192.168.1.1/login', 'https://a.b.c.d.example.co.uk/'
  ];

  for (let i = 0; i < 500; i++) for (const u of urls) evaluateUrlAndPage(u, { hasPassword: true });

  const N = 3000;
  const start = performance.now();
  for (let i = 0; i < N; i++) evaluateUrlAndPage(urls[i % urls.length], { hasPassword: true });
  const perUrl = ((performance.now() - start) / N) * 1000;

  assert.ok(perUrl < 200,
    `costo per URL ${perUrl.toFixed(1)} microsecondi, budget 200. Il controllo è nel percorso di ogni navigazione.`);
});
