/**
 * NonAbbocco - Pagina opzioni
 *
 * Questo file esiste perché il CSP di default di Manifest V3 per le pagine
 * dell'estensione è `script-src 'self'` e NON è relassabile: uno <script>
 * inline dentro options.html viene bloccato senza rumore. Finché la logica
 * era inline la pagina si caricava ma non funzionava — il select mostrava
 * sempre 5 e il pulsante Salva non salvava nulla.
 *
 * È un modulo ES perché le pagine dell'estensione possono esserlo, e così la
 * normalizzazione dell'allowlist arriva da `src/allowlist.js` invece di essere
 * riscritta qui. Una seconda copia di quelle regole di confronto sarebbe
 * peggio che inutile: sono quelle che distinguono `esempio.it` da
 * `esempio.it.truffa.xyz`, e due versioni che divergono farebbero accettare
 * dalla pagina ciò che il motore rifiuta.
 */

import { parseAllowlist, formatAllowlist } from './src/allowlist.js';

const api = globalThis.browser ?? globalThis.chrome;

const DEFAULT_THRESHOLD = 5;
const VALID_THRESHOLDS = [2, 3, 4, 5];

/**
 * `storage.sync` accetta al massimo 8 KB per chiave. Una lista più lunga non
 * verrebbe salvata, e senza questo controllo il fallimento sarebbe silenzioso.
 */
const MAX_ALLOWLIST_ENTRIES = 200;

const select = document.getElementById('threshold');
const allowlistField = document.getElementById('allowlist');
const status = document.getElementById('status');

let statusTimer = null;

function showStatus(message, isError) {
  status.textContent = message;
  status.style.color = isError ? '#f87171' : '#34d399';
  status.style.display = 'block';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.style.display = 'none';
  }, 2500);
}

function load() {
  api.storage.sync.get({ blockThreshold: DEFAULT_THRESHOLD, allowlist: [] }, (items) => {
    if (api.runtime.lastError) {
      showStatus('Impossibile leggere le impostazioni.', true);
      return;
    }
    const stored = Number(items.blockThreshold);
    select.value = String(VALID_THRESHOLDS.includes(stored) ? stored : DEFAULT_THRESHOLD);
    allowlistField.value = formatAllowlist(items.allowlist);
  });
}

function save() {
  const value = Number.parseInt(select.value, 10);
  if (!VALID_THRESHOLDS.includes(value)) {
    showStatus('Soglia non valida.', true);
    return;
  }

  const written = allowlistField.value;
  const allowlist = parseAllowlist(written);

  if (allowlist.length > MAX_ALLOWLIST_ENTRIES) {
    showStatus(`Troppi siti: il massimo è ${MAX_ALLOWLIST_ENTRIES}.`, true);
    return;
  }

  // Righe scritte ma non riconosciute come nomi di sito. Dirlo, invece di
  // scartarle in silenzio: l'utente crederebbe di aver messo in allowlist un
  // sito che non è mai entrato nell'elenco.
  const scritte = written.split(/[\r\n,]+/).filter((l) => l.trim() && !l.trim().startsWith('#')).length;
  const scartate = scritte - allowlist.length;

  api.storage.sync.set({ blockThreshold: value, allowlist }, () => {
    if (api.runtime.lastError) {
      showStatus('Salvataggio non riuscito.', true);
      return;
    }
    // Rimette in campo la forma normalizzata: l'utente vede cosa è stato
    // salvato davvero, non cosa aveva scritto.
    allowlistField.value = formatAllowlist(allowlist);
    showStatus(
      scartate > 0
        ? `✓ Salvate. ${scartate} riga/e non erano nomi di sito e sono state scartate.`
        : '✓ Impostazioni salvate correttamente!',
      scartate > 0
    );
  });
}

document.addEventListener('DOMContentLoaded', load);
document.getElementById('save').addEventListener('click', save);
