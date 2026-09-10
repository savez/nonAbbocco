/**
 * NonAbbocco — motore di scoring
 *
 * ESM PURO: nessun accesso a `window`, `document` o `chrome`. Tutto entra
 * come segnali e tutto esce come verdetto, così che questo file sia l'unica
 * definizione del comportamento e sia testabile con `node --test`.
 *
 * Perché è importante che sia l'unica: prima di questa estrazione il motore
 * esisteva in DUE copie divergenti — una in content.js e una incollata dentro
 * simulator.html, con pesi e liste diversi. La demo pubblica mostrava numeri
 * che l'estensione non avrebbe mai prodotto.
 *
 * ATTENZIONE — FASE P2: questo file riproduce il comportamento STORICO di
 * content.js, bug inclusi, di proposito. Serve come rete di sicurezza per il
 * refactoring: i test registrano cosa il motore fa *oggi*. Le correzioni
 * arrivano in P3, e in quel commit le aspettative dei test si ribaltano in
 * modo visibile nel diff.
 */

export const LEGACY_KNOWN_BRANDS = [
  'paypal', 'poste', 'posteitaliane', 'intesasanpaolo', 'unicredit',
  'bnl', 'ingdirect', 'apple', 'google', 'amazon', 'microsoft', 'netflix', 'facebook'
];

export const LEGACY_HIGH_RISK_TLDS = [
  '.xyz', '.top', '.work', '.buzz', '.icu', '.tk', '.ml', '.ga', '.cf', '.gq', '.shop'
];

const LEGACY_ACCESS_WORDS = ['login', 'account', 'verify'];

/**
 * Estrae dai dati di navigazione i segnali che le regole di fase `url`
 * sanno leggere. Puro: prende una stringa, non `location`.
 *
 * @param {string} rawUrl
 * @returns {{hostname: string, protocol: string, pathname: string, valid: boolean}}
 */
export function buildUrlSignals(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return {
      hostname: u.hostname.toLowerCase(),
      protocol: u.protocol,
      pathname: u.pathname,
      valid: true
    };
  } catch {
    return { hostname: '', protocol: '', pathname: '', valid: false };
  }
}

/**
 * Segnali che solo il DOM può fornire. Il content script li raccoglie e li
 * spedisce; questo modulo non tocca mai il documento.
 *
 * @typedef {object} DomSignals
 * @property {number} passwordFieldCount
 * @property {Array<{actionHost: string|null}>} credentialForms
 */

/**
 * Il verdetto storico: punteggio additivo e rank su soglie fisse.
 *
 * @param {{hostname: string, protocol: string, pathname: string}} url
 * @param {DomSignals} dom
 * @returns {{score: number, rank: number, anomalies: string[], fired: string[]}}
 */
export function evaluateLegacy(url, dom = { passwordFieldCount: 0, credentialForms: [] }) {
  const { hostname, protocol } = url;
  let score = 0;
  const anomalies = [];
  const fired = [];

  // 1. URL — IP grezzo.
  // BUG NOTO: non distingue gli indirizzi privati, quindi il router di casa
  // e i dev server su 127.0.0.1 vengono trattati come phishing.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    score += 45;
    fired.push('legacy-ip-host');
    anomalies.push("L'indirizzo web è composto da un IP grezzo anziché da un dominio nominale.");
  }

  // 2. URL — punycode.
  // BUG NOTO: penalizza qualunque IDN legittimo, non solo gli omografi.
  if (hostname.includes('xn--')) {
    score += 40;
    fired.push('legacy-punycode');
    anomalies.push('Presenza di caratteri punycode (possibile attacco omografo fraudolento).');
  }

  // 3. URL — imitazione di marchio.
  // BUG NOTO: `includes` sull'hostname intero e allowlist limitata a .com/.it.
  // Conseguenza: posteitaliane.it, google.co.uk, amazon.de e
  // login.microsoftonline.com sono falsi positivi. La voce 'posteitaliane'
  // dell'array è codice morto, perché 'poste' matcha prima e fa break.
  for (const brand of LEGACY_KNOWN_BRANDS) {
    if (hostname.includes(brand)) {
      const isLegit = hostname === `${brand}.com` || hostname === `${brand}.it` ||
                      hostname.endsWith(`.${brand}.com`) || hostname.endsWith(`.${brand}.it`);
      if (!isLegit) {
        score += 55;
        fired.push('legacy-brand-impersonation');
        anomalies.push(`Imitazione o typosquatting del marchio autentico "${brand.toUpperCase()}".`);
        break;
      }
    }
  }

  // 4. URL — TLD a rischio più parole d'accesso.
  // BUG NOTO: le parole sono cercate SOLO nell'hostname, mai nel path. Da qui
  // l'incoerenza fra login-paypal.xyz (scatta) e paypal-secure.xyz/login (no).
  const matchedTld = LEGACY_HIGH_RISK_TLDS.find(tld => hostname.endsWith(tld));
  if (matchedTld && LEGACY_ACCESS_WORDS.some(w => hostname.includes(w))) {
    score += 30;
    fired.push('legacy-risky-tld');
    anomalies.push(`Dominio con estensione economica a rischio (${matchedTld}) abbinata a parole d'accesso.`);
  }

  // 5. DOM — credenziali su HTTP in chiaro.
  if (dom.passwordFieldCount > 0 && protocol === 'http:') {
    score += 50;
    fired.push('legacy-http-password');
    anomalies.push('Invio credenziali di sicurezza su protocollo HTTP non crittografato.');
  }

  // 6. DOM — form di login che invia a un host esterno.
  // BUG NOTO: dipende da <form action>, che i kit moderni non impostano
  // affatto (esfiltrano via fetch). Inoltre confronta l'hostname esatto,
  // quindi www.example.com e example.com risultano estranei fra loro.
  for (const form of dom.credentialForms) {
    const targetHost = form.actionHost;
    if (!targetHost) continue;
    if (targetHost !== hostname && !targetHost.endsWith('.' + hostname)) {
      score += 65;
      fired.push('legacy-cross-origin-form');
      anomalies.push(`La password viene inviata a un server esterno non appartenente al dominio (${targetHost}).`);
    }
  }

  return { score, rank: rankFromLegacyScore(score), anomalies, fired };
}

/**
 * Le soglie storiche. Nota l'assenza di qualunque saturazione: content.js
 * non applica `Math.min(100, score)` (il simulatore invece sì — un'altra
 * divergenza fra le due copie).
 *
 * @param {number} score
 * @returns {number} rank da 1 a 5
 */
export function rankFromLegacyScore(score) {
  if (score >= 80) return 5;  // Minaccia critica
  if (score >= 60) return 4;  // Rischio elevato
  if (score >= 40) return 3;  // Sospetto moderato
  if (score >= 20) return 2;  // Attenzione minima
  return 1;                   // Nessun segnale rilevato
}

/**
 * Etichetta del rank. Il livello 1 NON dice "sicuro": l'assenza di segnali
 * non è una garanzia, e comunicarla come tale è il difetto che rende un
 * verdetto rassicurante più dannoso di nessun verdetto.
 *
 * @param {number} rank
 * @returns {string}
 */
export function rankLabel(rank) {
  switch (rank) {
    case 5: return 'Minaccia critica (5/5)';
    case 4: return 'Rischio elevato (4/5)';
    case 3: return 'Sospetto moderato (3/5)';
    case 2: return 'Attenzione minima (2/5)';
    default: return 'Nessun segnale noto (1/5)';
  }
}

/**
 * Punto di ingresso comodo per chi ha solo un URL e dei flag: usato dai test
 * e dalla pagina di progetto, che così mostra i numeri veri del motore.
 *
 * @param {string} rawUrl
 * @param {{hasPassword?: boolean, formAction?: string|null}} [page]
 */
export function evaluateUrlAndPage(rawUrl, page = {}) {
  const url = buildUrlSignals(rawUrl);
  const credentialForms = [];
  if (page.formAction) {
    // Fedele al codice storico: solo le action ASSOLUTE http(s) producono un
    // segnale. Le action relative — cioè la maggioranza dei login legittimi —
    // erano semplicemente ignorate.
    let actionHost = null;
    if (/^https?:\/\//.test(page.formAction)) {
      try {
        actionHost = new URL(page.formAction).hostname.toLowerCase();
      } catch { /* non parsabile: nessun segnale, come nel codice storico */ }
    }
    credentialForms.push({ actionHost });
  }
  return evaluateLegacy(url, {
    passwordFieldCount: page.hasPassword ? 1 : 0,
    credentialForms
  });
}
