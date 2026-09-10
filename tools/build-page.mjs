#!/usr/bin/env node
/**
 * Genera `simulator.html`, la pagina pubblica del progetto.
 *
 *   node tools/build-page.mjs
 *
 * PERCHÉ ESISTE QUESTO SCRIPT invece di un file scritto a mano.
 *
 * La pagina conteneva un visualizzatore di sorgenti: ~340 righe con
 * manifest.json, content.js e options.html incollati dentro, più i pulsanti
 * per copiarli e scaricarli. Sono diventate attivamente dannose, perché
 * mostravano `options.html` CON lo script inline che il CSP di Manifest V3
 * blocca — cioè il bug che abbiamo corretto — e il vecchio motore di scoring.
 * Chi copiava da lì copiava codice rotto.
 *
 * Conteneva anche una SECONDA copia dello scoring, divergente da quella
 * dell'estensione: pesi diversi, una regola in più, una lista di marchi più
 * corta. La demo pubblica mostrava numeri che l'estensione non produceva.
 *
 * Da qui la scelta di generare: la tabella delle regole nasce da
 * `src/rules.js` e il simulatore importa `src/scoring.js`, quindi nessuna
 * delle due può più divergere dal motore vero.
 *
 * Il blocco del simulatore interattivo viene riusato verbatim dalla versione
 * precedente della pagina, conservato in `tools/page-parts/simulator-ui.html`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { RULES } from '../src/rules.js';
import { RULE_MESSAGES, CATEGORY_LABELS, CATEGORY_QUESTIONS, RANK_LABELS, RANK_SUBTITLES } from '../src/messages.it.js';
import { BRANDS } from '../src/brands.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const simulatorUi = await readFile(join(root, 'tools', 'page-parts', 'simulator-ui.html'), 'utf8');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const KIND_STYLE = {
  veto: ['bg-rose-500/15 text-rose-300 border-rose-500/30', 'veto'],
  strong: ['bg-orange-500/15 text-orange-300 border-orange-500/30', 'forte'],
  weak: ['bg-amber-500/10 text-amber-300/90 border-amber-500/25', 'debole'],
  suppress: ['bg-emerald-500/15 text-emerald-300 border-emerald-500/30', 'esenzione']
};

const CATEGORY_ORDER = ['identity', 'credentials', 'transport', 'reputation'];

/** Le schede delle regole, raggruppate per categoria, generate dai dati. */
function rulesSection() {
  const byCategory = new Map(CATEGORY_ORDER.map((c) => [c, []]));
  const suppressions = [];

  for (const rule of RULES) {
    if (rule.kind === 'suppress') suppressions.push(rule);
    else byCategory.get(rule.category)?.push(rule);
  }

  const sample = (rule) => {
    // Un messaggio d'esempio, reso con parametri fittizi, così che il lettore
    // veda cosa gli direbbe l'estensione.
    const render = RULE_MESSAGES[rule.id];
    if (!render) return '';
    try {
      return render({
        brand: 'paypal', name: 'PayPal', threat: 'SOCIAL_ENGINEERING',
        labels: ['pаypal'], shown: 'pаypal.com', real: 'evil.xyz',
        ip: '185.220.101.5', suffix: 'pages.dev', tld: '.xyz', depth: 5,
        count: 1, fields: ['codice OTP'], words: ['login'],
        hosts: ['raccolta-dati.xyz'], port: '8443', scheme: 'data:'
      });
    } catch { return ''; }
  };

  const card = (rule) => {
    const [cls, label] = KIND_STYLE[rule.kind];
    return `        <div class="border border-slate-800 rounded-xl p-3 bg-slate-950/40">
          <div class="flex items-start justify-between gap-2 mb-1.5">
            <code class="text-[11px] font-mono text-indigo-300">${esc(rule.id)}</code>
            <span class="text-[10px] px-1.5 py-0.5 rounded border ${cls} shrink-0">${label}</span>
          </div>
          <p class="text-[11px] text-slate-400 leading-relaxed">${esc(sample(rule))}</p>
        </div>`;
  };

  const groups = CATEGORY_ORDER.map((category) => {
    const rules = byCategory.get(category);
    if (!rules.length) return '';
    return `      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div class="mb-3">
          <h3 class="text-sm font-bold text-white">${esc(CATEGORY_LABELS[category])}</h3>
          <p class="text-[11px] text-slate-500 italic">${esc(CATEGORY_QUESTIONS[category])}</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
${rules.map(card).join('\n')}
        </div>
      </div>`;
  }).filter(Boolean).join('\n');

  return `${groups}
      <div class="bg-slate-900 border border-emerald-800/40 rounded-2xl p-4">
        <div class="mb-3">
          <h3 class="text-sm font-bold text-white">Esenzioni</h3>
          <p class="text-[11px] text-slate-500 italic">Valutate per prime: nessun punteggio sopravvive a un'esenzione.</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
${suppressions.map(card).join('\n')}
        </div>
      </div>`;
}

function rankLegend() {
  const tone = {
    1: 'border-emerald-500/25', 2: 'border-emerald-500/25', 3: 'border-amber-500/25',
    4: 'border-orange-500/30', 5: 'border-rose-500/40'
  };
  const dot = {
    1: 'bg-emerald-400', 2: 'bg-emerald-400', 3: 'bg-amber-400',
    4: 'bg-orange-500', 5: 'bg-rose-500'
  };
  const text = {
    1: 'text-emerald-400', 2: 'text-emerald-400', 3: 'text-amber-400',
    4: 'text-orange-400', 5: 'text-rose-400'
  };
  return [1, 2, 3, 4, 5].map((r) => `        <div class="p-3 rounded-xl bg-slate-900 border ${tone[r]} ${r === 5 ? 'col-span-2 sm:col-span-1' : ''}">
          <div class="flex items-center gap-1.5 mb-1">
            <span class="w-2 h-2 rounded-full ${dot[r]}"></span>
            <span class="text-xs font-bold ${text[r]}">${r}</span>
            <span class="text-[11px] font-semibold text-slate-200">${esc(RANK_LABELS[r])}</span>
          </div>
          <div class="text-[10px] text-slate-500 leading-snug">${esc(RANK_SUBTITLES[r])}</div>
        </div>`).join('\n');
}

const brandCount = BRANDS.length;
const domainCount = BRANDS.reduce((n, b) => n + b.legit.length, 0);

const page = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NonAbbocco — Difesa anti-phishing con ranking 1-5</title>
  <meta name="description" content="Estensione Chrome e Firefox open source che analizza URL e DOM, calcola un ranking di rischio da 1 a 5 e sostituisce le pagine di phishing con un interstiziale non manomettibile.">
  <!-- GENERATO da tools/build-page.mjs — non modificare a mano.
       Rigenera con: node tools/build-page.mjs -->
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    code, pre { font-family: 'JetBrains Mono', monospace; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #090d16; }
    ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 9999px; }
    ::-webkit-scrollbar-thumb:hover { background: #334155; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col antialiased selection:bg-rose-500 selection:text-white">

  <header class="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
      <a href="#top" class="flex items-center space-x-3 shrink-0">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-rose-600/25 text-xl">🎣</div>
        <div>
          <div class="flex items-center space-x-2">
            <h1 class="font-bold text-base sm:text-lg text-white">NonAbbocco</h1>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono font-medium">MV3</span>
          </div>
          <p class="text-xs text-slate-400 hidden sm:block">Difesa anti-phishing con ranking di rischio 1-5</p>
        </div>
      </a>
      <nav class="flex items-center gap-1 sm:gap-2 text-xs font-semibold">
        <a href="#simulatore" class="px-3 py-1.5 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-all">Simulatore</a>
        <a href="#regole" class="px-3 py-1.5 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-all hidden sm:block">Regole</a>
        <a href="#installazione" class="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/20 transition-all">Installa</a>
      </nav>
    </div>
  </header>

  <main id="top" class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex-1 flex flex-col gap-10 sm:gap-14 w-full">

    <section class="flex flex-col items-center text-center gap-5 pt-2 sm:pt-6">
      <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-semibold text-slate-300">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
        Analisi locale · nessuna telemetria · open source
      </span>
      <h2 class="text-3xl sm:text-5xl font-extrabold tracking-tight text-white max-w-3xl leading-tight">
        Non abboccare<br class="hidden sm:block"> all'esca del phishing.
      </h2>
      <p class="text-sm sm:text-base text-slate-400 max-w-2xl leading-relaxed">
        NonAbbocco analizza l'indirizzo e il contenuto di ogni pagina, assegna un
        <strong class="text-slate-200 font-semibold">ranking di rischio da 1 a 5</strong> e interviene prima che tu inserisca le credenziali.
      </p>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full max-w-3xl text-left mt-1">
        <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-lg font-bold text-white">${RULES.length}</div><div class="text-[11px] text-slate-400">regole di rilevamento</div></div>
        <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-lg font-bold text-white">${brandCount}</div><div class="text-[11px] text-slate-400">marchi protetti</div></div>
        <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-lg font-bold text-white">${domainCount}</div><div class="text-[11px] text-slate-400">domini legittimi noti</div></div>
        <div class="p-3 rounded-xl bg-slate-900 border border-slate-800"><div class="text-lg font-bold text-white">~15&thinsp;µs</div><div class="text-[11px] text-slate-400">per controllo</div></div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 w-full max-w-4xl mt-2 text-left">
${rankLegend()}
      </div>
    </section>

    <section id="simulatore" class="flex flex-col gap-4 scroll-mt-20">
      <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h2 class="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><span class="text-lg">🧪</span> Simulatore interattivo</h2>
          <p class="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Costruisci una pagina fittizia e guarda come reagisce il motore. I verdetti che vedi sono prodotti dallo
            <strong class="text-slate-200">stesso codice</strong> che gira nell'estensione: la pagina importa <code class="text-indigo-300">src/scoring.js</code>.
          </p>
        </div>
        <span class="text-[10px] font-mono text-slate-500 border border-slate-800 bg-slate-900 rounded-lg px-2.5 py-1 self-start sm:self-auto shrink-0">nessuna navigazione reale</span>
      </div>

      <div id="engine-warning" class="hidden bg-amber-950/30 border border-amber-600/40 rounded-2xl p-4 text-xs text-amber-200/90 leading-relaxed">
        <strong class="text-amber-300">Il motore non si è caricato.</strong>
        Questa pagina importa <code class="font-mono">src/scoring.js</code> come modulo ES, e i moduli non si caricano
        con il protocollo <code class="font-mono">file://</code>. Servi la cartella del progetto — per esempio con
        <code class="font-mono bg-slate-950 px-1 py-0.5 rounded">npx serve</code> — e riapri la pagina da
        <code class="font-mono">http://localhost</code>.
      </div>

${simulatorUi}
    </section>

    <section id="regole" class="flex flex-col gap-4 scroll-mt-20">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><span class="text-lg">⚙️</span> Le regole, e come diventano un rank</h2>
        <p class="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl leading-relaxed">
          Ogni regola alimenta una delle quattro categorie. Ogni categoria produce un livello di evidenza da 0 a 3
          <em>saturato</em>, e il rank nasce da una tabella sulla combinazione dei livelli — non da una somma di punti.
          Questo elenco è generato da <code class="text-indigo-300">src/rules.js</code>, quindi non può divergere dal motore.
        </p>
      </div>

      <div class="bg-slate-900 border border-indigo-500/25 rounded-2xl p-4">
        <h3 class="text-xs font-bold text-indigo-300 uppercase tracking-wider mb-3">Dalla combinazione al rank</h3>
        <div class="font-mono text-[11px] sm:text-xs text-slate-300 space-y-1.5 overflow-x-auto">
          <div><span class="text-rose-400">rank 5</span> ⟸ veto — solo un riscontro di Safe Browsing</div>
          <div><span class="text-orange-400">rank 4</span> ⟸ identità ≥ 2 <span class="text-indigo-400">E</span> credenziali ≥ 1</div>
          <div><span class="text-amber-400">rank 3</span> ⟸ identità ≥ 2 <span class="text-indigo-400">O</span> (identità ≥ 1 <span class="text-indigo-400">E</span> credenziali ≥ 1) <span class="text-indigo-400">O</span> (trasporto ≥ 2 <span class="text-indigo-400">E</span> credenziali ≥ 1)</div>
          <div><span class="text-emerald-400">rank 2</span> ⟸ identità ≥ 1 <span class="text-indigo-400">O</span> trasporto ≥ 1 <span class="text-indigo-400">O</span> reputazione ≥ 1</div>
          <div><span class="text-emerald-400">rank 1</span> ⟸ nessuna evidenza</div>
        </div>
        <p class="text-[11px] text-slate-400 leading-relaxed mt-3 pt-3 border-t border-slate-800">
          Nota che <strong class="text-slate-200">le credenziali non compaiono mai da sole</strong>: una pagina che chiede
          una password non è per questo sospetta — è la cosa più normale del web. Contano solo in congiunzione con un
          problema di identità o di trasporto. È questa scelta che ha eliminato i falsi positivi su
          <code class="text-emerald-300">posteitaliane.it</code> e <code class="text-emerald-300">login.microsoftonline.com</code>.
        </p>
      </div>

${rulesSection()}

      <div class="bg-amber-950/20 border border-amber-600/30 rounded-2xl p-4 flex gap-3">
        <span class="text-base leading-none shrink-0">⚠️</span>
        <div class="text-xs text-amber-200/80 leading-relaxed space-y-2">
          <p><strong class="text-amber-300 font-semibold">Limiti, dichiarati invece che nascosti.</strong>
          Il rank 1 significa <em>«nessun segnale noto»</em>, non «sito sicuro»: il motore è euristico, e un kit di
          phishing ospitato su un dominio pulito con certificato valido può non attivare alcuna regola.</p>
          <p>La lista dei marchi è il collo di bottiglia e non scala: nessuna lista curata a mano coprirà i marchi non
          previsti. Per questo un marchio riconosciuto da solo non produce un rank alto — serve la congiunzione — e per
          questo la copertura ampia è compito di Safe Browsing, che è una lista che non manteniamo noi.</p>
          <p>Usa NonAbbocco come rete di sicurezza aggiuntiva, mai come unica difesa.</p>
        </div>
      </div>
    </section>

    <section id="installazione" class="flex flex-col gap-4 scroll-mt-20">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><span class="text-lg">📦</span> Installazione</h2>
        <p class="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
          L'estensione non è ancora pubblicata sugli store: si carica in modalità sviluppatore dai file del repository.
        </p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h3 class="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-indigo-400"></span> Chrome / Edge / Brave</h3>
          <ol class="text-xs text-slate-400 space-y-2 list-decimal list-inside leading-relaxed marker:text-slate-600">
            <li>Clona il repository in una cartella locale.</li>
            <li>Apri <code class="text-amber-300 font-mono bg-slate-950 px-1 py-0.5 rounded">chrome://extensions</code>.</li>
            <li>Attiva in alto a destra la <strong class="text-slate-200">Modalità sviluppatore</strong>.</li>
            <li>Clicca <strong class="text-slate-200">Carica estensione non pacchettizzata</strong> e seleziona la cartella.</li>
            <li>Regola la soglia di blocco dalle <strong class="text-slate-200">Opzioni</strong>.</li>
          </ol>
        </div>
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h3 class="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-amber-400"></span> Firefox</h3>
          <ol class="text-xs text-slate-400 space-y-2 list-decimal list-inside leading-relaxed marker:text-slate-600">
            <li>Apri <code class="text-amber-300 font-mono bg-slate-950 px-1 py-0.5 rounded">about:debugging#/runtime/this-firefox</code>.</li>
            <li>Clicca <strong class="text-slate-200">Carica componente aggiuntivo temporaneo</strong>.</li>
            <li>Seleziona <code class="text-amber-300 font-mono bg-slate-950 px-1 py-0.5 rounded">manifest.json</code>.</li>
          </ol>
          <p class="text-[11px] text-amber-200/70 leading-relaxed mt-3 border-t border-slate-800 pt-2.5">
            Il caricamento temporaneo si azzera alla chiusura del browser.
          </p>
        </div>
      </div>
    </section>

  </main>

  <footer class="border-t border-slate-800/80 bg-slate-900/40 mt-6">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-500">
      <div class="flex items-center gap-2">
        <span class="text-sm">🎣</span>
        <span>NonAbbocco — progetto open source, licenza MIT. Analisi locale, nessun dato inviato a server esterni.</span>
      </div>
      <span class="font-mono">Manifest V3 · Chrome &amp; Firefox</span>
    </div>
  </footer>

  <script type="module">
    import { evaluateUrlAndPage, CATEGORIES } from './src/scoring.js';
    import { RANK_LABELS, RANK_SUBTITLES, CATEGORY_LABELS } from './src/messages.it.js';

    window.__NONABBOCCO_ENGINE_READY__ = true;

    let bypassed = false;

    const SCENARIOS = {
      legit: { url: 'https://www.paypal.com/it/signin', title: 'Accedi al tuo conto PayPal', action: 'https://www.paypal.com/signin/submit', hasPwd: true, urgency: false },
      typo: { url: 'https://paypal-secure.xyz/it/login', title: 'Accedi a PayPal - Verifica Sicurezza Obbligatoria', action: '', hasPwd: true, urgency: true },
      cross: { url: 'https://poste-servizi-online.net/login', title: 'Poste Italiane - Portale Servizi', action: 'http://data-collection-phish.xyz/post.php', hasPwd: true, urgency: true },
      ip: { url: 'http://185.220.101.5/banca/accedi.htm', title: 'Accesso Riservato Intesa Sanpaolo', action: 'http://185.220.101.5/banca/api/credentials', hasPwd: true, urgency: true }
    };

    const $ = (id) => document.getElementById(id);

    window.applyPreset = (key) => {
      const p = SCENARIOS[key];
      if (!p) return;
      bypassed = false;
      $('sim-bypass-alert').classList.add('hidden');
      $('sim-url').value = p.url;
      $('sim-title').value = p.title;
      $('sim-action').value = p.action;
      $('sim-pwd').checked = p.hasPwd;
      $('sim-urgency').checked = p.urgency;
      runSimulation();
    };

    window.triggerBypass = () => {
      bypassed = true;
      $('sim-block-overlay').classList.add('hidden');
      $('sim-bypass-alert').classList.remove('hidden');
    };

    window.cancelBypass = () => {
      bypassed = false;
      $('sim-bypass-alert').classList.add('hidden');
      runSimulation();
    };

    window.forceInspectBlock = () => $('sim-block-overlay').classList.remove('hidden');

    function runSimulation() {
      const url = $('sim-url').value.trim();
      const title = $('sim-title').value.trim();
      const action = $('sim-action').value.trim();
      const hasPassword = $('sim-pwd').checked;
      const urgency = $('sim-urgency').checked;
      const threshold = Number.parseInt($('sim-threshold').value, 10) || 5;

      $('mock-url-text').textContent = url;
      $('sim-card-title').textContent = title;
      $('sim-card-action').textContent = action || '(nessuna action: invio via fetch)';

      const urgent = $('sim-card-urgent');
      urgent.textContent = 'Attenzione: verifica necessaria entro 24 ore.';
      urgent.classList.toggle('hidden', !urgency);

      // Il motore vero, con gli stessi argomenti che usa l'estensione.
      const v = evaluateUrlAndPage(url, {
        hasPassword,
        formAction: action || null,
        title,
        visibleText: urgency ? 'Verifica necessaria entro 24 ore o il conto sarà sospeso' : ''
      });

      const bars = $('sim-meter-bars');
      bars.innerHTML = '';
      for (let i = 1; i <= 5; i++) {
        const b = document.createElement('span');
        const on = i <= v.rank;
        const colour = v.rank === 5 ? 'bg-rose-500' : v.rank === 4 ? 'bg-orange-500' : v.rank === 3 ? 'bg-amber-400' : 'bg-emerald-400';
        b.className = 'w-2 h-3 rounded-sm transition-all ' + (on ? colour : 'bg-slate-800');
        bars.appendChild(b);
      }

      const badge = $('sim-badge');
      badge.textContent = v.rank + '/5';
      badge.className = 'px-1.5 py-0.5 rounded font-bold text-[10px] border ' + (
        v.rank >= 4 ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
        : v.rank === 3 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40');

      $('overlay-badge-rank').textContent = 'NONABBOCCO: ' + RANK_LABELS[v.rank].toUpperCase() + ' (' + v.rank + '/5)';
      $('overlay-subtitle').textContent = RANK_SUBTITLES[v.rank];

      // I livelli per categoria: è questo che rende il verdetto spiegabile,
      // al posto di un punteggio su 100 che non diceva nulla.
      const levels = $('overlay-levels');
      levels.innerHTML = '';
      for (const c of CATEGORIES) {
        const level = v.categories[c];
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-2';
        const suppressed = v.suppressed.includes(c);
        row.innerHTML = '<span class="text-[10px] ' + (suppressed ? 'text-emerald-400/70 line-through' : 'text-slate-400') + '">'
          + CATEGORY_LABELS[c] + '</span><span class="flex gap-0.5">'
          + [1, 2, 3].map((n) => '<span class="w-3 h-1.5 rounded-sm ' + (n <= level ? (level >= 2 ? 'bg-rose-400' : 'bg-amber-400') : 'bg-slate-700') + '"></span>').join('')
          + '</span>';
        levels.appendChild(row);
      }

      const list = $('overlay-list');
      list.innerHTML = '';
      const reasons = v.fired.filter((f) => f.kind !== 'suppress');
      if (!reasons.length) {
        const li = document.createElement('li');
        li.className = 'text-slate-500 list-none';
        li.textContent = 'Nessuna anomalia rilevata.';
        list.appendChild(li);
      }
      for (const f of reasons) {
        const li = document.createElement('li');
        li.textContent = f.message;
        list.appendChild(li);
      }

      const exemptions = v.fired.filter((f) => f.kind === 'suppress');
      const exemptionBox = $('overlay-exemptions');
      exemptionBox.innerHTML = '';
      exemptionBox.classList.toggle('hidden', !exemptions.length);
      for (const f of exemptions) {
        const p = document.createElement('div');
        p.className = 'text-[10px] text-emerald-300/80';
        p.textContent = '✓ ' + f.message;
        exemptionBox.appendChild(p);
      }

      $('diag-rank-desc').textContent = 'Soglia di blocco: livello ' + threshold
        + ' · livelli ' + CATEGORIES.map((c) => c[0] + v.categories[c]).join(' ');

      const overlay = $('sim-block-overlay');
      const pill = $('sim-pill-widget');
      const status = $('diag-status-text');

      if (v.rank >= threshold) {
        pill.classList.add('hidden');
        status.textContent = 'Interstiziale attivo (livello ' + v.rank + ' ≥ soglia ' + threshold + ')';
        status.className = 'font-bold text-rose-400';
        overlay.classList.toggle('hidden', bypassed);
      } else {
        overlay.classList.add('hidden');
        if (v.rank >= 2) {
          pill.classList.remove('hidden');
          $('sim-pill-level').textContent = RANK_LABELS[v.rank] + ' (' + v.rank + '/5)';
          status.textContent = 'Avviso discreto (livello ' + v.rank + ' < soglia ' + threshold + ')';
          status.className = 'font-bold text-amber-400';
        } else {
          pill.classList.add('hidden');
          status.textContent = RANK_LABELS[1] + ' (1/5)';
          status.className = 'font-bold text-emerald-400';
        }
      }
    }

    window.runSimulation = runSimulation;
    document.querySelectorAll('#sim-url, #sim-title, #sim-action').forEach((el) => el.addEventListener('input', runSimulation));
    document.querySelectorAll('#sim-pwd, #sim-urgency, #sim-threshold').forEach((el) => el.addEventListener('change', runSimulation));
    runSimulation();
  </script>
  <script>
    // Se il modulo non si carica — tipicamente perché la pagina è stata aperta
    // con file:// — dillo invece di mostrare un simulatore inerte.
    window.addEventListener('load', () => {
      if (!window.__NONABBOCCO_ENGINE_READY__) {
        document.getElementById('engine-warning').classList.remove('hidden');
      }
    });
  </script>
</body>
</html>
`;

await writeFile(join(root, 'simulator.html'), page, 'utf8');
console.log(`Scritto simulator.html (${(page.length / 1024).toFixed(1)} KB)`);
console.log(`  ${RULES.length} regole, ${brandCount} marchi, ${domainCount} domini legittimi`);
