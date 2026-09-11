/**
 * NonAbbocco — popup della barra degli strumenti (popup.js)
 *
 * Mostra il ranking della scheda attiva. NON lo ricalcola: legge il verdetto
 * che `background.js` ha già prodotto per quella scheda e archiviato in
 * `chrome.storage.session`. È questo che rende impossibile che il numero qui
 * dentro diverga da quello della pillola sulla pagina — è lo stesso numero,
 * non un secondo calcolo che gli somiglia.
 *
 * ─── PERCHÉ NON SERVONO PERMESSI IN PIÙ ──────────────────────────────────────
 *
 * `tabs.query` restituisce `tab.id` senza alcun permesso: sono `url`, `title`
 * e `favIconUrl` a richiederne uno, e di quelli non abbiamo bisogno perché
 * l'indirizzo è già dentro il verdetto archiviato. `storage.session` è coperto
 * dal permesso `storage` che l'estensione dichiara da sempre, ed è leggibile
 * dalle pagine dell'estensione ma non dai content script — cioè non dalla
 * pagina analizzata. Il manifest resta a `"permissions": ["storage"]`.
 *
 * La logica sta in `src/popup-view.js`, che non tocca il DOM ed è quindi
 * coperta da `node --test`. Qui c'è solo la traduzione in elementi HTML,
 * costruiti con `textContent`: i messaggi del motore interpolano il titolo
 * della pagina e gli host dei form, cioè testo che l'attaccante controlla.
 */

import { buildPopupView, MAX_LEVEL } from './src/popup-view.js';

const api = globalThis.browser ?? globalThis.chrome;

const root = document.getElementById('root');

render(buildPopupView(await readActiveTabEntry(), Date.now()));

/**
 * Il verdetto archiviato per la scheda attiva, o null se non ce n'è.
 * @returns {Promise<object|null>}
 */
async function readActiveTabEntry() {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== 'number' || !api.storage.session) return null;
    const key = `verdict_${tab.id}`;
    const items = await api.storage.session.get(key);
    return items?.[key] ?? null;
  } catch {
    return null;
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/** @param {ReturnType<typeof buildPopupView>} view */
function render(view) {
  if (view.state !== 'ok') return renderUnknown(view);

  root.appendChild(verdictHeader(view));
  if (view.address) root.appendChild(section('Indirizzo analizzato', addressCard(view.address)));
  root.appendChild(section('Da dove nasce il rango', categoriesCard(view.categories)));
  root.appendChild(section('Segnali rilevati', signalsCard(view.signals)));
  if (view.suppressions.length) {
    root.appendChild(section('Perché non è stato segnalato', suppressionsCard(view.suppressions)));
  }
  root.appendChild(footer(view));
}

/** @param {{headline: string, detail: string}} view */
function renderUnknown(view) {
  const box = el('div', 'card unknown');
  box.appendChild(el('h1', null, view.headline));
  box.appendChild(el('p', null, view.detail));
  root.appendChild(box);
}

function verdictHeader({ rank, label, subtitle, palette }) {
  const wrap = el('div', 'verdict');

  const badge = el('div', 'rank');
  badge.style.background = palette.bg;
  badge.style.borderColor = palette.border;
  badge.style.color = palette.text;
  badge.appendChild(el('span', 'n', String(rank)));
  badge.appendChild(el('span', 'of', 'SU 5'));

  const text = el('div');
  text.appendChild(el('h1', null, label));
  text.appendChild(el('p', null, subtitle));

  wrap.append(badge, text);
  return wrap;
}

/** L'anatomia dell'indirizzo: il pezzo che dice di chi è il sito, evidenziato. */
function addressCard(address) {
  const card = el('div', 'card address');
  if (address.prefix) card.appendChild(el('span', 'prefix', address.prefix));
  card.appendChild(el('span', 'registrable', address.registrable));
  card.appendChild(el('span', 'note', 'Sottolineato: il dominio registrabile, l’unico pezzo che dice davvero di chi è il sito.'));
  if (address.unicode) {
    card.appendChild(el('span', 'unicode', `Scritto con caratteri non latini: ${address.unicode}`));
  }
  return card;
}

function categoriesCard(categories) {
  const card = el('div', 'card');
  for (const cat of categories) {
    const row = el('div', cat.level > 0 ? 'cat' : 'cat off');

    const txt = el('div', 'txt');
    txt.appendChild(el('div', 'name', cat.label));
    txt.appendChild(el('div', 'q', cat.suppressed ? 'Esclusa: il sito è riconosciuto come legittimo.' : cat.question));

    const ticks = el('div', 'ticks');
    for (let i = 1; i <= MAX_LEVEL; i += 1) {
      const tick = el('span', 'tick');
      if (i <= cat.level) tick.style.background = colorFor(cat.level);
      ticks.appendChild(tick);
    }

    row.append(txt, ticks);
    card.appendChild(row);
  }
  return card;
}

/** Le tacche non usano la palette del rango: dicono quanto è forte la categoria, non quanto è grave la pagina. */
function colorFor(level) {
  return level >= 3 ? '#f43f5e' : level === 2 ? '#f59e0b' : '#10b981';
}

function signalsCard(signals) {
  const card = el('div', 'card');
  if (!signals.length) {
    card.appendChild(el('p', 'empty', 'Nessuna regola è scattata su questa pagina. Non è una garanzia che il sito sia sicuro.'));
    return card;
  }
  card.appendChild(list(signals.map((s) => s.message)));
  return card;
}

function suppressionsCard(suppressions) {
  const card = el('div', 'card');
  card.appendChild(list(suppressions.map((s) => s.message), 'muted'));
  return card;
}

function footer(view) {
  const foot = el('footer');
  foot.appendChild(el('div', null, `Analisi eseguita ${view.age}. Ricarica la pagina per rifarla.`));
  if (view.partial) {
    foot.appendChild(el('div', 'warn',
      'Verdetto basato sul solo indirizzo: il contenuto della pagina non è stato esaminato.'));
  }
  return foot;
}

// ─── Utilità ─────────────────────────────────────────────────────────────────

function section(title, body) {
  const s = document.createElement('section');
  s.appendChild(el('h2', null, title));
  s.appendChild(body);
  return s;
}

function list(items, className) {
  const ul = el('ul', className);
  for (const item of items) ul.appendChild(el('li', null, item));
  return ul;
}

/**
 * @param {string} tag
 * @param {string|null} [className]
 * @param {string} [text]  Sempre via textContent: può venire dalla pagina.
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
