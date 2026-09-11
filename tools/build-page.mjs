#!/usr/bin/env node
/**
 * Genera `simulator.html`, la pagina pubblica del progetto.
 *
 *   node tools/build-page.mjs
 *
 * ─── PERCHÉ GENERATA E NON SCRITTA A MANO ────────────────────────────────────
 *
 * La pagina conteneva un visualizzatore di sorgenti — manifest.json,
 * content.js e options.html incollati dentro — diventato attivamente dannoso:
 * mostrava options.html CON lo script inline che il CSP di Manifest V3 blocca,
 * cioè il bug che avevamo corretto. Chi copiava da lì copiava codice rotto.
 * E conteneva una seconda copia dello scoring, con pesi diversi da quelli
 * dell'estensione: la demo pubblica mostrava numeri che il motore non produce.
 *
 * Ora il catalogo delle regole nasce da `src/rules.js` e il simulatore importa
 * `src/scoring.js`, quindi nessuno dei due può divergere dal motore vero.
 *
 * ─── LA DIREZIONE VISIVA ─────────────────────────────────────────────────────
 *
 * L'eroe non è un titolo con delle statistiche: è UN INDIRIZZO SEZIONATO.
 * Il mondo di questo prodotto è l'inganno per somiglianza — che
 * `paypal.com.verifica-account.xyz` si legga "paypal.com" — e mostrarlo vale
 * più che affermarlo.
 *
 * Il resto è disciplinato attorno a una regola: il colore è segnale, mai
 * decorazione. Vedi il commento in testa a tools/page-parts/style.css.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { RULES } from '../src/rules.js';
import { RULE_MESSAGES, CATEGORY_LABELS, CATEGORY_QUESTIONS, RANK_LABELS, RANK_SUBTITLES } from '../src/messages.it.js';
import { BRANDS } from '../src/brands.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(root, 'tools', 'page-parts', 'style.css'), 'utf8');

const REPO = 'https://github.com/savez/nonAbbocco';
const COFFEE = 'https://buymeacoffee.com/goeokwihgz';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const brandCount = BRANDS.length;
const domainCount = BRANDS.reduce((n, b) => n + b.legit.length, 0);

// ─── Catalogo delle regole, generato dai dati ────────────────────────────────

const KIND_LABEL = { veto: 'veto', strong: 'forte', weak: 'debole', suppress: 'esenzione' };
const CATEGORY_ORDER = ['identity', 'credentials', 'transport', 'reputation'];

/** Un esempio di messaggio, reso con parametri fittizi: mostra al lettore
 *  esattamente la frase che l'estensione gli direbbe. */
const sampleMessage = (rule) => {
  const render = RULE_MESSAGES[rule.id];
  if (!render) return '';
  try {
    return render({
      brand: 'paypal', name: 'PayPal', threat: 'SOCIAL_ENGINEERING',
      labels: ['pаypal'], shown: 'pаypal.com', real: 'evil-collector.xyz',
      ip: '185.220.101.5', suffix: 'pages.dev', tld: '.xyz', depth: 5,
      count: 1, fields: ['codice OTP'], words: ['login'],
      hosts: ['raccolta-dati.xyz'], port: '8443', scheme: 'data:'
    });
  } catch { return ''; }
};

const ruleRow = (rule) => `        <div class="rule">
          <div class="rule__id">${esc(rule.id)}<span class="rule__kind">${KIND_LABEL[rule.kind]}</span></div>
          <div class="rule__what">${esc(sampleMessage(rule))}</div>
        </div>`;

const byCategory = new Map(CATEGORY_ORDER.map((c) => [c, []]));
const suppressions = [];
for (const rule of RULES) {
  if (rule.kind === 'suppress') suppressions.push(rule);
  else byCategory.get(rule.category)?.push(rule);
}

const ruleCatalogue = CATEGORY_ORDER.map((category) => {
  const rules = byCategory.get(category);
  if (!rules.length) return '';
  return `      <div class="rulegroup">
        <div class="rulegroup__head">
          <h3>${esc(CATEGORY_LABELS[category])}</h3>
          <span class="rulegroup__ask">${esc(CATEGORY_QUESTIONS[category])}</span>
        </div>
${rules.map(ruleRow).join('\n')}
      </div>`;
}).filter(Boolean).join('\n') + `
      <div class="rulegroup">
        <div class="rulegroup__head">
          <h3>Esenzioni</h3>
          <span class="rulegroup__ask">Valutate per prime. Nessun punteggio sopravvive a un'esenzione.</span>
        </div>
${suppressions.map(ruleRow).join('\n')}
      </div>`;

// ─── La scala dei livelli ────────────────────────────────────────────────────

const scale = [1, 2, 3, 4, 5].map((r) => `        <div class="scale__item">
          <div class="scale__n r${r}">${r}</div>
          <div class="scale__label">${esc(RANK_LABELS[r])}</div>
          <p class="scale__desc">${esc(RANK_SUBTITLES[r])}</p>
        </div>`).join('\n');

/* ─── Il percorso che porta al rank ──────────────────────────────────────────
 *
 * I passi sono dati, non markup incollato: il giorno in cui il verdetto
 * preliminare sull'indirizzo verrà collegato (oggi `mergeVerdicts` esiste,
 * è testata e non gira) qui si aggiunge una voce e basta.
 *
 * ATTENZIONE ALLA DOPPIA RAPPRESENTAZIONE: lo stesso percorso è disegnato in
 * Mermaid nel README. Se cambia il flusso, vanno aggiornati entrambi — non
 * c'è nulla che lo verifichi al posto tuo.
 */
const FLOW = [
  {
    title: 'La pagina finisce di caricarsi',
    body: ['<code>content.js</code> legge il DOM e si ferma lì: quanti campi password ci sono, come si chiamano i campi, verso quale host punta il form, il titolo, il testo visibile. <b>Non decide nulla.</b> Gira su ogni pagina che apri, cioè anche dentro quella dell\'attaccante, e lì non si tengono né segreti né giudizi.'],
    chips: ['campi password', 'nomi dei campi', 'destinazione dei form', 'titolo', 'testo visibile']
  },
  {
    title: 'I segnali arrivano a background.js',
    body: ['<code>background.js</code> è l\'unico contesto che può importare il motore come modulo, quindi è l\'unico posto dove le euristiche esistono. Dall\'indirizzo ricava quello che il DOM non dice.'],
    chips: ['punycode → Unicode', 'dominio registrabile (PSL)', 'tokenizzazione', 'skeleton dei confondibili']
  },
  {
    title: 'Le regole scattano in ordine',
    body: ['Prima le <b>esenzioni</b>, che azzerano categorie intere: nessun punteggio sopravvive a un\'esenzione, ed è così che il router di casa non diventa un allarme. Poi il <b>veto</b>. Poi le regole <b>forti</b> (2 livelli) e <b>deboli</b> (1 livello, e da sole non superano il livello 1).'],
    chips: [`${RULES.length} regole`, 'esenzioni → veto → forti → deboli']
  },
  {
    title: 'Ogni regola alimenta una categoria',
    body: ['Non un totale unico: quattro accumulatori separati, ciascuno saturato a 3. Sommare fra categorie incommensurabili è l\'errore che il primo motore faceva.'],
    chips: CATEGORY_ORDER.slice()
  },
  {
    title: 'La tupla dei livelli entra in una tabella',
    body: ['Il rank non è una soglia su una somma: è una <b>lettura</b> della quaterna dei livelli. Due pagine con lo stesso totale ma categorie diverse ricevono risposte diverse — che è tutto il punto.']
  },
  {
    title: 'Esce il rank, e con lui cosa vedi',
    body: ['Sopra la soglia che hai scelto, l\'interstiziale. Sotto, la pillola. In entrambi i casi il verdetto finisce in <code>storage.session</code>, ed è <b>quello</b> che il popup della barra ti rilegge: un solo numero, non due calcoli che si somigliano.'],
    ranks: true
  }
];

const flow = `      <ol class="flow">
${FLOW.map((step, i) => `        <li class="flow__step">
          <div class="flow__mark">${i + 1}</div>
          <div>
            <div class="flow__title">${esc(step.title)}</div>
${(step.body || []).map((p) => `            <p>${p}</p>`).join('\n')}
${step.chips ? `            <div class="flow__chips">${step.chips.map((c) => `<span class="flow__chip">${esc(c)}</span>`).join('')}</div>` : ''}
${step.ranks ? `            <div class="flow__ranks">${[1, 2, 3, 4, 5].map((r) => `<span class="flow__rank r${r}" title="${esc(RANK_LABELS[r])}">${r}</span>`).join('')}</div>` : ''}
          </div>
        </li>`).join('\n')}
      </ol>`;

// ─── Icone inline: nessuna richiesta di rete, nessun font di icone ───────────

const ICON_GITHUB = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';
const ICON_COFFEE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z"/><path d="M6 1v3M10 1v3M14 1v3"/></svg>';

// ─── La pagina ───────────────────────────────────────────────────────────────

const page = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NonAbbocco — l'indirizzo sembra giusto. Non lo è.</title>
<meta name="description" content="Estensione Chrome e Firefox open source che smonta l'indirizzo di ogni pagina, assegna un ranking di rischio da 1 a 5 e blocca il phishing prima che tu digiti le credenziali. Analisi locale, nessuna telemetria.">
<meta property="og:title" content="NonAbbocco — difesa anti-phishing con ranking 1-5">
<meta property="og:description" content="L'indirizzo sembra giusto. Non lo è. Estensione Chrome e Firefox, analisi locale, open source.">
<meta property="og:image" content="assets/banner.svg">
<link rel="icon" href="icons/icon-48.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<!-- GENERATO da tools/build-page.mjs — non modificare a mano.
     Rigenera con: node tools/build-page.mjs -->
<style>
${css}
</style>
</head>
<body>

<header class="topbar">
  <div class="wrap topbar__in">
    <a class="brand" href="#top">
      <img src="icons/icon-48.png" alt="">
      <span class="brand__name">NonAbbocco</span>
    </a>
    <nav class="topnav">
      <a href="#prova">Provalo</a>
      <a href="#regole" class="is-hidden-sm">Regole</a>
      <a href="#limiti" class="is-hidden-sm">Limiti</a>
      <a href="${REPO}" aria-label="Codice su GitHub">${ICON_GITHUB}<span class="is-hidden-sm">GitHub</span></a>
      <a href="#installa">Installa</a>
    </nav>
  </div>
</header>

<main id="top">

<!-- ─── Hero: l'anatomia di un indirizzo ─────────────────────────────────── -->
<section class="hero">
  <div class="wrap">
    <span class="eyebrow">Estensione Chrome e Firefox · open source</span>
    <h1 class="hero__claim">L'indirizzo sembra giusto. <em>Non lo è.</em></h1>
    <p class="hero__sub">
      Il phishing non ti frega perché sei distratto. Ti frega perché il tuo occhio
      legge l'inizio di un indirizzo e smette lì.
    </p>

    <div class="anatomy" id="anatomy">
      <div class="anatomy__bar">
        <span class="anatomy__dot"></span><span class="anatomy__dot"></span><span class="anatomy__dot"></span>
        <span>barra degli indirizzi</span>
      </div>

      <div class="anatomy__url">
        <span class="part part--decoy">
          <span class="part__text">https://paypal.com</span>
          <span class="part__brace"></span>
          <span class="part__label">questo leggi</span>
        </span><span class="part part--real">
          <span class="part__text">.verifica-account.xyz</span>
          <span class="part__brace"></span>
          <span class="part__label">questo è il sito</span>
        </span><span class="part">
          <span class="part__text">/login</span>
        </span>
      </div>

      <p class="anatomy__note">
        Il dominio è <b>verifica-account.xyz</b>, registrato da chiunque per pochi euro.
        &ldquo;paypal.com&rdquo; è soltanto testo che gli sta davanti. NonAbbocco fa questa
        lettura su ogni pagina che apri, prima che tu digiti qualcosa.
      </p>
    </div>

    <div class="hero__cta">
      <a class="btn btn--solid" href="#installa">Installa l'estensione</a>
      <a class="btn btn--ghost" href="#prova">Provalo qui sotto</a>
      <a class="btn btn--ghost" href="${REPO}">${ICON_GITHUB} Codice su GitHub</a>
    </div>
  </div>
</section>

<!-- ─── Come decide ──────────────────────────────────────────────────────── -->
<section class="band">
  <div class="wrap">
    <span class="eyebrow">Come decide</span>
    <h2>Quattro domande, non un punteggio</h2>
    <p class="lede">
      La prima versione del motore sommava punti. Dava <b>55</b> a
      <code>paypal-secure.xyz/login</code> e <b>55</b> anche a <code>posteitaliane.it</code>:
      un attacco da manuale e il sito vero di Poste, stesso verdetto. Il problema non erano i
      pesi, era sommare fra grandezze che non si sommano.
    </p>

    <div class="questions">
${CATEGORY_ORDER.map((c) => `      <div class="question">
        <div class="question__key">${esc(c)}</div>
        <p class="question__ask">${esc(CATEGORY_QUESTIONS[c])}</p>
      </div>`).join('\n')}
    </div>

    <div class="formula">
      <div class="formula__row"><span class="formula__rank r5">rank 5</span><span class="formula__cond">veto — solo un riscontro di Safe Browsing</span></div>
      <div class="formula__row"><span class="formula__rank r4">rank 4</span><span class="formula__cond">identity ≥ 2 <b>E</b> credentials ≥ 1</span></div>
      <div class="formula__row"><span class="formula__rank r3">rank 3</span><span class="formula__cond">identity ≥ 2 <b>O</b> (identity ≥ 1 <b>E</b> credentials ≥ 1) <b>O</b> (transport ≥ 2 <b>E</b> credentials ≥ 1)</span></div>
      <div class="formula__row"><span class="formula__rank r2">rank 2</span><span class="formula__cond">identity ≥ 1 <b>O</b> transport ≥ 1 <b>O</b> reputation ≥ 1</span></div>
      <div class="formula__row"><span class="formula__rank r1">rank 1</span><span class="formula__cond">nessuna evidenza</span></div>
    </div>

    <div class="callout">
      <p>
        Guarda cosa manca: <b>credentials non compare mai da sola</b>. Una pagina che chiede una
        password non è per questo sospetta — è la cosa più normale del web. Se bastasse da sola,
        ogni login di ogni banca sarebbe un allarme e disinstalleresti l'estensione in due giorni.
      </p>
      <p>
        È questa scelta che ha eliminato i falsi positivi su <code>posteitaliane.it</code> e
        <code>login.microsoftonline.com</code>, e che impedisce di bloccarti il router di casa
        su <code>192.168.1.1</code>.
      </p>
    </div>

    <div class="flow-intro">
      <span class="eyebrow">Il percorso</span>
      <h3 class="flow-heading">Dai segnali al numero, in sei passi</h3>
    </div>
${flow}

    <div class="scale">
${scale}
    </div>
  </div>
</section>

<!-- ─── Simulatore ───────────────────────────────────────────────────────── -->
<section class="band" id="prova">
  <div class="wrap">
    <span class="eyebrow">Provalo</span>
    <h2>Costruisci una pagina falsa e guarda cosa succede</h2>
    <p class="lede">
      I verdetti li produce lo stesso codice che gira nell'estensione: questa pagina importa
      <code>src/scoring.js</code>. Niente naviga davvero, è tutto simulato qui dentro.
    </p>

    <div id="engine-warning" class="warnbox is-hidden">
      <strong>Il motore non si è caricato.</strong>
      La pagina importa <code>src/scoring.js</code> come modulo ES, e i moduli non si caricano
      con <code>file://</code>. Servi la cartella — per esempio con <code>npx serve .</code> — e
      riapri da <code>http://localhost</code>.
    </div>

    <div class="sim">
      <div class="panel">
        <div class="panel__head"><span class="eyebrow">La pagina finta</span></div>
        <div class="panel__body">
          <div class="presets" id="presets">
            <button class="preset" data-preset="legit" type="button">PayPal vero<small>paypal.com</small></button>
            <button class="preset" data-preset="typo" type="button">Typosquatting<small>paypal-secure.xyz</small></button>
            <button class="preset" data-preset="sub" type="button">Marchio nel sottodominio<small>paypal.com.???.xyz</small></button>
            <button class="preset" data-preset="pages" type="button">Hosting gratuito<small>???.pages.dev</small></button>
          </div>

          <div class="field">
            <label for="sim-url">Indirizzo</label>
            <input id="sim-url" type="text" spellcheck="false" value="https://paypal-secure.xyz/it/login">
          </div>
          <div class="field">
            <label for="sim-title">Titolo della pagina</label>
            <input id="sim-title" type="text" value="Accedi a PayPal — verifica obbligatoria">
          </div>
          <div class="field">
            <label for="sim-action">Dove invia il modulo</label>
            <input id="sim-action" type="text" spellcheck="false" value="">
          </div>

          <div class="toggles">
            <label class="toggle"><input id="sim-pwd" type="checkbox" checked> Chiede una password</label>
            <label class="toggle"><input id="sim-urgency" type="checkbox" checked> Insiste sull'urgenza</label>
          </div>

          <div class="field">
            <label for="sim-threshold">Soglia di blocco (nelle opzioni)</label>
            <select id="sim-threshold">
              <option value="5" selected>Livello 5 — solo minaccia confermata</option>
              <option value="4">Livello 4 — anche rischio elevato</option>
              <option value="3">Livello 3 — anche sospetto moderato</option>
              <option value="2">Livello 2 — massima sensibilità</option>
            </select>
          </div>
        </div>
      </div>

      <div class="viewport">
        <div class="viewport__bar">
          <span class="anatomy__dot"></span><span class="anatomy__dot"></span><span class="anatomy__dot"></span>
          <span class="viewport__addr" id="mock-url"></span>
          <span class="rankchip" id="rank-chip">1/5</span>
        </div>

        <div class="stage">
          <div class="fakepage">
            <div class="fakepage__logo">P</div>
            <h4 id="fake-title"></h4>
            <p class="fakepage__urgent" id="fake-urgent">Verifica necessaria entro 24 ore.</p>
            <div class="fakepage__row"><span>email</span><i></i></div>
            <div class="fakepage__row"><span>password</span><i></i></div>
            <div class="fakepage__btn">Accedi</div>
            <p class="fakepage__action" id="fake-action"></p>
          </div>

          <div class="pill is-hidden" id="pill">
            <img src="icons/icon-48.png" alt="">
            <span><b id="pill-level"></b><br><span style="color:var(--muted)">sotto la soglia di blocco</span></span>
            <button type="button" id="pill-details">Dettagli</button>
          </div>

          <div class="bypass is-hidden" id="bypass">
            <span>Blocco ignorato per questa pagina.</span>
            <button type="button" id="bypass-undo">Ripristina</button>
          </div>

          <div class="block is-hidden" id="block">
            <span class="block__tag" id="block-tag"></span>
            <h4>Non abboccare all'esca</h4>
            <p class="block__sub" id="block-sub"></p>

            <div class="block__scroll">
              <div class="levels" id="levels"></div>
              <ul class="reasons" id="reasons"></ul>
              <div class="exempt is-hidden" id="exempt"></div>
            </div>

            <div class="block__actions">
              <button class="btn btn--solid" type="button" id="go-safe">Torna al sicuro</button>
              <button class="btn btn--ghost" type="button" id="go-anyway">Procedi comunque</button>
            </div>
          </div>
        </div>

        <div class="diag">
          <span id="diag-state"></span>
          <span id="diag-levels"></span>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ─── Catalogo delle regole ────────────────────────────────────────────── -->
<section class="band" id="regole">
  <div class="wrap">
    <span class="eyebrow">${RULES.length} regole · ${brandCount} marchi · ${domainCount} domini legittimi</span>
    <h2>Cosa guarda, esattamente</h2>
    <p class="lede">
      Ogni regola alimenta una delle quattro categorie. Questo elenco è generato da
      <code>src/rules.js</code>: non può descrivere qualcosa che il motore non fa. Il testo di
      ciascuna è la frase che leggeresti davvero nell'avviso.
    </p>

${ruleCatalogue}
  </div>
</section>

<!-- ─── Limiti ───────────────────────────────────────────────────────────── -->
<section class="band" id="limiti">
  <div class="wrap">
    <span class="eyebrow">Limiti</span>
    <h2>Cosa non sa fare</h2>
    <p class="lede">
      Uno strumento di sicurezza che nasconde i propri limiti è peggio di uno che non li ha,
      perché ti fa abbassare la guardia dove non dovresti.
    </p>

    <div class="callout callout--flag">
      <p>
        <b>Il livello 1 significa «nessun segnale noto», non «sito sicuro».</b>
        Un kit di phishing su un dominio pulito con certificato valido può non attivare nessuna
        regola. Nessuna schermata di NonAbbocco ti dirà mai che un sito è sicuro: sostituire la
        tua prudenza con una certezza falsa farebbe più danni che tacere.
      </p>
    </div>

    <div class="callout">
      <p>
        <b>La lista dei marchi non scala.</b> Nessun elenco curato a mano coprirà i marchi che
        non abbiamo previsto. Per questo un marchio riconosciuto da solo non produce un rank
        alto — serve la congiunzione — e per questo la copertura ampia è compito di Safe
        Browsing, una lista che non manteniamo noi.
      </p>
      <p>
        <b>In Manifest V3 non esiste alcun modo di bloccare una richiesta di rete.</b>
        NonAbbocco non impedisce il caricamento: lo sostituisce con un avviso entro poche
        centinaia di millisecondi. Il phishing richiede che tu legga e digiti, ed è quella
        finestra che si chiude.
      </p>
      <p>
        <b>Non intercetta l'invio via JavaScript.</b> Servirebbe iniettare codice nel contesto
        della pagina, cioè in casa dell'attaccante: inaffidabile come rilevamento e una
        superficie d'attacco concreta in cambio. Scelta consapevole, non dimenticanza.
      </p>
    </div>
  </div>
</section>

<!-- ─── Installazione ────────────────────────────────────────────────────── -->
<section class="band" id="installa">
  <div class="wrap">
    <span class="eyebrow">Installazione</span>
    <h2>Non è ancora sugli store</h2>
    <p class="lede">Si carica in modalità sviluppatore a partire dai file del repository.</p>

    <div class="install">
      <div class="panel">
        <div class="panel__head"><h3>Chrome, Edge, Brave</h3></div>
        <div class="panel__body">
          <ol>
            <li>Clona il repository in una cartella locale.</li>
            <li>Apri <code>chrome://extensions</code>.</li>
            <li>Attiva in alto a destra la <b>Modalità sviluppatore</b>.</li>
            <li>Premi <b>Carica estensione non pacchettizzata</b> e scegli la cartella.</li>
            <li>Regola la soglia di blocco dalle <b>Opzioni</b>.</li>
          </ol>
        </div>
      </div>
      <div class="panel">
        <div class="panel__head"><h3>Firefox</h3></div>
        <div class="panel__body">
          <ol>
            <li>Apri <code>about:debugging#/runtime/this-firefox</code>.</li>
            <li>Premi <b>Carica componente aggiuntivo temporaneo</b>.</li>
            <li>Seleziona <code>manifest.json</code>.</li>
          </ol>
          <p class="lede" style="font-size:.82rem;margin-top:.8rem">
            Il caricamento temporaneo si azzera alla chiusura del browser.
          </p>
        </div>
      </div>
    </div>

    <div class="support">
      <div class="support__in">
        <div>
          <h3>NonAbbocco è gratis e lo resterà</h3>
          <p>
            Nessuna telemetria da rivendere, nessuna versione a pagamento, nessun investitore da
            ripagare. Se ti ha risparmiato un guaio, offrimi un caffè.
          </p>
        </div>
        <a class="btn btn--coffee" href="${COFFEE}" rel="noopener">${ICON_COFFEE} Offrimi un caffè</a>
      </div>
    </div>
  </div>
</section>

</main>

<footer class="foot">
  <div class="wrap">
    <div class="foot__in">
      <div>
        <a class="brand" href="#top" style="margin-bottom:.7rem">
          <img src="icons/icon-48.png" alt="">
          <span class="brand__name">NonAbbocco</span>
        </a>
        <p class="foot__note">
          Analisi interamente locale. Gli indirizzi che visiti non lasciano il browser e non
          vengono registrati da nessuna parte.
        </p>
      </div>
      <div>
        <h4>Progetto</h4>
        <ul>
          <li><a href="${REPO}">Codice sorgente</a></li>
          <li><a href="${REPO}/blob/main/docs/RANKING.md">Come decide il rank</a></li>
          <li><a href="${REPO}/blob/main/CONTRIBUTING.md">Contribuire</a></li>
          <li><a href="${REPO}/issues">Segnala un falso positivo</a></li>
        </ul>
      </div>
      <div>
        <h4>Sostieni</h4>
        <ul>
          <li><a href="${COFFEE}" rel="noopener">Offrimi un caffè</a></li>
          <li><a href="${REPO}/blob/main/SECURITY.md">Segnala una vulnerabilità</a></li>
          <li><a href="${REPO}/blob/main/LICENSE">Licenza MIT</a></li>
          <li><a href="${REPO}/stargazers">Metti una stella</a></li>
        </ul>
      </div>
    </div>
    <div class="foot__legal">
      <span>Manifest V3 · Chrome e Firefox · MIT</span>
      <span>Nessuna telemetria, nessun analytics</span>
    </div>
  </div>
</footer>

<script type="module">
import { evaluateUrlAndPage, CATEGORIES } from './src/scoring.js';
import { RANK_LABELS, RANK_SUBTITLES, CATEGORY_LABELS } from './src/messages.it.js';

window.__ENGINE_OK__ = true;

const $ = (id) => document.getElementById(id);
let bypassed = false;

const SCENARIOS = {
  legit: { url: 'https://www.paypal.com/it/signin', title: 'Accedi al tuo conto PayPal', action: '', pwd: true, urgency: false },
  typo:  { url: 'https://paypal-secure.xyz/it/login', title: 'Accedi a PayPal — verifica obbligatoria', action: '', pwd: true, urgency: true },
  sub:   { url: 'https://paypal.com.verifica-account.xyz/login', title: 'PayPal — conferma i tuoi dati', action: 'https://raccolta-dati.xyz/post.php', pwd: true, urgency: true },
  pages: { url: 'https://accesso-clienti-2026.pages.dev/signin', title: 'Area riservata', action: '', pwd: true, urgency: false }
};

function applyPreset(key) {
  const p = SCENARIOS[key];
  if (!p) return;
  bypassed = false;
  $('sim-url').value = p.url;
  $('sim-title').value = p.title;
  $('sim-action').value = p.action;
  $('sim-pwd').checked = p.pwd;
  $('sim-urgency').checked = p.urgency;
  for (const b of document.querySelectorAll('.preset')) {
    b.setAttribute('aria-pressed', String(b.dataset.preset === key));
  }
  run();
}

function run() {
  const url = $('sim-url').value.trim();
  const title = $('sim-title').value.trim();
  const action = $('sim-action').value.trim();
  const pwd = $('sim-pwd').checked;
  const urgency = $('sim-urgency').checked;
  const threshold = Number.parseInt($('sim-threshold').value, 10) || 5;

  $('mock-url').textContent = url || '—';
  $('fake-title').textContent = title || 'Accedi';
  $('fake-urgent').classList.toggle('is-hidden', !urgency);
  $('fake-action').textContent = action ? 'invia a ' + action : 'invia via JavaScript (nessuna action)';

  const v = evaluateUrlAndPage(url, {
    hasPassword: pwd,
    formAction: action || null,
    title,
    visibleText: urgency ? 'Verifica necessaria entro 24 ore o il conto sarà sospeso' : ''
  });

  const tone = ['r1', 'r1', 'r2', 'r3', 'r4', 'r5'][v.rank];
  const chip = $('rank-chip');
  chip.textContent = v.rank + '/5';
  chip.className = 'rankchip ' + tone;
  chip.style.color = 'var(--' + (v.rank >= 5 ? 'flag' : v.rank === 4 ? 'warn' : v.rank === 3 ? 'notice' : 'clear') + ')';

  $('block-tag').textContent = RANK_LABELS[v.rank] + ' · ' + v.rank + '/5';
  $('block-sub').textContent = RANK_SUBTITLES[v.rank];

  // I livelli per categoria: sostituiscono il punteggio su 100, che non
  // spiegava nulla. Ogni riga è una domanda che l'utente capisce.
  const levels = $('levels');
  levels.textContent = '';
  for (const c of CATEGORIES) {
    const lvl = v.categories[c];
    const suppressed = v.suppressed.includes(c);
    const row = document.createElement('div');
    row.className = 'level' + (suppressed ? ' is-suppressed' : '');
    const name = document.createElement('span');
    name.className = 'level__name';
    name.textContent = CATEGORY_LABELS[c];
    const pips = document.createElement('span');
    pips.className = 'level__pips';
    for (let i = 1; i <= 3; i++) {
      const pip = document.createElement('i');
      if (i <= lvl) pip.className = lvl >= 2 ? 'hot' : 'on';
      pips.appendChild(pip);
    }
    row.append(name, pips);
    levels.appendChild(row);
  }

  const reasons = $('reasons');
  reasons.textContent = '';
  const fired = v.fired.filter((f) => f.kind !== 'suppress');
  if (!fired.length) {
    const li = document.createElement('li');
    li.style.listStyle = 'none';
    li.style.marginLeft = '-1.1rem';
    li.style.color = 'var(--muted)';
    li.textContent = 'Nessuna anomalia rilevata.';
    reasons.appendChild(li);
  }
  for (const f of fired) {
    const li = document.createElement('li');
    li.textContent = f.message;
    reasons.appendChild(li);
  }

  // Le esenzioni spiegano perché qualcosa NON è stato segnalato, che è
  // informazione utile quanto il contrario.
  const exempt = $('exempt');
  exempt.textContent = '';
  const exemptions = v.fired.filter((f) => f.kind === 'suppress');
  exempt.classList.toggle('is-hidden', !exemptions.length);
  for (const f of exemptions) {
    const d = document.createElement('div');
    d.textContent = '✓ ' + f.message;
    exempt.appendChild(d);
  }

  $('diag-levels').textContent = CATEGORIES.map((c) => c.slice(0, 2) + v.categories[c]).join(' ');

  const block = $('block');
  const pill = $('pill');
  const bypassBar = $('bypass');
  bypassBar.classList.toggle('is-hidden', !bypassed);

  if (v.rank >= threshold) {
    pill.classList.add('is-hidden');
    block.classList.toggle('is-hidden', bypassed);
    $('diag-state').textContent = bypassed
      ? 'blocco ignorato dall\\'utente'
      : 'interstiziale attivo — livello ' + v.rank + ' ≥ soglia ' + threshold;
  } else {
    block.classList.add('is-hidden');
    if (v.rank >= 2) {
      pill.classList.remove('is-hidden');
      $('pill-level').textContent = RANK_LABELS[v.rank] + ' (' + v.rank + '/5)';
      $('diag-state').textContent = 'avviso discreto — livello ' + v.rank + ' < soglia ' + threshold;
    } else {
      pill.classList.add('is-hidden');
      $('diag-state').textContent = RANK_LABELS[1].toLowerCase();
    }
  }
}

for (const b of document.querySelectorAll('.preset')) {
  b.addEventListener('click', () => applyPreset(b.dataset.preset));
}
for (const id of ['sim-url', 'sim-title', 'sim-action']) $(id).addEventListener('input', run);
for (const id of ['sim-pwd', 'sim-urgency', 'sim-threshold']) $(id).addEventListener('change', run);
$('pill-details').addEventListener('click', () => $('block').classList.remove('is-hidden'));
$('go-safe').addEventListener('click', () => applyPreset('legit'));
$('go-anyway').addEventListener('click', () => { bypassed = true; run(); });
$('bypass-undo').addEventListener('click', () => { bypassed = false; run(); });

document.querySelector('.preset[data-preset="typo"]')?.setAttribute('aria-pressed', 'true');
run();
</script>

<script>
// La rivelazione dell'hero: prima quello che leggi, poi quello che è.
// Se l'utente ha chiesto meno animazioni, mostra subito lo stato finale.
(function () {
  var el = document.getElementById('anatomy');
  if (!el) return;
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) { el.classList.add('is-revealed'); return; }
  setTimeout(function () { el.classList.add('is-revealed'); }, 700);
})();

// Se il modulo non si carica — tipicamente perché la pagina è aperta con
// file:// — dillo, invece di mostrare un simulatore inerte.
window.addEventListener('load', function () {
  if (!window.__ENGINE_OK__) document.getElementById('engine-warning').classList.remove('is-hidden');
});
</script>
</body>
</html>
`;

await writeFile(join(root, 'simulator.html'), page, 'utf8');

console.log(`Scritto simulator.html (${(page.length / 1024).toFixed(1)} KB)`);
console.log(`  ${RULES.length} regole · ${brandCount} marchi · ${domainCount} domini legittimi`);
