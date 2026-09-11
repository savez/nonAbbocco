/**
 * La documentazione che può divergere in silenzio.
 *
 * Non tutta: solo i punti in cui la stessa cosa è scritta due volte in due
 * posti diversi, che è la sola forma di documentazione che marcisce senza che
 * nessuno se ne accorga. Il resto della prosa non si testa.
 *
 * Il percorso che porta al rank è disegnato due volte — in Mermaid nel README
 * e come scala di passi sulla pagina di progetto — perché GitHub e il sito
 * vogliono formati diversi. Qui si verifica che esistano entrambi e che
 * raccontino gli stessi passaggi: quando il verdetto preliminare
 * sull'indirizzo verrà collegato, questo test è ciò che impedisce di
 * aggiornarne uno solo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(join(root, file), 'utf8');

const readme = await read('README.md');
const builder = await read('tools/build-page.mjs');
const page = await read('simulator.html');

test('il percorso verso il rank è disegnato sia nel README sia sulla pagina', () => {
  assert.match(readme, /```mermaid/, 'il diagramma Mermaid è sparito dal README');
  assert.match(builder, /const FLOW = \[/, 'il percorso è sparito dal generatore della pagina');
  assert.match(page, /class="flow"/, 'simulator.html non contiene il percorso: manca `npm run page`?');
});

test('i due disegni nominano gli stessi passaggi', () => {
  // Non un confronto parola per parola — sono due formati diversi — ma i
  // concetti portanti devono comparire in entrambi. Sono quelli che cambiano
  // quando cambia l'architettura.
  const passaggi = [
    'content.js',        // chi raccoglie
    'background.js',     // chi decide
    'PSL',               // come nasce il dominio registrabile
    'storage.session',   // come arriva al popup
    'identity',          // le categorie
    'credentials'
  ];

  for (const passaggio of passaggi) {
    assert.ok(readme.includes(passaggio), `il README non nomina "${passaggio}"`);
    assert.ok(builder.includes(passaggio), `il generatore della pagina non nomina "${passaggio}"`);
  }
});

test('la pagina pubblicata è allineata con il suo generatore', () => {
  // `pages.yml` lo segnala già nel sommario del job, ma solo dopo il push:
  // qui fallisce prima, in locale.
  const conteggioPassi = (page.match(/class="flow__step"/g) || []).length;
  const passiDichiarati = (builder.match(/^\s{4}title: '/gm) || []).length;
  assert.equal(conteggioPassi, passiDichiarati,
    `la pagina ha ${conteggioPassi} passi ma il generatore ne dichiara ${passiDichiarati}: rigenera con \`npm run page\``);
});
