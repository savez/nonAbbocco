/**
 * Dal verdetto al modello di vista del popup.
 *
 * Sta separato da `popup.js` per una ragione sola: qui non si tocca il DOM,
 * quindi `node --test` può coprirlo. `popup.js` resta un traduttore da questo
 * oggetto a elementi HTML, e non prende decisioni proprie.
 *
 * Il popup NON ricalcola nulla. Legge il verdetto che il background ha già
 * prodotto per quella scheda, ed è questo che rende impossibile che il numero
 * nel popup diverga dal numero nella pillola: è lo stesso numero, non due
 * calcoli che si somigliano. Il progetto ha già pagato quella lezione due
 * volte, con le euristiche duplicate in content.js e in simulator.html.
 */

import { CATEGORY_LABELS, CATEGORY_QUESTIONS } from './messages.it.js';
import { rankPresentation } from './ranks.js';

/** Livello massimo di evidenza di una categoria, cioè il numero di tacche. */
export const MAX_LEVEL = 3;

/**
 * L'ordine in cui le categorie vengono mostrate.
 *
 * Preso da `CATEGORY_LABELS` e non importato da `scoring.js` di proposito: il
 * motore tira dentro `psl-data.js`, che sono 192 KB di Public Suffix List, e
 * il popup non ne ha alcun bisogno — non calcola niente, legge un verdetto già
 * pronto. `test/popup-view.test.js` verifica che questo elenco coincida con
 * `CATEGORIES` del motore, così la scorciatoia non può silenziosamente
 * divergere.
 */
export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

/**
 * Spezza l'hostname nelle due parti che contano: il dominio registrabile — che
 * è l'unico pezzo che dice davvero di chi è il sito — e tutto ciò che gli sta
 * davanti, che chiunque può scrivere come vuole. È la distinzione su cui si
 * regge l'intero inganno di `paypal.com.verifica-account.xyz`.
 *
 * @param {string} hostname          Forma ASCII, come la vede il motore.
 * @param {string|null} registrable  Dominio registrabile, o null se ignoto.
 * @param {string} [hostnameUnicode] Forma Unicode, se diversa.
 */
export function splitAddress(hostname, registrable, hostnameUnicode = '') {
  const host = String(hostname || '');
  if (!host) return null;

  const unicode = hostnameUnicode && hostnameUnicode !== host ? hostnameUnicode : null;

  // Senza un suffisso pubblico noto non indoviniamo: mostrare tutto come
  // registrabile è meno sbagliato che evidenziare il pezzo sbagliato.
  if (!registrable || !host.endsWith(registrable)) {
    return { prefix: '', registrable: host, unicode };
  }

  return {
    prefix: host.slice(0, host.length - registrable.length),
    registrable,
    unicode
  };
}

/**
 * Le quattro categorie con il loro livello, sempre tutte e quattro e sempre
 * nello stesso ordine: una categoria a zero è un'informazione, non un vuoto da
 * nascondere.
 *
 * @param {Record<string, number>} categories
 * @param {string[]} suppressed
 */
export function categoryRows(categories = {}, suppressed = []) {
  return CATEGORY_ORDER.map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    question: CATEGORY_QUESTIONS[key],
    level: Math.min(MAX_LEVEL, Math.max(0, Number(categories[key]) || 0)),
    suppressed: suppressed.includes(key)
  }));
}

/**
 * Quanto è vecchia l'analisi, in parole. Il popup mostra una fotografia
 * scattata al caricamento della pagina, non lo stato di adesso: dirlo evita
 * che un verdetto vecchio venga letto come una conferma appena ottenuta.
 *
 * @param {number} at   Millisecondi epoch dell'analisi.
 * @param {number} now  Millisecondi epoch correnti.
 */
export function formatAge(at, now) {
  const ms = now - at;
  if (!Number.isFinite(ms) || ms < 0) return 'al caricamento della pagina';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'pochi istanti fa';
  if (minutes === 1) return 'un minuto fa';
  if (minutes < 60) return `${minutes} minuti fa`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "un'ora fa";
  if (hours < 24) return `${hours} ore fa`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'ieri' : `${days} giorni fa`;
}

/**
 * Il modello di vista completo.
 *
 * @param {object|null} entry  La voce salvata dal background per la scheda,
 *                             oppure null/undefined se non ce n'è nessuna.
 * @param {number} now
 */
export function buildPopupView(entry, now = 0) {
  // Nessuna voce significa una di due cose che il popup non può distinguere,
  // perché senza il permesso `tabs` non conosce l'URL della scheda: o la
  // pagina è stata aperta prima che l'estensione partisse, o è una pagina di
  // sistema dove i content script non girano. Il testo le copre entrambe
  // invece di indovinare.
  if (!entry || !entry.verdict) {
    return {
      state: 'unknown',
      headline: 'Questa pagina non è stata analizzata',
      detail: 'Ricaricala per farla esaminare. Le pagine interne del browser, ' +
              'gli store delle estensioni e il visualizzatore PDF non sono analizzabili.'
    };
  }

  const verdict = entry.verdict;
  const presentation = rankPresentation(verdict.rank);
  const fired = Array.isArray(verdict.fired) ? verdict.fired : [];

  return {
    state: 'ok',
    ...presentation,
    address: splitAddress(entry.hostname, entry.registrableDomain, entry.hostnameUnicode),
    categories: categoryRows(verdict.categories, verdict.suppressed || []),
    // Le soppressioni spiegano perché NON è stato segnalato nulla, ed è
    // un'informazione diversa dai segnali: tenerle separate evita che
    // «il dominio appartiene davvero al marchio» si legga come un'accusa.
    signals: fired.filter((f) => f.kind !== 'suppress')
      .map((f) => ({ id: f.id, kind: f.kind, category: f.category, message: f.message })),
    suppressions: fired.filter((f) => f.kind === 'suppress')
      .map((f) => ({ id: f.id, message: f.message })),
    // Un verdetto di sola fase `url` non ha visto il DOM: dirlo, perché
    // l'assenza di segnali sulle credenziali in quel caso non significa nulla.
    partial: verdict.phase !== 'full',
    // L'utente ha scelto di procedere comunque. Il verdetto resta quello che
    // è — il bypass non lo abbassa — ma senza dirlo il popup mostrerebbe un
    // rango alto e nessun blocco sullo schermo, e sembrerebbe rotto.
    bypassed: entry.bypassed === true,
    age: formatAge(entry.at, now)
  };
}
