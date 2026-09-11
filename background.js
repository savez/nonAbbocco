/**
 * NonAbbocco — background (background.js)
 *
 * L'unico posto in cui gira il motore di scoring dentro l'estensione.
 *
 * ─── PERCHÉ ESISTE QUESTO FILE ───────────────────────────────────────────────
 *
 * `src/scoring.js` è sempre stata la definizione canonica del comportamento,
 * ma nessun percorso runtime la caricava: i content script non possono essere
 * moduli ES su nessuno dei due browser, quindi content.js portava con sé una
 * copia storica delle euristiche — una somma di punti con soglie fisse, cioè
 * esattamente il modello che docs/RANKING.md documenta come rotto. Il risultato
 * era che l'estensione installata e la demo pubblica rispondevano in modo
 * diverso alla stessa pagina: `www.posteitaliane.it` prendeva 3/5 dal motore
 * legacy e 1/5 da quello vero.
 *
 * Qui il motore gira una volta sola, in un contesto che può importare moduli.
 * Il content script raccoglie segnali e disegna; non decide più nulla. È la
 * stessa proprietà che rende sicuro farlo girare su <all_urls>, cioè anche
 * dentro la pagina dell'attaccante.
 *
 * ─── DUE BROWSER, DUE PORTE D'INGRESSO ───────────────────────────────────────
 *
 * Chrome MV3 carica questo file come `background.service_worker` con
 * `"type": "module"`. Firefox non supporta i service worker e non supporta
 * ancora `"type": "module"` su `background.scripts` (bug 1811443), quindi lo
 * carica via `background.page` → `background.html`, dove la modularità sta nel
 * tag `<script type="module">`. `tools/package.mjs` consegna a ciascuno store
 * solo le chiavi che il suo browser capisce.
 *
 * ─── STATO ───────────────────────────────────────────────────────────────────
 *
 * Nessuno in memoria: il service worker di Chrome viene terminato quando è
 * inattivo, e una Map si perderebbe proprio mentre l'utente apre il popup. Il
 * verdetto vive in `chrome.storage.session`, che sopravvive al riavvio del
 * worker, non al riavvio del browser, e — cosa che qui conta — non è leggibile
 * dai content script, quindi nemmeno dalla pagina analizzata.
 */

import { buildUrlSignals, normalizeDomSignals, evaluate } from './src/scoring.js';
import { rankPresentation } from './src/ranks.js';
import { isAllowlisted } from './src/allowlist.js';

const api = globalThis.browser ?? globalThis.chrome;

/** Soglia di blocco a schermo intero, se l'utente non l'ha mai toccata. */
const DEFAULT_THRESHOLD = 5;

/** @param {number} tabId */
const verdictKey = (tabId) => `verdict_${tabId}`;

/**
 * Il bypass è per scheda E per sito, come lo era quando viveva in
 * `sessionStorage`: scavalcare un avviso su un sito non deve scavalcarlo su
 * tutti gli altri aperti nella stessa scheda.
 *
 * @param {number} tabId
 * @param {string} hostname
 */
const bypassKey = (tabId, hostname) => `bypass_${tabId}_${hostname}`;

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || (message.type !== 'analyze' && message.type !== 'bypass')) return false;

  // Solo il documento principale di una scheda reale. Il content script gira
  // su <all_urls> a document_end, quindi anche dentro ogni iframe: senza
  // questo filtro l'ultimo frame pubblicitario a rispondere sovrascriverebbe
  // il verdetto della scheda, e il popup mostrerebbe il rank di una pubblicità
  // al posto di quello della pagina.
  if (!sender.tab || typeof sender.tab.id !== 'number') return false;
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;

  const work = message.type === 'bypass'
    ? grantBypass(message, sender)
    : analyze(message, sender);

  work
    .then(sendResponse)
    .catch((error) => {
      console.error(`[NonAbbocco] ${message.type} fallito:`, error);
      sendResponse(null);
    });

  // Obbligatorio: la risposta arriva dopo una lettura di storage.
  return true;
});

/**
 * Registra la scelta dell'utente di procedere comunque.
 *
 * Il punto di tutto lo spostamento è qui: questa funzione gira nel background,
 * e l'unico modo per raggiungerla è un messaggio che parte dal documento
 * principale di una scheda reale — condizione che il listener ha già
 * verificato sopra, su dati scritti dal browser e non dalla pagina. Prima la
 * concessione stava in `sessionStorage`, dove la pagina se la scriveva da sé.
 *
 * @param {{url?: string}} message
 * @param {chrome.runtime.MessageSender} sender
 */
async function grantBypass(message, sender) {
  const hostname = hostnameOf(sender.url || message.url || '');
  if (!hostname || !api.storage.session) return { bypassed: false };

  await api.storage.session.set({ [bypassKey(sender.tab.id, hostname)]: true });
  return { bypassed: true };
}

/**
 * Calcola il verdetto, lo archivia per il popup e lo restituisce al content
 * script insieme a tutto ciò che gli serve per disegnarlo.
 *
 * @param {{dom?: object, url?: string}} message
 * @param {chrome.runtime.MessageSender} sender
 */
async function analyze(message, sender) {
  // `sender.url` lo scrive il browser e la pagina non può falsificarlo;
  // `message.url` viene da dentro la pagina ed è solo un ripiego per i casi
  // in cui il primo manchi.
  const url = sender.url || message.url || '';

  const settings = await readSettings();

  // L'allowlist entra come CONTESTO, non come scorciatoia che salta la
  // valutazione: il verdetto viene calcolato lo stesso e la regola
  // `user-allowlisted` sopprime le categorie. Così il popup può dire
  // «non segnalato perché lo hai indicato tu» invece di non dire nulla, e il
  // veto di Safe Browsing continua a passare sopra la scelta dell'utente.
  const urlSignals = buildUrlSignals(url, {
    userAllowlisted: isAllowlisted(hostnameOf(url), settings.allowlist)
  });
  if (!urlSignals.valid) return null;

  const dom = message.dom && typeof message.dom === 'object' ? message.dom : null;
  const signals = dom
    ? { ...urlSignals, ...normalizeDomSignals(dom, urlSignals) }
    : urlSignals;

  const verdict = evaluate(signals, { phase: dom ? 'full' : 'url' });
  const bypassed = await isBypassed(sender.tab.id, urlSignals.hostname);

  await store(sender.tab.id, {
    url,
    hostname: urlSignals.hostname,
    hostnameUnicode: urlSignals.hostnameUnicode,
    registrableDomain: urlSignals.registrableDomain,
    verdict,
    bypassed,
    at: Date.now()
  });

  return {
    verdict,
    bypassed,
    blockThreshold: settings.blockThreshold,
    // La palette arriva da qui così content.js non tiene più colori propri:
    // popup e pillola non possono colorare lo stesso rank in modo diverso.
    presentation: rankPresentation(verdict.rank)
  };
}

/**
 * Le impostazioni dell'utente, in una lettura sola.
 * @returns {Promise<{blockThreshold: number, allowlist: string[]}>}
 */
async function readSettings() {
  try {
    const items = await api.storage.sync.get({
      blockThreshold: DEFAULT_THRESHOLD,
      allowlist: []
    });
    const threshold = Number(items.blockThreshold);
    return {
      blockThreshold: Number.isFinite(threshold) ? threshold : DEFAULT_THRESHOLD,
      allowlist: Array.isArray(items.allowlist) ? items.allowlist : []
    };
  } catch {
    // Impostazioni illeggibili: si protegge con i valori di default, non si
    // smette di proteggere.
    return { blockThreshold: DEFAULT_THRESHOLD, allowlist: [] };
  }
}

/** @param {string} url */
function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * @param {number} tabId
 * @param {object} entry
 */
async function store(tabId, entry) {
  if (!api.storage.session) return;
  try {
    await api.storage.session.set({ [verdictKey(tabId)]: entry });
  } catch (error) {
    console.warn('[NonAbbocco] verdetto non archiviato:', error);
  }
}

/**
 * @param {number} tabId
 * @param {string} hostname
 * @returns {Promise<boolean>}
 */
async function isBypassed(tabId, hostname) {
  if (!api.storage.session || !hostname) return false;
  try {
    const key = bypassKey(tabId, hostname);
    const items = await api.storage.session.get(key);
    return items?.[key] === true;
  } catch {
    return false;
  }
}

/** @param {number} tabId */
function forget(tabId) {
  api.storage.session?.remove(verdictKey(tabId)).catch(() => {});
}

/**
 * Alla chiusura della scheda se ne va tutto, bypass compresi. Le chiavi del
 * bypass portano il sito nel nome, quindi vanno cercate per prefisso invece
 * che rimosse per nome.
 *
 * @param {number} tabId
 */
async function forgetTab(tabId) {
  forget(tabId);
  if (!api.storage.session) return;
  try {
    const all = await api.storage.session.get(null);
    // Il trattino basso finale evita che la scheda 7 si porti via la 77.
    const prefix = `bypass_${tabId}_`;
    const keys = Object.keys(all).filter((k) => k.startsWith(prefix));
    if (keys.length) await api.storage.session.remove(keys);
  } catch { /* la sessione sparisce comunque alla chiusura del browser */ }
}

// La pulizia è un di più: senza, restano voci di schede chiuse in una memoria
// che si azzera comunque alla chiusura del browser. Registrarla dentro un
// try/catch perché un evento non disponibile non deve impedire il caricamento
// del background, che è la cosa da cui dipende tutto il resto.
try {
  api.tabs.onRemoved.addListener((tabId) => { forgetTab(tabId); });

  // Una nuova navigazione invalida il verdetto precedente. Senza questo, tra
  // il click su un link e il `document_end` della pagina successiva il popup
  // mostrerebbe con sicurezza il rank della pagina da cui l'utente è appena
  // uscito. `changeInfo.url` non è disponibile senza il permesso `tabs`, ma lo
  // stato `loading` sì ed è tutto ciò che serve.
  //
  // Solo il verdetto, però: il bypass deve sopravvivere alla navigazione,
  // altrimenti l'interstiziale ricomparirebbe al primo link cliccato dentro
  // il sito che l'utente ha appena scelto di scavalcare.
  api.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') forget(tabId);
  });
} catch (error) {
  console.warn('[NonAbbocco] pulizia dei verdetti non registrata:', error);
}
