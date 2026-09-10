/**
 * NonAbbocco - Pagina opzioni
 *
 * Questo file esiste perché il CSP di default di Manifest V3 per le pagine
 * dell'estensione è `script-src 'self'` e NON è relassabile: uno <script>
 * inline dentro options.html viene bloccato senza rumore. Finché la logica
 * era inline la pagina si caricava ma non funzionava — il select mostrava
 * sempre 5 e il pulsante Salva non salvava nulla.
 */
'use strict';

const DEFAULT_THRESHOLD = 5;
const VALID_THRESHOLDS = [2, 3, 4, 5];

const select = document.getElementById('threshold');
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
  chrome.storage.sync.get({ blockThreshold: DEFAULT_THRESHOLD }, (items) => {
    if (chrome.runtime.lastError) {
      showStatus('Impossibile leggere le impostazioni.', true);
      return;
    }
    const stored = Number(items.blockThreshold);
    select.value = String(VALID_THRESHOLDS.includes(stored) ? stored : DEFAULT_THRESHOLD);
  });
}

function save() {
  const value = Number.parseInt(select.value, 10);
  if (!VALID_THRESHOLDS.includes(value)) {
    showStatus('Soglia non valida.', true);
    return;
  }
  chrome.storage.sync.set({ blockThreshold: value }, () => {
    if (chrome.runtime.lastError) {
      showStatus('Salvataggio non riuscito.', true);
      return;
    }
    showStatus('✓ Impostazioni salvate correttamente!', false);
  });
}

document.addEventListener('DOMContentLoaded', load);
document.getElementById('save').addEventListener('click', save);
