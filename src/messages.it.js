/**
 * Testi mostrati all'utente, chiavati sull'`id` della regola.
 *
 * Stanno separati dalle regole perché sono l'unica parte del motore che va
 * scritta pensando a chi legge invece che a cosa è vero. Una regola può
 * essere corretta e la sua spiegazione inutile.
 *
 * `test/rules.test.js` verifica che ogni regola abbia una voce qui, che nessuna
 * voce resti orfana, e che ogni messaggio si renda senza lanciare con i
 * parametri veri prodotti dalla sua regola: aggiungere una regola senza
 * spiegarla fa fallire la build.
 *
 * Queste voci sono anche la documentazione pubblica del motore — il catalogo
 * sulla pagina di progetto le legge da qui — quindi vanno scritte per chi non
 * ha mai aperto il codice.
 *
 * Regola di stile: dire all'utente COSA è stato osservato, non quanto è grave.
 * La gravità è il rank; qui si spiega il fatto.
 */

/** @type {Record<string, (params: any) => string>} */
export const RULE_MESSAGES = {
  // Soppressioni — spiegano perché NON è stato segnalato nulla.
  'trusted-brand-domain': () =>
    'Il dominio risulta appartenere davvero al marchio che rappresenta.',
  'private-network': () =>
    'Indirizzo su rete locale o privata: non è raggiungibile da Internet.',
  'user-allowlisted': () =>
    'Sito che hai indicato come attendibile nelle impostazioni.',

  // Veto
  'safebrowsing-hit': (p) =>
    `Questo sito è segnalato da Google Safe Browsing come pericoloso (${p.threat}).`,

  // Identità
  'brand-in-subdomain': (p) =>
    `Il nome "${p.name}" compare nel sottodominio, ma il dominio reale è un altro: è una tecnica per far leggere un marchio dove non c'è.`,
  'brand-in-registrable-domain': (p) =>
    `Il dominio richiama il marchio "${p.name}" senza appartenergli.`,
  'brand-typosquatting': (p) =>
    `Il nome del sito somiglia a "${p.name}" ma non è scritto uguale: è un errore di battitura registrato apposta, per chi lo legge di fretta.`,
  'homograph-brand-collision': (p) =>
    `L'indirizzo usa caratteri di un altro alfabeto per somigliare a "${p.name}". Scritto per esteso è: ${p.shown}`,
  'mixed-script-label': (p) =>
    `L'indirizzo mescola alfabeti diversi dentro la stessa parola (${p.labels.join(', ')}), cosa che nessuna lingua richiede.`,
  'userinfo-in-authority': (p) =>
    `L'indirizzo mostra "${p.shown}" prima della chiocciola, ma il sito che stai visitando è in realtà ${p.real}.`,
  'raw-ip-host': (p) =>
    `Il sito è raggiunto tramite un indirizzo numerico (${p.ip}) invece che con un nome di dominio.`,
  'ephemeral-hosting': (p) =>
    `La pagina è ospitata su un servizio gratuito (${p.suffix}), dove chiunque può pubblicare in pochi minuti.`,
  'suspicious-tld': (p) =>
    `L'estensione del dominio (${p.tld}) è tra quelle a basso costo più usate per le truffe.`,
  'deep-subdomain-nesting': (p) =>
    `L'indirizzo ha ${p.depth} livelli di sottodominio, spesso usati per allontanare il dominio reale dalla vista.`,
  'brand-claimed-in-title': (p) =>
    `La pagina si presenta come "${p.name}", ma il dominio non appartiene a quel marchio.`,

  // Credenziali
  'credential-surface': () =>
    'La pagina chiede una password.',
  'sensitive-fields': (p) =>
    `La pagina chiede dati particolarmente sensibili (${p.fields.join(', ')}).`,
  'access-words-in-url': (p) =>
    `L'indirizzo contiene parole tipiche delle pagine di accesso o di sollecito (${p.words.join(', ')}).`,
  'cross-origin-credential-form': (p) =>
    `Il modulo invia i dati a un dominio diverso da quello che stai visitando (${p.hosts.join(', ')}).`,
  'urgency-language': () =>
    'Il testo insiste sull\'urgenza, tecnica usata per farti agire senza riflettere.',

  // Trasporto
  'password-over-http': () =>
    'La password viaggerebbe in chiaro: la connessione non è cifrata.',
  'non-standard-port': (p) =>
    `Il sito risponde su una porta non standard (${p.port}).`,
  'opaque-top-level-document': (p) =>
    `La pagina è caricata da uno schema senza origine verificabile (${p.scheme}).`
};

/** Nomi delle categorie, per l'interstiziale. */
export const CATEGORY_LABELS = {
  identity: 'Identità del sito',
  credentials: 'Dati richiesti',
  transport: 'Sicurezza della connessione',
  reputation: 'Reputazione'
};

/** La domanda a cui ogni categoria risponde, mostrata come sottotitolo. */
export const CATEGORY_QUESTIONS = {
  identity: 'Chi dice di essere questo sito?',
  credentials: 'Cosa ti sta chiedendo?',
  transport: 'Come lo trasmette?',
  reputation: 'Cosa ne sanno gli altri?'
};

/**
 * Etichette del rank.
 *
 * Il rank 1 NON dice "sicuro". L'assenza di segnali non è una garanzia: il
 * motore è euristico e il phishing su dominio pulito con TLS valido può non
 * attivare alcuna regola. Comunicare quel silenzio come una promessa di
 * sicurezza fa più danni che non dire nulla, perché sostituisce la prudenza
 * dell'utente con una falsa certezza.
 */
export const RANK_LABELS = {
  1: 'Nessun segnale noto',
  2: 'Qualche anomalia',
  3: 'Sospetto moderato',
  4: 'Rischio elevato',
  5: 'Minaccia confermata'
};

export const RANK_SUBTITLES = {
  1: 'Non abbiamo rilevato segnali di phishing. Non è una garanzia che il sito sia sicuro.',
  2: 'Qualcosa non torna, ma potrebbe essere legittimo. Controlla l\'indirizzo.',
  3: 'Diversi elementi sospetti insieme. Non inserire dati se non sei certo.',
  4: 'Il sito imita un servizio noto e chiede dati. Molto probabilmente è una truffa.',
  5: 'Sito segnalato come pericoloso. Non inserire alcun dato.'
};
