/**
 * I marchi che il phishing imita, e i domini che a ciascuno appartengono
 * davvero.
 *
 * ─── PERCHÉ QUESTA STRUTTURA ─────────────────────────────────────────────────
 *
 * La versione storica era un array di stringhe confrontato con
 * `hostname.includes(brand)`, più un'allowlist implicita che accettava solo
 * `brand.com` e `brand.it`. Due conseguenze:
 *
 *   1. Falsi positivi sui siti veri: `posteitaliane.it`, `google.co.uk`,
 *      `amazon.de`, `login.microsoftonline.com` erano tutti marcati come
 *      typosquatting, perché non finivano per `.com` o `.it` del marchio.
 *   2. Impossibile allungare la lista. Con la ricerca per sottostringa ogni
 *      nome aggiunto era un rischio netto, e più il nome era corto più
 *      faceva danni: aggiungere `tim` marcava `timbrature.it`,
 *      `multimedia.it` e `ultimatestore.com`; aggiungere `enel` marcava
 *      `penelope.it`; aggiungere `sky` marcava `skyscanner.it`.
 *
 * Qui invece ogni marchio porta con sé i propri domini legittimi, e il
 * confronto avviene per TOKEN sul dominio registrabile e sulle label di
 * sottodominio — non per sottostringa sull'hostname intero. È questo che
 * rende sicuro includere nomi brevi: `timbrature` non contiene il *token*
 * `tim`, mentre `tim-fatture` sì.
 *
 * ─── COME AMPLIARE ───────────────────────────────────────────────────────────
 *
 * Aggiungendo un marchio, i `legit` devono essere COMPLETI: un dominio vero
 * dimenticato diventa un falso positivo per gli utenti di quel servizio.
 * Nel dubbio, meglio non aggiungere il marchio che aggiungerlo con
 * un'allowlist incompleta.
 *
 * ─── IL LIMITE, DETTO CHIARAMENTE ────────────────────────────────────────────
 *
 * Questa lista è il collo di bottiglia del motore e non scala: nessuna lista
 * curata a mano coprirà i marchi non previsti. La mitigazione non è
 * allungarla all'infinito, è la CONGIUNZIONE — un marchio riconosciuto da
 * solo non produce un rank alto, serve marchio *più* superficie credenziali.
 * La copertura ampia è compito di Safe Browsing, che è una lista che non
 * manteniamo noi.
 */

/**
 * @typedef {object} Brand
 * @property {string} id       identificatore stabile, usato nei test e nei messaggi
 * @property {string} name     nome leggibile, mostrato all'utente
 * @property {string[]} labels token che, se compaiono in un dominio non legittimo, insospettiscono
 * @property {string[]} legit  domini registrabili che appartengono davvero al marchio
 */

/** @type {Brand[]} */
export const BRANDS = [
  // ─── Pagamenti ─────────────────────────────────────────────────────────────
  {
    id: 'paypal',
    name: 'PayPal',
    labels: ['paypal'],
    legit: ['paypal.com', 'paypal.me', 'paypalobjects.com', 'paypal-community.com']
  },
  {
    id: 'nexi',
    name: 'Nexi',
    labels: ['nexi'],
    legit: ['nexi.it', 'nexipayments.com', 'nexigroup.com']
  },
  {
    id: 'satispay',
    name: 'Satispay',
    labels: ['satispay'],
    legit: ['satispay.com']
  },
  {
    id: 'revolut',
    name: 'Revolut',
    labels: ['revolut'],
    legit: ['revolut.com']
  },

  // ─── Poste e corrieri ──────────────────────────────────────────────────────
  // Il phishing "pacco in giacenza, paga la dogana" è tra i più diffusi in
  // Italia, quindi i corrieri contano quanto le banche.
  {
    id: 'poste',
    name: 'Poste Italiane',
    labels: ['poste', 'posteitaliane', 'postepay', 'bancoposta'],
    legit: ['poste.it', 'posteitaliane.it', 'postepay.it', 'bancoposta.it', 'poste.com']
  },
  {
    id: 'brt',
    name: 'BRT / Bartolini',
    labels: ['brt', 'bartolini'],
    legit: ['brt.it', 'bartolini.it']
  },
  {
    id: 'gls',
    name: 'GLS',
    labels: ['gls'],
    legit: ['gls-italy.com', 'gls-group.com', 'gls-group.eu']
  },
  {
    id: 'dhl',
    name: 'DHL',
    labels: ['dhl'],
    legit: ['dhl.com', 'dhl.it', 'dhl.de']
  },
  {
    id: 'ups',
    name: 'UPS',
    labels: ['ups'],
    legit: ['ups.com']
  },
  {
    id: 'fedex',
    name: 'FedEx',
    labels: ['fedex'],
    legit: ['fedex.com']
  },

  // ─── Banche ────────────────────────────────────────────────────────────────
  {
    id: 'intesa',
    name: 'Intesa Sanpaolo',
    labels: ['intesa', 'intesasanpaolo', 'sanpaolo'],
    legit: ['intesasanpaolo.com', 'intesasanpaolo.it', 'intesa.it', 'isybank.com']
  },
  {
    id: 'unicredit',
    name: 'UniCredit',
    labels: ['unicredit'],
    legit: ['unicredit.it', 'unicreditgroup.eu', 'unicredit.eu']
  },
  {
    id: 'bnl',
    name: 'BNL',
    labels: ['bnl'],
    legit: ['bnl.it', 'bnpparibas.com']
  },
  {
    id: 'bper',
    name: 'BPER Banca',
    labels: ['bper'],
    legit: ['bper.it', 'bperbanca.it']
  },
  {
    id: 'bancobpm',
    name: 'Banco BPM',
    labels: ['bancobpm', 'bpm'],
    legit: ['bancobpm.it', 'bancobpmspa.it']
  },
  {
    id: 'mps',
    name: 'Monte dei Paschi di Siena',
    labels: ['mps', 'montepaschi'],
    legit: ['mps.it', 'gruppomps.it', 'bancamps.it']
  },
  {
    id: 'fineco',
    name: 'Fineco',
    labels: ['fineco', 'finecobank'],
    legit: ['fineco.it', 'finecobank.com']
  },
  {
    id: 'mediolanum',
    name: 'Banca Mediolanum',
    labels: ['mediolanum'],
    legit: ['bancamediolanum.it', 'mediolanum.it']
  },
  {
    id: 'credem',
    name: 'Credem',
    labels: ['credem'],
    legit: ['credem.it']
  },
  {
    id: 'sella',
    name: 'Banca Sella',
    labels: ['sella', 'bancasella'],
    legit: ['sella.it', 'bancasella.it']
  },
  {
    id: 'ing',
    name: 'ING',
    labels: ['ingdirect'],
    legit: ['ing.it', 'ing.com']
  },
  {
    id: 'chebanca',
    name: 'CheBanca!',
    labels: ['chebanca'],
    legit: ['chebanca.it']
  },

  // ─── Pubblica amministrazione ──────────────────────────────────────────────
  // Il phishing "rimborso fiscale" e "credito INPS" è stagionale ma intenso.
  {
    id: 'inps',
    name: 'INPS',
    labels: ['inps'],
    legit: ['inps.it']
  },
  {
    id: 'agenziaentrate',
    name: 'Agenzia delle Entrate',
    labels: ['agenziaentrate', 'agenziadelleentrate'],
    legit: ['agenziaentrate.gov.it', 'agenziaentrateriscossione.gov.it']
  },
  {
    id: 'spid',
    name: 'SPID',
    labels: ['spid'],
    legit: ['spid.gov.it']
  },
  {
    id: 'pagopa',
    name: 'PagoPA',
    labels: ['pagopa'],
    legit: ['pagopa.it', 'pagopa.gov.it']
  },

  // ─── Utility e telecomunicazioni ───────────────────────────────────────────
  {
    id: 'enel',
    name: 'Enel',
    labels: ['enel'],
    legit: ['enel.it', 'enel.com', 'enelenergia.it', 'enelxstore.com']
  },
  {
    id: 'eni',
    name: 'Eni / Plenitude',
    labels: ['eniplenitude', 'plenitude'],
    legit: ['eni.com', 'eniplenitude.com', 'plenitude.com']
  },
  {
    id: 'tim',
    name: 'TIM',
    labels: ['tim', 'telecomitalia', 'timvision'],
    legit: ['tim.it', 'telecomitalia.it', 'timvision.it', 'timbusiness.it', 'gruppotim.it']
  },
  {
    id: 'vodafone',
    name: 'Vodafone',
    labels: ['vodafone'],
    legit: ['vodafone.it', 'vodafone.com']
  },
  {
    id: 'windtre',
    name: 'WindTre',
    labels: ['windtre', 'wind3'],
    legit: ['windtre.it', 'wind.it', 'tre.it']
  },
  {
    id: 'fastweb',
    name: 'Fastweb',
    labels: ['fastweb'],
    legit: ['fastweb.it']
  },
  {
    id: 'iliad',
    name: 'Iliad',
    labels: ['iliad'],
    legit: ['iliad.it', 'iliad.fr']
  },

  // ─── Grandi piattaforme ────────────────────────────────────────────────────
  {
    id: 'google',
    name: 'Google',
    labels: ['google', 'gmail'],
    legit: [
      'google.com', 'google.it', 'google.co.uk', 'google.de', 'google.fr', 'google.es',
      'gmail.com', 'googlemail.com', 'youtube.com', 'googleapis.com',
      'googleusercontent.com', 'withgoogle.com', 'google.co', 'goo.gl'
    ]
  },
  {
    id: 'apple',
    name: 'Apple',
    labels: ['apple', 'icloud', 'appleid'],
    legit: ['apple.com', 'icloud.com', 'me.com', 'mac.com', 'apple.co']
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    labels: ['microsoft', 'outlook', 'onedrive', 'office365'],
    legit: [
      'microsoft.com', 'microsoftonline.com', 'live.com', 'outlook.com',
      'office.com', 'office365.com', 'sharepoint.com', 'windows.net',
      'azure.com', 'msn.com', 'hotmail.com', 'microsoft.it'
    ]
  },
  {
    id: 'amazon',
    name: 'Amazon',
    labels: ['amazon', 'aws'],
    legit: [
      'amazon.com', 'amazon.it', 'amazon.de', 'amazon.co.uk', 'amazon.fr',
      'amazon.es', 'amazon.nl', 'amazonaws.com', 'awsapps.com', 'primevideo.com', 'amzn.to'
    ]
  },
  {
    id: 'meta',
    name: 'Meta / Facebook',
    labels: ['facebook', 'instagram', 'whatsapp', 'messenger'],
    legit: [
      'facebook.com', 'instagram.com', 'whatsapp.com', 'messenger.com',
      'meta.com', 'fb.com', 'fbcdn.net', 'threads.net'
    ]
  },
  {
    id: 'netflix',
    name: 'Netflix',
    labels: ['netflix'],
    legit: ['netflix.com', 'nflximg.net']
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    labels: ['linkedin'],
    legit: ['linkedin.com', 'licdn.com', 'lnkd.in']
  },
  {
    id: 'booking',
    name: 'Booking.com',
    labels: ['booking'],
    legit: ['booking.com', 'bstatic.com']
  },
  {
    id: 'airbnb',
    name: 'Airbnb',
    labels: ['airbnb'],
    legit: ['airbnb.com', 'airbnb.it']
  },
  {
    id: 'spotify',
    name: 'Spotify',
    labels: ['spotify'],
    legit: ['spotify.com', 'scdn.co']
  },
  {
    id: 'steam',
    name: 'Steam',
    labels: ['steampowered', 'steamcommunity'],
    legit: ['steampowered.com', 'steamcommunity.com', 'valvesoftware.com']
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    labels: ['dropbox'],
    legit: ['dropbox.com', 'dropboxusercontent.com']
  },
  {
    id: 'adobe',
    name: 'Adobe',
    labels: ['adobe'],
    legit: ['adobe.com', 'adobelogin.com']
  },

  // ─── Cripto ────────────────────────────────────────────────────────────────
  // Il phishing cripto è quello con il danno medio più alto: le transazioni
  // sono irreversibili e non c'è una banca a cui chiedere il rimborso.
  {
    id: 'binance',
    name: 'Binance',
    labels: ['binance'],
    legit: ['binance.com', 'binance.us']
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    labels: ['coinbase'],
    legit: ['coinbase.com', 'coinbase.it']
  },
  {
    id: 'metamask',
    name: 'MetaMask',
    labels: ['metamask'],
    legit: ['metamask.io']
  },
  {
    id: 'ledger',
    name: 'Ledger',
    labels: ['ledgerwallet', 'ledgerlive'],
    legit: ['ledger.com', 'ledgerwallet.com']
  }
];

/**
 * Indice token → marchio, costruito una volta sola.
 * @type {Map<string, Brand>}
 */
export const LABEL_INDEX = new Map();
for (const brand of BRANDS) {
  for (const label of brand.labels) {
    LABEL_INDEX.set(label, brand);
  }
}

/**
 * Insieme di tutti i domini registrabili legittimi, per la soppressione
 * rapida: se il registrabile è qui, nessuna regola sui marchi deve scattare.
 * @type {Set<string>}
 */
export const LEGIT_DOMAINS = new Set(BRANDS.flatMap((b) => b.legit));

/**
 * Il marchio a cui un dominio registrabile appartiene, se ne appartiene a uno.
 * @param {string} domain
 * @returns {Brand|null}
 */
export function brandOwning(domain) {
  if (!domain) return null;
  for (const brand of BRANDS) {
    if (brand.legit.includes(domain)) return brand;
  }
  return null;
}
