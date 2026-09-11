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

const api = globalThis.browser ?? globalThis.chrome;

/** Soglia di blocco a schermo intero, se l'utente non l'ha mai toccata. */
const DEFAULT_THRESHOLD = 5;

/** @param {number} tabId */
const verdictKey = (tabId) => `verdict_${tabId}`;

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'analyze') return false;

  // Solo il documento principale di una scheda reale. Il content script gira
  // su <all_urls> a document_end, quindi anche dentro ogni iframe: senza
  // questo filtro l'ultimo frame pubblicitario a rispondere sovrascriverebbe
  // il verdetto della scheda, e il popup mostrerebbe il rank di una pubblicità
  // al posto di quello della pagina.
  if (!sender.tab || typeof sender.tab.id !== 'number') return false;
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;

  analyze(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error('[NonAbbocco] analisi fallita:', error);
      sendResponse(null);
    });

  // Obbligatorio: la risposta arriva dopo una lettura di storage.
  return true;
});

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

  const urlSignals = buildUrlSignals(url);
  if (!urlSignals.valid) return null;

  const dom = message.dom && typeof message.dom === 'object' ? message.dom : null;
  const signals = dom
    ? { ...urlSignals, ...normalizeDomSignals(dom, urlSignals) }
    : urlSignals;

  const verdict = evaluate(signals, { phase: dom ? 'full' : 'url' });

  await store(sender.tab.id, {
    url,
    hostname: urlSignals.hostname,
    hostnameUnicode: urlSignals.hostnameUnicode,
    registrableDomain: urlSignals.registrableDomain,
    verdict,
    at: Date.now()
  });

  return {
    verdict,
    blockThreshold: await readThreshold(),
    // La palette arriva da qui così content.js non tiene più colori propri:
    // popup e pillola non possono colorare lo stesso rank in modo diverso.
    presentation: rankPresentation(verdict.rank)
  };
}

/** @returns {Promise<number>} */
async function readThreshold() {
  try {
    const items = await api.storage.sync.get({ blockThreshold: DEFAULT_THRESHOLD });
    const value = Number(items.blockThreshold);
    return Number.isFinite(value) ? value : DEFAULT_THRESHOLD;
  } catch {
    return DEFAULT_THRESHOLD;
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

/** @param {number} tabId */
function forget(tabId) {
  api.storage.session?.remove(verdictKey(tabId)).catch(() => {});
}

// La pulizia è un di più: senza, restano voci di schede chiuse in una memoria
// che si azzera comunque alla chiusura del browser. Registrarla dentro un
// try/catch perché un evento non disponibile non deve impedire il caricamento
// del background, che è la cosa da cui dipende tutto il resto.
try {
  api.tabs.onRemoved.addListener(forget);

  // Una nuova navigazione invalida il verdetto precedente. Senza questo, tra
  // il click su un link e il `document_end` della pagina successiva il popup
  // mostrerebbe con sicurezza il rank della pagina da cui l'utente è appena
  // uscito. `changeInfo.url` non è disponibile senza il permesso `tabs`, ma lo
  // stato `loading` sì ed è tutto ciò che serve.
  api.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') forget(tabId);
  });
} catch (error) {
  console.warn('[NonAbbocco] pulizia dei verdetti non registrata:', error);
}
