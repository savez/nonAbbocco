/**
 * Il cablaggio dell'estensione.
 *
 * Questi test non guardano il motore: guardano che il motore sia davvero
 * collegato. Per un anno `src/scoring.js` è stato corretto, testato e coperto
 * dal corpus — e completamente scollegato, perché nessun file caricato a
 * runtime lo importava. La suite era verde e l'estensione installata usava
 * un'altra logica.
 *
 * Un test del cablaggio è brutto e vale il fastidio: fallisce esattamente nel
 * momento in cui qualcuno reintroduce una copia delle euristiche dentro il
 * content script, o toglie dal pacchetto un file che il manifest carica.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(join(root, file), 'utf8');

const manifest = JSON.parse(await read('manifest.json'));
const contentScript = await read('content.js');
const background = await read('background.js');
const optionsPage = await read('options.html');
const packager = await read('tools/package.mjs');

// ─── Il manifest ─────────────────────────────────────────────────────────────

test('il manifest dichiara il popup della barra', () => {
  assert.equal(manifest.action.default_popup, 'popup.html');
});

test('il manifest dichiara il background per entrambi i browser', () => {
  // Chrome conosce solo `service_worker` + `type`; Firefox non supporta i
  // service worker né `type: "module"` su `scripts`, e usa `page`. Il manifest
  // di sviluppo le porta tutte e tre; `manifestFor()` le separa per lo store.
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.background.page, 'background.html');
});

test('ogni file nominato dal manifest esiste', () => {
  const referenced = [
    ...manifest.content_scripts.flatMap((cs) => cs.js || []),
    manifest.background.service_worker,
    manifest.background.page,
    manifest.options_ui.page,
    manifest.action.default_popup,
    ...Object.values(manifest.icons)
  ];
  for (const file of referenced) {
    assert.ok(existsSync(join(root, file)), `il manifest nomina "${file}", che non esiste`);
  }
});

test('il popup non chiede permessi nuovi', () => {
  // `tabs.query` restituisce `tab.id` senza permessi, e `storage.session` è
  // coperto da `storage`. Se questo elenco cresce, è una decisione da prendere
  // di proposito: ogni permesso in più è una schermata di revisione in più
  // sugli store e una richiesta in più all'utente.
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.host_permissions, undefined);
});

test('il pavimento di Firefox regge storage.session', () => {
  // `storage.session` è arrivato in Firefox 115 ed è l'unica via con cui il
  // popup legge il verdetto. Abbassare questo numero romperebbe il popup in
  // silenzio, senza che nulla fallisca in fase di validazione.
  const min = Number(manifest.browser_specific_settings.gecko.strict_min_version.split('.')[0]);
  assert.ok(min >= 115, `strict_min_version ${min} è sotto il minimo di storage.session`);
});

// ─── Il content script non decide ────────────────────────────────────────────

test('il content script non contiene una copia delle euristiche', () => {
  // Le tracce della copia storica: le soglie a somma di punti e la lista di
  // marchi confrontata per sottostringa.
  assert.doesNotMatch(contentScript, /score\s*[+]=/, 'somma di punti nel content script');
  assert.doesNotMatch(contentScript, /KNOWN_BRANDS|HIGH_RISK_TLDS/, 'lista di marchi o TLD nel content script');
  assert.doesNotMatch(contentScript, /score\s*>=\s*\d/, 'soglie di rank nel content script');
});

test('il content script non compone l\'elenco delle anomalie con innerHTML', () => {
  // I messaggi del motore interpolano il titolo della pagina e gli host dei
  // form: testo che l'attaccante controlla.
  assert.doesNotMatch(contentScript, /<li>\$\{/, 'voci di lista costruite per interpolazione');
});

test('il content script ignora i sottoframe', () => {
  assert.match(contentScript, /window\.top\s*!==\s*window/);
});

test('il bypass non vive dentro la pagina', () => {
  // `sessionStorage` è scrivibile dalla pagina: finché il bypass stava lì, un
  // sito ostile poteva dichiararsi già scavalcato dall'utente e non essere mai
  // bloccato. Ora la decisione la tiene il background in `storage.session`,
  // che i content script non possono né leggere né scrivere.
  // Sull'USO, non sulla parola: il commento che spiega perché il bypass se
  // n'è andato deve poter nominare il posto da cui se n'è andato.
  assert.doesNotMatch(contentScript, /sessionStorage\s*\./,
    'il content script usa ancora sessionStorage: il bypass è forgiabile dalla pagina');
  assert.match(background, /bypass/, 'il background non gestisce il bypass');
});

// ─── L'allowlist è collegata ─────────────────────────────────────────────────

test('il background alimenta davvero la regola user-allowlisted', () => {
  // La regola esisteva dal primo giorno e non è mai scattata, perché nessuno
  // scriveva `context.userAllowlisted`. Questo test è ciò che impedisce che
  // torni a essere codice morto.
  assert.match(background, /isAllowlisted/);
  assert.match(background, /userAllowlisted:/);
});

test('la pagina delle opzioni espone il campo dell\'allowlist', () => {
  assert.match(optionsPage, /id="allowlist"/);
  // Il servizio che dà un sottodominio per cliente è la trappola vera di
  // qualunque whitelist: la pagina deve dirlo, non lasciarlo scoprire.
  assert.match(optionsPage, /awsapps\.com/);
});

// ─── Il pacchetto ────────────────────────────────────────────────────────────

test('ogni file caricato a runtime entra negli archivi per gli store', () => {
  // `SHIPPED` è un elenco esplicito: un file dimenticato produce
  // un'estensione rotta che supera comunque la validazione dello store.
  for (const file of ['background.js', 'background.html', 'popup.html', 'popup.js']) {
    assert.match(packager, new RegExp(`'${file.replace('.', '\\.')}'`), `${file} non è in SHIPPED`);
  }
});
