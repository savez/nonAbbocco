/**
 * I siti che l'utente ha dichiarato attendibili.
 *
 * La regola `user-allowlisted` esiste in `src/rules.js` dal primo giorno e
 * sopprime identità, credenziali e trasporto — cioè spegne quasi tutto il
 * motore per quel sito. Quello che mancava era chi la alimentasse: nessuno
 * scriveva mai `context.userAllowlisted`, quindi la regola non è mai scattata.
 * Questo modulo è quel pezzo.
 *
 * ─── PERCHÉ IL CONFRONTO NON È UNA SOTTOSTRINGA ──────────────────────────────
 *
 * `hostname.includes(voce)` sarebbe una riga sola e sarebbe sbagliata nello
 * stesso modo in cui lo era la vecchia lista dei marchi: mettere `poste.it`
 * in allowlist accetterebbe anche `poste.it.truffa.xyz`, cioè esattamente la
 * forma d'attacco che il motore esiste per riconoscere. Il confronto è per
 * label: o l'hostname coincide con la voce, o le sta sotto come sottodominio.
 *
 * ─── COSA L'ALLOWLIST NON PUÒ FARE ───────────────────────────────────────────
 *
 * Una voce copre tutti i sottodomini, ed è ciò che ci si aspetta da una
 * whitelist. Ma su una piattaforma condivisa questo diventa una trappola:
 * `awsapps.com` in allowlist accetta anche `paypal.awsapps.com`, che è un
 * attacco. La pagina delle opzioni lo dice in chiaro invece di nasconderlo,
 * perché è una scelta che deve restare dell'utente.
 */

/**
 * Riduce una riga scritta a mano a un hostname confrontabile, o a null se non
 * lo è. Accetta quello che le persone incollano davvero: un URL intero, con o
 * senza schema, con path, con porta, con `www.`, con spazi intorno.
 *
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizeEntry(raw) {
  let value = String(raw ?? '').trim().toLowerCase();
  if (!value || value.startsWith('#')) return null;

  // Schema, credenziali, path, query: via tutto, resta l'autorità.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0].split('?')[0].split('#')[0];
  value = value.split('@').pop();

  // Porta. L'IPv6 fra parentesi quadre non la contiene in questa posizione.
  if (!value.startsWith('[')) value = value.split(':')[0];

  // Punto finale della forma assoluta, e punti iniziali di chi scrive `.esempio.it`.
  value = value.replace(/^\.+/, '').replace(/\.+$/, '');

  if (!value) return null;
  // Nessuno spazio, nessun carattere che in un hostname non può esserci.
  if (!/^[a-z0-9.\-_[\]:]+$/.test(value)) return null;
  // Una voce fatta di soli punti o trattini non è un hostname.
  if (!/[a-z0-9]/.test(value)) return null;

  return value;
}

/**
 * Dal testo della textarea all'elenco salvato: una voce per riga, normalizzate,
 * senza duplicati e senza righe vuote.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseAllowlist(text) {
  const seen = new Set();
  for (const line of String(text ?? '').split(/[\r\n,]+/)) {
    const entry = normalizeEntry(line);
    if (entry) seen.add(entry);
  }
  return [...seen];
}

/** Il testo da rimettere nella textarea a partire dall'elenco salvato. */
export function formatAllowlist(entries) {
  return (Array.isArray(entries) ? entries : []).join('\n');
}

/**
 * L'hostname è coperto da una voce dell'allowlist?
 *
 * Coincidenza esatta oppure sottodominio: `esempio.it` copre
 * `www.esempio.it` e `mail.esempio.it`, ma non `esempio.it.truffa.xyz` né
 * `nonesempio.it`.
 *
 * @param {string} hostname
 * @param {string[]} entries
 * @returns {boolean}
 */
export function isAllowlisted(hostname, entries) {
  const host = normalizeEntry(hostname);
  if (!host || !Array.isArray(entries)) return false;
  return entries.some((raw) => {
    const entry = normalizeEntry(raw);
    if (!entry) return false;
    return host === entry || host.endsWith(`.${entry}`);
  });
}
