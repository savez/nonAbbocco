/**
 * Le regole di rilevamento, espresse come DATI.
 *
 * Non sono `if` annidati dentro il motore per tre ragioni concrete:
 *   - i test possono enumerarle e verificare che ognuna sia documentata;
 *   - `docs/DETECTION.md` resta allineato perché la suite lo controlla;
 *   - l'interstiziale può spiegare all'utente cosa è scattato e perché.
 *
 * ─── I QUATTRO TIPI ──────────────────────────────────────────────────────────
 *
 *   'suppress' — azzera una o più categorie. Valutate PER PRIME: nessun
 *                punteggio sopravvive a una soppressione. È il meccanismo che
 *                impedisce di bloccare il router di casa e i dev server.
 *   'veto'     — porta direttamente a rank 5. Riservato al solo riscontro di
 *                Safe Browsing: è una lista di fatti verificati, non un
 *                indizio. Questo lega strutturalmente il rank 5 alla variante
 *                dell'interstiziale con attribuzione Google, come i ToS
 *                richiedono.
 *   'strong'   — contribuisce 2 livelli di evidenza.
 *   'weak'     — contribuisce 1 livello, e da sole le regole deboli non
 *                possono portare una categoria oltre 1.
 *
 * ─── LE QUATTRO CATEGORIE ────────────────────────────────────────────────────
 *
 *   'identity'    Chi dice di essere questo sito?
 *   'credentials' Cosa mi sta chiedendo?
 *   'transport'   Come lo trasmette?
 *   'reputation'  Cosa ne sanno gli altri?
 *
 * `credentials` è deliberatamente NON sufficiente da sola ad alzare il rank:
 * una pagina di login è la cosa più normale del web. Conta solo in
 * congiunzione con un problema di identità o di trasporto.
 */

import { LABEL_INDEX, LEGIT_DOMAINS } from './brands.js';

const ACCESS_WORDS = [
  'login', 'signin', 'account', 'verify', 'verifica', 'accedi', 'accesso',
  'password', 'secure', 'sicurezza', 'conferma', 'confirm', 'update',
  'aggiorna', 'sospeso', 'suspended', 'billing', 'pagamento', 'rimborso',
  'refund', 'dogana', 'customs', 'giacenza', 'sblocca', 'unlock'
];

/**
 * Il marchio evocato dai token di un dominio, se il dominio non gli appartiene.
 * @param {string[]} tokens
 * @param {string|null} registrableDomain
 * @returns {import('./brands.js').Brand|null}
 */
function foreignBrandFromTokens(tokens, registrableDomain) {
  // Suffisso pubblico ignoto ⇒ nessun verdetto sui marchi. Vedi la deviazione
  // documentata in src/psl.js: indovinare il dominio registrabile
  // reintrodurrebbe la classe di falsi positivi che la PSL esiste per
  // eliminare. Meglio tacere che sbagliare.
  if (!registrableDomain) return null;
  if (LEGIT_DOMAINS.has(registrableDomain)) return null;
  for (const token of tokens || []) {
    const brand = LABEL_INDEX.get(token);
    if (brand && !brand.legit.includes(registrableDomain)) return brand;
  }
  return null;
}

/** @type {import('./scoring.js').Rule[]} */
export const RULES = [
  // ─── SOPPRESSIONI ──────────────────────────────────────────────────────────
  {
    id: 'trusted-brand-domain',
    kind: 'suppress',
    phase: 'url',
    suppresses: ['identity'],
    test: (s) => (s.registrableDomain && LEGIT_DOMAINS.has(s.registrableDomain) ? {} : null)
  },
  {
    id: 'private-network',
    kind: 'suppress',
    phase: 'url',
    suppresses: ['identity', 'transport'],
    // Il difetto storico più fastidioso: un IP grezzo valeva 45 punti e
    // http+password altri 50, quindi il router di casa su 192.168.1.1 e ogni
    // dev server su 127.0.0.1 finivano a 95 punti, cioè blocco a schermo
    // intero. Una rete privata non è raggiungibile da un attaccante remoto e
    // non usa HTTPS per ragioni ovvie.
    test: (s) => (s.isPrivateIp || s.isSingleLabelHost || s.isLocalTld ? {} : null)
  },
  {
    id: 'user-allowlisted',
    kind: 'suppress',
    phase: 'url',
    suppresses: ['identity', 'credentials', 'transport'],
    test: (s) => (s.userAllowlisted ? {} : null)
  },

  // ─── VETO ──────────────────────────────────────────────────────────────────
  {
    id: 'safebrowsing-hit',
    kind: 'veto',
    phase: 'either',
    category: 'reputation',
    test: (s) => (s.safeBrowsingThreat ? { threat: s.safeBrowsingThreat } : null)
  },

  // ─── IDENTITÀ ──────────────────────────────────────────────────────────────
  {
    id: 'brand-in-subdomain',
    kind: 'strong',
    phase: 'url',
    category: 'identity',
    // `paypal.com.verifica-account.xyz`: il dominio registrabile è
    // verifica-account.xyz, e "paypal.com" è solo testo nel sottodominio.
    // È la singola regola con il miglior rapporto valore/costo.
    test: (s) => {
      const brand = foreignBrandFromTokens(s.subdomainTokens, s.registrableDomain);
      return brand ? { brand: brand.id, name: brand.name } : null;
    }
  },
  {
    id: 'brand-in-registrable-domain',
    kind: 'strong',
    phase: 'url',
    category: 'identity',
    // `paypal-secure.xyz`, `poste-servizi-online.net`. Il confronto è per
    // TOKEN sui confini `-` e `.`, non per sottostringa: è questo che rende
    // sicuro tenere in lista nomi brevi come "tim" senza marcare
    // "timbrature.it".
    test: (s) => {
      const brand = foreignBrandFromTokens(s.domainTokens, s.registrableDomain);
      return brand ? { brand: brand.id, name: brand.name } : null;
    }
  },
  {
    id: 'homograph-brand-collision',
    kind: 'strong',
    phase: 'url',
    category: 'identity',
    // `аррӏе.com` scritto in cirillico ha skeleton "apple". Nota che la
    // regola non scatta sulla sola presenza di punycode — quella penalizzava
    // ogni dominio IDN legittimo — ma solo sulla collisione con un marchio.
    test: (s) => {
      if (!s.registrableDomain || LEGIT_DOMAINS.has(s.registrableDomain)) return null;
      for (const token of s.skeletonTokens || []) {
        const brand = LABEL_INDEX.get(token);
        if (brand && !brand.legit.includes(s.registrableDomain) && !s.domainTokens?.includes(token)) {
          return { brand: brand.id, name: brand.name, shown: s.hostnameUnicode };
        }
      }
      return null;
    }
  },
  {
    id: 'mixed-script-label',
    kind: 'strong',
    phase: 'url',
    category: 'identity',
    // Mescolare due alfabeti DENTRO la stessa parola non serve a nessuna
    // lingua reale. Il controllo è per label e non sull'hostname intero,
    // perché `банк.example.com` mescola script fra label diverse in modo
    // legittimo.
    test: (s) => (s.mixedScriptLabels?.length ? { labels: s.mixedScriptLabels } : null)
  },
  {
    id: 'userinfo-in-authority',
    kind: 'strong',
    phase: 'url',
    category: 'identity',
    // `https://paypal.com@evil.xyz/`: la barra degli indirizzi mostra un
    // testo che sembra un dominio, ma l'host reale è quello dopo la chiocciola.
    test: (s) => (s.hasUserinfo ? { shown: s.userinfo, real: s.hostname } : null)
  },
  {
    id: 'raw-ip-host',
    kind: 'strong',
    phase: 'url',
    category: 'identity',
    // Solo IP pubblici: quelli privati sono già soppressi da 'private-network'.
    test: (s) => (s.isIp && !s.isPrivateIp ? { ip: s.hostname } : null)
  },
  {
    id: 'ephemeral-hosting',
    kind: 'weak',
    phase: 'url',
    category: 'identity',
    // `random-kit.pages.dev`, `qualcosa.web.app`, `tizio.github.io`. Molti
    // progetti legittimi vivono qui, quindi è debole: da sola non alza nulla.
    // Ma è il terreno del phishing moderno, che così ottiene TLS valido senza
    // registrare un dominio — ed è il caso che il motore storico giudicava
    // "Ritenuto Sicuro".
    test: (s) => (s.isEphemeralHosting ? { suffix: s.publicSuffix } : null)
  },
  {
    id: 'suspicious-tld',
    kind: 'weak',
    phase: 'url',
    category: 'identity',
    test: (s) => (s.isHighRiskTld ? { tld: s.tld } : null)
  },
  {
    id: 'deep-subdomain-nesting',
    kind: 'weak',
    phase: 'url',
    category: 'identity',
    test: (s) => ((s.subdomainTokens?.length ?? 0) >= 4 ? { depth: s.subdomainTokens.length } : null)
  },
  {
    id: 'brand-claimed-in-title',
    kind: 'weak',
    phase: 'dom',
    category: 'identity',
    // La pagina si presenta come un marchio che il dominio non possiede.
    // Curiosamente questa regola esisteva solo nella demo e non nel motore.
    test: (s) => {
      if (!s.titleTokens?.length) return null;
      const brand = foreignBrandFromTokens(s.titleTokens, s.registrableDomain);
      return brand ? { brand: brand.id, name: brand.name } : null;
    }
  },

  // ─── CREDENZIALI ───────────────────────────────────────────────────────────
  {
    id: 'credential-surface',
    kind: 'weak',
    phase: 'dom',
    category: 'credentials',
    // Deliberatamente debole e deliberatamente non sufficiente da sola: una
    // pagina di login è normale. Sostituisce il tentativo di seguire dove
    // finiscono le credenziali, che dal mondo isolato non è osservabile e dal
    // MAIN world è aggirabile.
    test: (s) => (s.passwordFieldCount > 0 ? { count: s.passwordFieldCount } : null)
  },
  {
    id: 'sensitive-fields',
    kind: 'weak',
    phase: 'dom',
    category: 'credentials',
    test: (s) => (s.sensitiveFieldNames?.length ? { fields: s.sensitiveFieldNames } : null)
  },
  {
    id: 'access-words-in-url',
    kind: 'weak',
    phase: 'url',
    category: 'credentials',
    // Cercate nell'URL INTERO, host e path. Il difetto storico le cercava
    // solo nell'hostname, da cui l'incoerenza per cui `login-paypal.xyz`
    // scattava e `paypal-secure.xyz/login` no.
    test: (s) => {
      const hits = ACCESS_WORDS.filter((w) => s.urlTokens?.includes(w));
      return hits.length ? { words: hits } : null;
    }
  },
  {
    id: 'cross-origin-credential-form',
    kind: 'weak',
    phase: 'dom',
    category: 'credentials',
    // Era la regola più pesante del motore storico, a 65 punti. Declassata a
    // debole perché il federated login legittimo (Microsoft, Google, Okta,
    // Auth0) fa esattamente questo, e perché i kit moderni non impostano
    // affatto `action`: la regola puniva i siti onesti e mancava gli attacchi.
    test: (s) => {
      const hosts = (s.credentialForms || [])
        .filter((f) => f.actionHost && f.actionRegistrableDomain !== s.registrableDomain)
        .map((f) => f.actionHost);
      return hosts.length ? { hosts } : null;
    }
  },
  {
    id: 'urgency-language',
    kind: 'weak',
    phase: 'dom',
    category: 'credentials',
    test: (s) => (s.hasUrgencyText ? {} : null)
  },

  // ─── TRASPORTO ─────────────────────────────────────────────────────────────
  {
    id: 'password-over-http',
    kind: 'strong',
    phase: 'dom',
    category: 'transport',
    test: (s) => (s.passwordFieldCount > 0 && s.protocol === 'http:' ? {} : null)
  },
  {
    id: 'non-standard-port',
    kind: 'weak',
    phase: 'url',
    category: 'transport',
    test: (s) => (s.hasNonStandardPort ? { port: s.port } : null)
  },
  {
    id: 'opaque-top-level-document',
    kind: 'strong',
    phase: 'url',
    category: 'transport',
    // Un documento top-level su `data:` o `blob:` non ha un'origine
    // verificabile e non ha usi legittimi in navigazione diretta.
    test: (s) => (s.isOpaqueScheme ? { scheme: s.protocol } : null)
  }
];

export const RULE_IDS = RULES.map((r) => r.id);

export { ACCESS_WORDS };
