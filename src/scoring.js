/**
 * NonAbbocco — motore di scoring.
 *
 * ESM PURO: nessun accesso a `window`, `document` o `chrome`. Tutto entra
 * come segnali e tutto esce come verdetto. È l'unica definizione del
 * comportamento del motore, ed è per questo testabile con `node --test`.
 *
 * Non reintrodurre una seconda copia di queste euristiche. Il progetto ne ha
 * già sofferto: esistevano due versioni divergenti dello scoring, una in
 * content.js e una incollata dentro simulator.html, con pesi diversi, e la
 * demo pubblica mostrava numeri che l'estensione non avrebbe mai prodotto.
 *
 * ─── PERCHÉ NON UNA SOMMA DI PUNTI ───────────────────────────────────────────
 *
 * Il modello precedente sommava punti e confrontava il totale con soglie
 * fisse. Produceva verdetti indistinguibili per situazioni opposte:
 *
 *     paypal-secure.xyz/login   →  55 punti  →  rank 3
 *     www.posteitaliane.it      →  55 punti  →  rank 3
 *
 * Un attacco da manuale e il sito vero di Poste ricevevano la stessa
 * risposta. La causa non erano i pesi — ritoccarli avrebbe prodotto una nuova
 * generazione di incoerenze — ma il fatto di SOMMARE FRA CATEGORIE
 * INCOMMENSURABILI: 55 significava la stessa cosa qualunque regola l'avesse
 * generato.
 *
 * Qui ogni regola alimenta una delle quattro categorie, ogni categoria
 * produce un livello di evidenza 0-3 saturato, e il rank è una LOOKUP sulla
 * tupla dei livelli. Due conseguenze volute:
 *
 *   - dieci segnali deboli non superano una prova forte (saturazione);
 *   - "la pagina chiede una password" da sola non alza mai il rank, perché
 *     una pagina di login è la cosa più normale del web. Conta solo in
 *     congiunzione con un problema di identità o di trasporto.
 */

import { RULES } from './rules.js';
import { RULE_MESSAGES, RANK_LABELS, RANK_SUBTITLES } from './messages.it.js';
import { registrableDomain, publicSuffixInfo, isEphemeralHosting, normalizeHostname } from './psl.js';
import { toUnicode, skeleton, isMixedScriptLabel } from './idn.js';

/**
 * @typedef {'identity'|'credentials'|'transport'|'reputation'} Category
 * @typedef {'veto'|'strong'|'weak'|'suppress'} RuleKind
 *
 * @typedef {object} Rule
 * @property {string} id
 * @property {RuleKind} kind
 * @property {'url'|'dom'|'either'} phase
 * @property {Category} [category]
 * @property {Category[]} [suppresses]
 * @property {(signals: any) => object|null} test
 *
 * @typedef {object} Verdict
 * @property {number} rank
 * @property {Record<Category, number>} categories
 * @property {Array<{id: string, kind: RuleKind, category: Category|null, params: object, message: string}>} fired
 * @property {Category[]} suppressed
 * @property {string|null} veto
 * @property {'url'|'full'} phase
 */

export const CATEGORIES = ['identity', 'credentials', 'transport', 'reputation'];

const MAX_LEVEL = 3;
const CONTRIBUTION = { strong: 2, weak: 1 };

const HIGH_RISK_TLDS = new Set([
  'xyz', 'top', 'work', 'buzz', 'icu', 'tk', 'ml', 'ga', 'cf', 'gq',
  'shop', 'click', 'link', 'rest', 'fit', 'surf', 'monster', 'quest', 'cyou', 'sbs'
]);

const SENSITIVE_FIELD_PATTERNS = [
  [/\b(otp|codice[-_]?otp|one[-_]?time)\b/i, 'codice OTP'],
  [/\b(cvv|cvc|cid|security[-_]?code)\b/i, 'CVV della carta'],
  [/\b(pin)\b/i, 'PIN'],
  [/\b(iban)\b/i, 'IBAN'],
  [/\b(codice[-_]?fiscale|cod[-_]?fisc|taxcode)\b/i, 'codice fiscale'],
  [/\b(card[-_]?number|numero[-_]?carta|pan)\b/i, 'numero di carta'],
  [/\b(seed|mnemonic|recovery[-_]?phrase|private[-_]?key)\b/i, 'chiave o seed phrase']
];

const URGENCY_PATTERNS = [
  /entro\s+\d+\s+(ore|giorni|minuti)/i,
  /\b(urgente|immediat|sospes|bloccat|scadut|ultimo avviso|verifica obbligatoria)/i,
  /\b(account will be|suspended|immediately|final notice|expires? (today|soon))\b/i
];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Vero per gli indirizzi non raggiungibili da un attaccante remoto: loopback,
 * RFC1918, link-local, CGNAT e i loro equivalenti IPv6.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isPrivateAddress(hostname) {
  const host = normalizeHostname(hostname).replace(/^\[|\]$/g, '');

  if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }

  const m = IPV4.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;

  return a === 10 ||
         a === 127 ||
         a === 0 ||
         (a === 192 && b === 168) ||
         (a === 172 && b >= 16 && b <= 31) ||
         (a === 169 && b === 254) ||
         (a === 100 && b >= 64 && b <= 127);
}

/**
 * Spezza una stringa nei token che le regole confrontano con i marchi.
 *
 * È la differenza fra il matching storico e quello attuale: la ricerca per
 * SOTTOSTRINGA marcava `timbrature.it` come imitazione di TIM, mentre la
 * ricerca per TOKEN no, perché "timbrature" non è "tim". È questo che rende
 * sicuro tenere in lista marchi con nomi brevi.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9À-ɏͰ-ӿ]+/)
    .filter(Boolean);
}

/**
 * Costruisce i segnali osservabili dal solo URL. È ciò che il service worker
 * ha a disposizione prima che la pagina esista.
 *
 * @param {string} rawUrl
 * @param {{userAllowlisted?: boolean, safeBrowsingThreat?: string|null}} [context]
 */
export function buildUrlSignals(rawUrl, context = {}) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { valid: false, urlTokens: [], domainTokens: [], subdomainTokens: [], skeletonTokens: [], mixedScriptLabels: [] };
  }

  const hostname = normalizeHostname(u.hostname);
  const isIp = IPV4.test(hostname) || hostname.includes(':') || /^\[.*\]$/.test(u.hostname);
  const isOpaqueScheme = u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'javascript:';

  const reg = registrableDomain(hostname, { section: 'ICANN' });
  const suffixInfo = publicSuffixInfo(hostname);
  const hostnameUnicode = toUnicode(hostname);

  // Il nome del dominio senza il suffisso: per `paypal-secure.xyz` è
  // `paypal-secure`, che tokenizzato dà ['paypal','secure'].
  const domainName = reg.domain && reg.suffix
    ? reg.domain.slice(0, reg.domain.length - reg.suffix.length - 1)
    : '';

  const unicodeLabels = hostnameUnicode.split('.');
  const mixedScriptLabels = unicodeLabels.filter((l) => isMixedScriptLabel(l));

  const port = u.port || '';
  const defaultPort = (u.protocol === 'https:' && (port === '' || port === '443')) ||
                      (u.protocol === 'http:' && (port === '' || port === '80'));

  return {
    valid: true,
    raw: rawUrl,
    protocol: u.protocol,
    hostname,
    hostnameUnicode,
    port,
    hasNonStandardPort: Boolean(port) && !defaultPort,
    pathname: u.pathname,
    search: u.search,

    hasUserinfo: Boolean(u.username || u.password),
    userinfo: u.username || '',

    isIp,
    isPrivateIp: isIp && isPrivateAddress(hostname),
    isSingleLabelHost: !isIp && hostname.length > 0 && !hostname.includes('.'),
    isLocalTld: hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost'),
    isOpaqueScheme,

    registrableDomain: reg.domain,
    publicSuffix: suffixInfo.privateSuffix && isEphemeralHosting(hostname)
      ? suffixInfo.privateSuffix
      : reg.suffix,
    suffixKnown: reg.known,
    isEphemeralHosting: isEphemeralHosting(hostname),
    tld: hostname.includes('.') ? hostname.slice(hostname.lastIndexOf('.') + 1) : '',
    isHighRiskTld: HIGH_RISK_TLDS.has(hostname.slice(hostname.lastIndexOf('.') + 1)),

    // Token per il confronto con i marchi. Il sottodominio è tenuto separato
    // dal dominio perché "il marchio nel sottodominio di un dominio altrui" è
    // un segnale diverso, e più forte, di "il marchio nel dominio".
    domainTokens: tokenize(domainName),
    subdomainTokens: reg.subdomainLabels.flatMap((l) => tokenize(l)),
    urlTokens: tokenize(`${hostnameUnicode} ${u.pathname} ${u.search}`),
    skeletonTokens: tokenize(skeleton(toUnicode(domainName || hostname))),
    mixedScriptLabels,

    userAllowlisted: Boolean(context.userAllowlisted),
    safeBrowsingThreat: context.safeBrowsingThreat || null
  };
}

/**
 * Normalizza i segnali che il content script raccoglie dal DOM.
 * Il content script NON valuta regole: raccoglie e spedisce.
 *
 * @param {object} raw
 * @param {object} urlSignals
 */
export function normalizeDomSignals(raw = {}, urlSignals = {}) {
  const names = Array.isArray(raw.fieldNames) ? raw.fieldNames.join(' ') : '';
  const sensitiveFieldNames = SENSITIVE_FIELD_PATTERNS
    .filter(([re]) => re.test(names))
    .map(([, label]) => label);

  const credentialForms = (raw.credentialForms || []).map((f) => {
    const actionHost = f.actionHost ? normalizeHostname(f.actionHost) : null;
    return {
      actionHost,
      actionRegistrableDomain: actionHost ? registrableDomain(actionHost).domain : null
    };
  });

  const text = raw.visibleText || '';

  return {
    passwordFieldCount: Number(raw.passwordFieldCount) || 0,
    sensitiveFieldNames,
    credentialForms,
    title: raw.title || '',
    titleTokens: tokenize(`${raw.title || ''} ${raw.ogSiteName || ''}`),
    hasUrgencyText: URGENCY_PATTERNS.some((re) => re.test(text)),
    registrableDomain: urlSignals.registrableDomain ?? null
  };
}

/**
 * Applica le regole e calcola il verdetto.
 *
 * @param {object} signals
 * @param {{phase?: 'url'|'full', rules?: Rule[]}} [options]
 * @returns {Verdict}
 */
export function evaluate(signals, options = {}) {
  const phase = options.phase === 'full' ? 'full' : 'url';
  const rules = options.rules || RULES;

  const applicable = rules.filter((r) =>
    r.phase === 'either' || r.phase === 'url' || (phase === 'full' && r.phase === 'dom'));

  const fired = [];
  const suppressed = new Set();
  let veto = null;

  // 1. Soppressioni per prime: nessun punteggio sopravvive a un'esenzione.
  for (const rule of applicable) {
    if (rule.kind !== 'suppress') continue;
    const params = rule.test(signals);
    if (!params) continue;
    for (const category of rule.suppresses) suppressed.add(category);
    fired.push(describe(rule, params));
  }

  // 2. Veto: porta direttamente al massimo, senza passare dai livelli.
  for (const rule of applicable) {
    if (rule.kind !== 'veto') continue;
    const params = rule.test(signals);
    if (!params) continue;
    veto = rule.id;
    fired.push(describe(rule, params));
  }

  // 3. Accumulatori, tenendo strong e weak separati per poter applicare la
  //    regola che le sole regole debole non superano il livello 1.
  const strongCount = zeroed();
  const weakCount = zeroed();

  for (const rule of applicable) {
    if (rule.kind !== 'strong' && rule.kind !== 'weak') continue;
    if (suppressed.has(rule.category)) continue;
    const params = rule.test(signals);
    if (!params) continue;
    (rule.kind === 'strong' ? strongCount : weakCount)[rule.category] += 1;
    fired.push(describe(rule, params));
  }

  const categories = zeroed();
  for (const category of CATEGORIES) {
    if (suppressed.has(category)) continue;
    const raw = strongCount[category] * CONTRIBUTION.strong + weakCount[category] * CONTRIBUTION.weak;
    // Senza alcuna evidenza forte il livello si ferma a 1: tre indizi deboli
    // non valgono una prova.
    const ceiling = strongCount[category] > 0 ? MAX_LEVEL : Math.min(1, raw);
    categories[category] = Math.min(raw, ceiling, MAX_LEVEL);
  }

  if (veto) categories.reputation = MAX_LEVEL;

  return {
    rank: rankFromCategories(categories, veto),
    categories,
    fired,
    suppressed: [...suppressed],
    veto,
    phase
  };
}

const zeroed = () => ({ identity: 0, credentials: 0, transport: 0, reputation: 0 });

function describe(rule, params) {
  const render = RULE_MESSAGES[rule.id];
  return {
    id: rule.id,
    kind: rule.kind,
    category: rule.category ?? null,
    params,
    message: render ? render(params) : rule.id
  };
}

/**
 * La tabella di lookup: dalla tupla dei livelli al rank.
 *
 * Documentata per intero in docs/RANKING.md, e questa è l'unica
 * implementazione. Nota che `credentials` non compare mai da sola: una pagina
 * che chiede una password non è per questo sospetta, quindi non può alzare il
 * rank in assenza di un problema di identità o di trasporto.
 *
 * @param {Record<Category, number>} c
 * @param {string|null} veto
 * @returns {number}
 */
export function rankFromCategories(c, veto = null) {
  if (veto) return 5;

  if (c.identity >= 2 && c.credentials >= 1) return 4;

  if (c.identity >= 2) return 3;
  if (c.identity >= 1 && c.credentials >= 1) return 3;
  if (c.transport >= 2 && c.credentials >= 1) return 3;

  if (c.identity >= 1 || c.transport >= 1 || c.reputation >= 1) return 2;

  return 1;
}

/**
 * Fonde il verdetto da solo URL con quello completo dopo il caricamento.
 *
 * MONOTONO PER SCELTA: il rank può salire, mai scendere. De-escalare
 * significherebbe ritirare un interstiziale già mostrato all'utente, che è
 * sia confuso sia sfruttabile — basterebbe a un attaccante iniettare nel DOM
 * qualcosa che abbassi il verdetto.
 *
 * @param {Verdict} urlVerdict
 * @param {Verdict} fullVerdict
 * @returns {Verdict}
 */
export function mergeVerdicts(urlVerdict, fullVerdict) {
  if (!urlVerdict) return fullVerdict;
  if (!fullVerdict) return urlVerdict;

  const categories = zeroed();
  for (const category of CATEGORIES) {
    categories[category] = Math.max(urlVerdict.categories[category], fullVerdict.categories[category]);
  }

  const veto = fullVerdict.veto || urlVerdict.veto;
  const seen = new Set();
  const fired = [...urlVerdict.fired, ...fullVerdict.fired].filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });

  return {
    rank: Math.max(urlVerdict.rank, fullVerdict.rank, rankFromCategories(categories, veto)),
    categories,
    fired,
    suppressed: [...new Set([...urlVerdict.suppressed, ...fullVerdict.suppressed])],
    veto,
    phase: 'full'
  };
}

/**
 * Comodità: dall'URL (più eventuali segnali di pagina) al verdetto.
 * Usato dai test e dal simulatore, così che la demo mostri i numeri veri.
 *
 * @param {string} rawUrl
 * @param {object} [page]
 */
export function evaluateUrlAndPage(rawUrl, page = {}) {
  const urlSignals = buildUrlSignals(rawUrl, page);
  if (!urlSignals.valid) {
    return { rank: 1, categories: zeroed(), fired: [], suppressed: [], veto: null, phase: 'url' };
  }

  const hasDom = page.hasPassword !== undefined || page.formAction !== undefined ||
                 page.title !== undefined || page.visibleText !== undefined;

  if (!hasDom) return evaluate(urlSignals, { phase: 'url' });

  const domRaw = {
    passwordFieldCount: page.hasPassword ? 1 : 0,
    fieldNames: page.fieldNames || [],
    credentialForms: page.formAction ? [{ actionHost: safeHost(page.formAction, rawUrl) }] : [],
    title: page.title || '',
    ogSiteName: page.ogSiteName || '',
    visibleText: page.visibleText || ''
  };

  const merged = { ...urlSignals, ...normalizeDomSignals(domRaw, urlSignals) };
  return evaluate(merged, { phase: 'full' });
}

function safeHost(action, base) {
  try {
    return new URL(action, base).hostname;
  } catch {
    return null;
  }
}

/**
 * Etichetta del rank. Il livello 1 non dice "sicuro", di proposito.
 * @param {number} rank
 */
export function rankLabel(rank) {
  return RANK_LABELS[rank] ?? RANK_LABELS[1];
}

/** @param {number} rank */
export function rankSubtitle(rank) {
  return RANK_SUBTITLES[rank] ?? RANK_SUBTITLES[1];
}
