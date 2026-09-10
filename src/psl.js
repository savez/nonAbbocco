/**
 * Lookup del suffisso pubblico e del dominio registrabile.
 *
 * Scritto a mano; i dati stanno in `src/psl-data.js`, che è generato.
 *
 * Implementa l'algoritmo della specifica Public Suffix List con UNA
 * deviazione deliberata: quando nessuna regola corrisponde, la specifica dice
 * di trattare il TLD come suffisso pubblico. Noi invece restituiamo
 * `known: false`, perché indovinare "le ultime due label" reintroduce
 * esattamente la classe di falsi positivi che la PSL esiste per eliminare
 * (`amazon.co.uk` → `co.uk`). Le regole sui marchi, davanti a un suffisso
 * ignoto, NON emettono verdetto invece di emetterne uno sbagliato.
 */

import { ICANN, PRIVATE } from './psl-data.js';

const table = (section) => ({
  normal: new Set(section.normal),
  wildcard: new Set(section.wildcard),
  exception: new Set(section.exception)
});

const TABLES = {
  ICANN: table(ICANN),
  PRIVATE: table(PRIVATE)
};

/**
 * Normalizza un hostname: minuscolo, senza punto finale.
 * @param {string} hostname
 * @returns {string}
 */
export function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/\.+$/, '');
}

/**
 * Trova il suffisso pubblico più lungo in una singola sezione.
 * @param {string[]} labels
 * @param {{normal: Set<string>, wildcard: Set<string>, exception: Set<string>}} t
 * @returns {string|null}
 */
function longestSuffix(labels, t) {
  // Le eccezioni hanno priorità su tutto: "!www.ck" vince sul wildcard "*.ck".
  for (let i = 0; i < labels.length; i++) {
    if (t.exception.has(labels.slice(i).join('.'))) {
      return labels.slice(i + 1).join('.') || null;
    }
  }

  let best = null;
  // i che decresce ⇒ candidato che si allunga, quindi l'ultima assegnazione
  // è la corrispondenza più lunga, che è quella prevalente.
  for (let i = labels.length - 1; i >= 0; i--) {
    const candidate = labels.slice(i).join('.');
    if (t.normal.has(candidate)) best = candidate;

    const parent = labels.slice(i + 1).join('.');
    if (parent && t.wildcard.has(parent)) best = candidate;
  }
  return best;
}

/**
 * Informazioni complete sul suffisso di un hostname.
 *
 * @param {string} hostname
 * @returns {{
 *   hostname: string,
 *   labels: string[],
 *   icannSuffix: string|null,
 *   privateSuffix: string|null,
 *   known: boolean
 * }}
 */
export function publicSuffixInfo(hostname) {
  const host = normalizeHostname(hostname);
  const labels = host ? host.split('.') : [];

  if (labels.length < 2) {
    // Hostname a label singola: "localhost", il nome NetBIOS di una macchina
    // in LAN. Non ha un suffisso pubblico e non è un caso di phishing.
    return { hostname: host, labels, icannSuffix: null, privateSuffix: null, known: false };
  }

  const icannSuffix = longestSuffix(labels, TABLES.ICANN);
  const privateSuffix = longestSuffix(labels, TABLES.PRIVATE);

  return {
    hostname: host,
    labels,
    icannSuffix,
    privateSuffix,
    known: Boolean(icannSuffix)
  };
}

/**
 * Il dominio registrabile: il suffisso pubblico più una label.
 *
 * La sezione conta. Con `'ICANN'`, `evil.pages.dev` ha registrabile
 * `pages.dev` — corretto per la domanda "questo è un sottodominio del
 * marchio?". Con `'PRIVATE'` ha registrabile `evil.pages.dev` — corretto per
 * attribuire il phishing ospitato su hosting gratuito, dove ogni sottodominio
 * è di fatto un sito indipendente.
 *
 * @param {string} hostname
 * @param {{section?: 'ICANN'|'PRIVATE'}} [options]
 * @returns {{
 *   domain: string|null,
 *   suffix: string|null,
 *   subdomainLabels: string[],
 *   known: boolean,
 *   isPrivateSuffix: boolean
 * }}
 */
export function registrableDomain(hostname, options = {}) {
  const section = options.section === 'PRIVATE' ? 'PRIVATE' : 'ICANN';
  const info = publicSuffixInfo(hostname);

  const empty = {
    domain: null,
    suffix: null,
    subdomainLabels: [],
    known: false,
    isPrivateSuffix: false
  };

  if (!info.known) return empty;

  let suffix = info.icannSuffix;
  let isPrivateSuffix = false;

  if (section === 'PRIVATE' && info.privateSuffix &&
      info.privateSuffix.split('.').length > info.icannSuffix.split('.').length) {
    suffix = info.privateSuffix;
    isPrivateSuffix = true;
  }

  const suffixLabelCount = suffix.split('.').length;

  // L'hostname coincide col suffisso pubblico: non c'è un dominio
  // registrabile. Succede su "co.uk" o su "pages.dev" nudo.
  if (info.labels.length <= suffixLabelCount) return { ...empty, suffix };

  const domainStart = info.labels.length - suffixLabelCount - 1;

  return {
    domain: info.labels.slice(domainStart).join('.'),
    suffix,
    subdomainLabels: info.labels.slice(0, domainStart),
    known: true,
    isPrivateSuffix
  };
}

/**
 * Vero quando l'hostname sta su hosting condiviso/effimero, cioè quando il
 * suffisso PRIVATE è più profondo di quello ICANN: `random.pages.dev`,
 * `qualcosa.web.app`, `tizio.github.io`. Non è di per sé un segnale di
 * phishing — molti progetti legittimi vivono lì — ma è il terreno su cui il
 * phishing moderno gira con TLS valido e senza un dominio da registrare.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isEphemeralHosting(hostname) {
  const info = publicSuffixInfo(hostname);
  if (!info.known || !info.privateSuffix) return false;
  return info.privateSuffix.split('.').length > info.icannSuffix.split('.').length;
}
