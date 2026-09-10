#!/usr/bin/env node
/**
 * Rigenera `src/psl-data.js` dalla Public Suffix List upstream.
 *
 *   node tools/update-psl.mjs
 *
 * Perché la PSL serve: senza di essa non si può sapere qual è il *dominio
 * registrabile* di un hostname. `amazon.co.uk` è un dominio, `co.uk` no; e
 * tutte le regole sui marchi confrontano il registrabile, non l'hostname
 * intero. Senza PSL il confronto degenera in una ricerca per sottostringa,
 * che è esattamente il difetto storico per cui `posteitaliane.it` risultava
 * un'imitazione di Poste.
 *
 * CRITERIO DI INCLUSIONE — entrambe le sezioni, complete.
 *
 * Non riduciamo la lista. Una PSL ridotta è essa stessa una sorgente di falsi
 * positivi: una voce mancante sbaglia il registrabile proprio sulla coda lunga
 * dei ccTLD multi-livello (.co.uk, .com.br, .gov.it), e ridurre "per
 * popolarità" è il criterio sbagliato perché il phishing vive nella coda.
 *
 * Le due sezioni restano DISTINTE, e non è un dettaglio: con la sezione
 * PRIVATE, `evil.pages.dev` e `buono.pages.dev` sono domini registrabili
 * diversi — corretto per attribuire il phishing ospitato su hosting gratuito.
 * Ma è sbagliato per la domanda "questo è un sottodominio del marchio?".
 * Perciò non scegliamo globalmente: esponiamo la sezione come segnale e ogni
 * regola decide quale usare.
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCE = 'https://publicsuffix.org/list/public_suffix_list.dat';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'psl-data.js');

const ICANN_BEGIN = '// ===BEGIN ICANN DOMAINS===';
const ICANN_END = '// ===END ICANN DOMAINS===';
const PRIVATE_BEGIN = '// ===BEGIN PRIVATE DOMAINS===';
const PRIVATE_END = '// ===END PRIVATE DOMAINS===';

function parse(text) {
  const sections = { icann: [], private: [] };
  let current = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === ICANN_BEGIN) { current = 'icann'; continue; }
    if (line === PRIVATE_BEGIN) { current = 'private'; continue; }
    if (line === ICANN_END || line === PRIVATE_END) { current = null; continue; }
    if (!current || !line || line.startsWith('//')) continue;
    sections[current].push(line.toLowerCase());
  }

  if (!sections.icann.length) throw new Error('sezione ICANN vuota: formato upstream cambiato?');
  if (!sections.private.length) throw new Error('sezione PRIVATE vuota: formato upstream cambiato?');
  return sections;
}

/**
 * Separa i tre tipi di regola della specifica PSL:
 *   - normali:   "com", "co.uk"
 *   - wildcard:  "*.ck"      → una label qualsiasi al posto di *
 *   - eccezioni: "!www.ck"   → esclude dal wildcard
 */
function classify(rules) {
  const normal = [];
  const wildcard = [];
  const exception = [];
  for (const rule of rules) {
    if (rule.startsWith('!')) exception.push(rule.slice(1));
    else if (rule.startsWith('*.')) wildcard.push(rule.slice(2));
    else normal.push(rule);
  }
  return { normal, wildcard, exception };
}

const arr = (values) =>
  values.length ? `[\n  ${values.map((v) => JSON.stringify(v)).join(',\n  ')}\n]` : '[]';

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`download della PSL non riuscito: HTTP ${response.status}`);
const text = await response.text();

const sections = parse(text);
const icann = classify(sections.icann);
const priv = classify(sections.private);

const total = sections.icann.length + sections.private.length;

const out = `/**
 * GENERATO AUTOMATICAMENTE — NON MODIFICARE A MANO.
 *
 * Rigenera con:  node tools/update-psl.mjs
 * Fonte:         ${SOURCE}
 * Regole:        ${sections.icann.length} ICANN + ${sections.private.length} PRIVATE = ${total}
 *
 * La logica di lookup NON sta qui: sta in src/psl.js, scritto a mano. Qui ci
 * sono solo i dati, così che rigenerarli non possa mai riscrivere del codice.
 */

export const ICANN = {
  normal: ${arr(icann.normal)},
  wildcard: ${arr(icann.wildcard)},
  exception: ${arr(icann.exception)}
};

export const PRIVATE = {
  normal: ${arr(priv.normal)},
  wildcard: ${arr(priv.wildcard)},
  exception: ${arr(priv.exception)}
};
`;

await writeFile(OUT, out, 'utf8');

console.log(`Scritto ${OUT}`);
console.log(`  ICANN   : ${icann.normal.length} normali, ${icann.wildcard.length} wildcard, ${icann.exception.length} eccezioni`);
console.log(`  PRIVATE : ${priv.normal.length} normali, ${priv.wildcard.length} wildcard, ${priv.exception.length} eccezioni`);
