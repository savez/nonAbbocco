#!/usr/bin/env node
/**
 * Costruisce gli archivi da caricare sugli store.
 *
 *   node tools/package.mjs              # entrambi i browser
 *   node tools/package.mjs --chrome     # solo Chrome Web Store
 *   node tools/package.mjs --firefox    # solo Firefox AMO
 *   node tools/package.mjs --skip-tests # salta la suite (sconsigliato)
 *
 * Produce in `dist/`:
 *   nonabbocco-<versione>-chrome.zip
 *   nonabbocco-<versione>-firefox.zip
 *
 * ─── PERCHÉ DUE ARCHIVI DIVERSI ──────────────────────────────────────────────
 *
 * Il manifest non può essere identico:
 *
 *   - Firefox MV3 NON supporta `background.service_worker` e usa
 *     `background.scripts`; Chrome fa l'opposto. Un manifest che dichiara
 *     entrambe le chiavi funziona in locale perché ogni browser ignora quella
 *     dell'altro, ma la validazione degli store si lamenta della chiave
 *     estranea. Qui ogni archivio riceve solo la propria.
 *   - `browser_specific_settings` serve a Firefox per firmare l'estensione e
 *     non ha alcun significato per Chrome, che la segnala come chiave ignota.
 *
 * ─── COSA NON ENTRA NEGLI ARCHIVI ────────────────────────────────────────────
 *
 * Solo i file che l'estensione carica davvero a runtime. Restano fuori test,
 * strumenti, documentazione, la pagina di progetto e la configurazione di
 * sviluppo: aumenterebbero il peso, allargherebbero la superficie di revisione
 * e, nel caso della pagina di progetto, verrebbero pubblicati per errore.
 */

import { readFile, writeFile, rm, mkdir, cp, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const staging = join(dist, '.staging');

const args = process.argv.slice(2);
const only = args.includes('--chrome') ? ['chrome']
  : args.includes('--firefox') ? ['firefox']
  : ['chrome', 'firefox'];
const skipTests = args.includes('--skip-tests');

/**
 * I file e le cartelle che finiscono nell'archivio.
 * Ogni voce va aggiunta consapevolmente: l'omissione di un file caricato a
 * runtime produce un'estensione rotta che passa la validazione dello store.
 */
const SHIPPED = [
  'manifest.json',
  'content.js',
  'background.js',
  'background.html',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js',
  'src',
  'icons'
];

/**
 * File che riguardano un browser solo. `background.html` è la porta d'ingresso
 * del background per Firefox: il manifest di Chrome non la nomina nemmeno, e
 * spedirla lì significherebbe dare in revisione un file che l'estensione non
 * carica mai.
 */
const ONLY_FOR = {
  'background.html': 'firefox'
};

/** Non entrano mai, nemmeno se dentro una cartella spedita. */
const NEVER_SHIP = [
  /(^|\/)\./,                    // file nascosti
  /(^|\/)node_modules(\/|$)/,
  /\.test\.js$/,
  /(^|\/)(test|tools|docs|dist)(\/|$)/,
  /(^|\/)simulator\.html$/,      // la pagina di progetto non è parte dell'estensione
  /(^|\/)(README|CONTRIBUTING|SECURITY|CHANGELOG)\.md$/,
  /(^|\/)(package|package-lock|release-please-config)\.json$/,
  /\.(zip|xpi|crx|pem|key|env)$/
];

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`
};

const problems = [];
const fail = (msg) => problems.push(msg);

// ─── Pre-volo ────────────────────────────────────────────────────────────────

console.log(c.bold('\nNonAbbocco — costruzione degli archivi per gli store\n'));

// 1. `zip` disponibile?
try {
  await run('zip', ['-v']);
} catch {
  console.error(c.err('Serve il comando `zip`, che non risulta installato.'));
  console.error(c.dim('  macOS e Linux lo hanno di serie; su Windows usa WSL o installa Info-ZIP.'));
  process.exit(1);
}

// 2. Il manifest e la versione.
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = manifest.version;

console.log(`  versione: ${c.bold(version)}`);

if (manifest.version !== pkg.version) {
  fail(`manifest.json dice ${manifest.version} e package.json dice ${pkg.version}. ` +
       'Le versioni le allinea release-please: non modificarle a mano.');
}
if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  fail(`la versione "${version}" non è accettata dagli store: solo cifre e punti, ` +
       'niente suffissi come -beta o -dev.');
}

// 3. Gli store richiedono le icone. Senza, il caricamento viene rifiutato.
if (!manifest.icons || !Object.keys(manifest.icons).length) {
  fail('manifest.json non dichiara `icons`. Entrambi gli store rifiutano un\'estensione senza icone: ' +
       'servono almeno 48x48 e 128x128.');
}

// 4. Ogni file che il manifest nomina deve esistere.
const referenced = [
  ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
  ...(manifest.background?.scripts || []),
  manifest.background?.service_worker,
  manifest.background?.page,
  manifest.options_ui?.page,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...(manifest.web_accessible_resources || []).flatMap((w) => w.resources || [])
].filter(Boolean);

for (const file of referenced) {
  if (!existsSync(join(root, file))) fail(`manifest.json referenzia "${file}", che non esiste.`);
}

// 5. Nessun segreto negli archivi. Il repo è pubblico e la chiave Safe
//    Browsing è "bring your own key": se ne trovassimo una committata,
//    finirebbe pubblicata su due store.
const SECRET_PATTERNS = [
  [/AIza[0-9A-Za-z_-]{35}/, 'una chiave API Google'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'una chiave privata'],
  [/\b(api[_-]?key|apikey|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i, 'un segreto assegnato a una costante']
];

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(base, full);
    if (NEVER_SHIP.some((re) => re.test(rel))) continue;
    if (entry.isDirectory()) out.push(...await walk(full, base));
    else out.push(rel);
  }
  return out;
}

const shippedFiles = [];
for (const item of SHIPPED) {
  const full = join(root, item);
  if (!existsSync(full)) { fail(`"${item}" è nell'elenco dei file da spedire ma non esiste.`); continue; }
  const info = await stat(full);
  if (info.isDirectory()) shippedFiles.push(...(await walk(full, root)).map((f) => f));
  else shippedFiles.push(item);
}

for (const file of shippedFiles) {
  if (!/\.(js|json|html|css)$/.test(file)) continue;
  const text = await readFile(join(root, file), 'utf8');
  for (const [re, what] of SECRET_PATTERNS) {
    if (re.test(text)) fail(`${file} sembra contenere ${what}. Non può finire in un archivio pubblicato.`);
  }
}

// 6. La suite di test. Un motore rotto non va sugli store.
if (skipTests) {
  console.log(c.warn('  test: SALTATI su richiesta'));
} else {
  process.stdout.write('  test: ');
  try {
    await run('node', ['--test'], { cwd: root });
    console.log(c.ok('verdi'));
  } catch (e) {
    console.log(c.err('FALLITI'));
    console.log(c.dim((e.stdout || '').split('\n').filter((l) => /^not ok|error:/.test(l)).slice(0, 10).join('\n')));
    fail('la suite di test non passa. Correggi prima di pubblicare, o usa --skip-tests se sai cosa stai facendo.');
  }
}

if (problems.length) {
  console.error(c.err(`\n${problems.length} problema${problems.length > 1 ? 'i' : ''} da risolvere prima di pubblicare:\n`));
  for (const p of problems) console.error(c.err('  ✗ ') + p);
  console.error('');
  process.exit(1);
}

// ─── Costruzione ─────────────────────────────────────────────────────────────

/**
 * Il manifest specifico per un browser: rimuove le chiavi che l'altro
 * userebbe e che la validazione dello store segnalerebbe come estranee.
 *
 * Il `background` è il punto in cui i due browser divergono di più:
 *
 *   - Chrome MV3 conosce solo `service_worker`, e vuole `type: "module"`
 *     accanto per caricarlo come modulo ES.
 *   - Firefox non supporta affatto i service worker e non supporta ancora
 *     `type: "module"` su `background.scripts` (bug 1811443). Usa quindi
 *     `page`, dove la modularità sta nel tag `<script type="module">` dentro
 *     l'HTML: `type` nel manifest non gli serve e sarebbe una chiave estranea.
 *
 * Il manifest non pacchettizzato le dichiara tutte e tre, così durante lo
 * sviluppo la stessa cartella si carica in entrambi i browser. Agli store
 * arriva solo la metà che li riguarda.
 */
function manifestFor(target) {
  const m = structuredClone(manifest);

  if (target === 'chrome') {
    delete m.browser_specific_settings;
    if (m.background) {
      delete m.background.scripts;
      delete m.background.page;
      if (!m.background.service_worker) delete m.background;
    }
  } else {
    if (m.background) {
      delete m.background.service_worker;
      delete m.background.type;
      if (!m.background.scripts && !m.background.page) delete m.background;
    }
  }
  return m;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const built = [];

for (const target of only) {
  const dir = join(staging, target);
  await mkdir(dir, { recursive: true });

  for (const item of SHIPPED) {
    if (item === 'manifest.json') continue;
    if (ONLY_FOR[item] && ONLY_FOR[item] !== target) continue;
    await cp(join(root, item), join(dir, item), {
      recursive: true,
      filter: (src) => {
        const rel = relative(root, src);
        return rel === '' || !NEVER_SHIP.some((re) => re.test(rel));
      }
    });
  }

  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifestFor(target), null, 2) + '\n', 'utf8');

  const name = `nonabbocco-${version}-${target}.zip`;
  // -r ricorsivo, -q silenzioso, -X senza metadati specifici della piattaforma
  // (gli attributi macOS renderebbero l'archivio non riproducibile).
  await run('zip', ['-r', '-q', '-X', join(dist, name), '.'], { cwd: dir });

  const size = (await stat(join(dist, name))).size;
  const files = (await walk(dir, dir)).length + 1;
  built.push({ target, name, size, files });
}

await rm(staging, { recursive: true, force: true });

// ─── Esito ───────────────────────────────────────────────────────────────────

console.log(c.ok('\n  Archivi pronti in dist/\n'));
for (const b of built) {
  console.log(`    ${c.bold(b.name)}`);
  console.log(c.dim(`      ${b.files} file · ${(b.size / 1024).toFixed(1)} KB`));
}

console.log(c.bold('\n  Dove caricarli\n'));
if (built.some((b) => b.target === 'chrome')) {
  console.log('    Chrome   https://chrome.google.com/webstore/devconsole');
}
if (built.some((b) => b.target === 'firefox')) {
  console.log('    Firefox  https://addons.mozilla.org/developers/addon/submit/distribution');
  console.log(c.dim('             Firefox firma l\'archivio: l\'id in browser_specific_settings.gecko.id'));
  console.log(c.dim(`             è ${manifest.browser_specific_settings?.gecko?.id ?? 'NON IMPOSTATO'} e non va più cambiato.`));
}

console.log(c.bold('\n  Da preparare a mano per la scheda dello store\n'));
console.log(c.dim('    · icone 48x48 e 128x128 dichiarate nel manifest'));
console.log(c.dim('    · screenshot 1280x800 dell\'interstiziale e delle opzioni'));
console.log(c.dim('    · giustificazione dei permessi: entrambi gli store la chiedono per <all_urls>.'));
console.log(c.dim('      Motivazione vera: il controllo anti-phishing deve valutare qualunque pagina'));
console.log(c.dim('      l\'utente apra, perché il phishing non vive su domini noti in anticipo.'));
console.log(c.dim('    · informativa privacy: l\'analisi è locale; Safe Browsing è opzionale e a chiave'));
console.log(c.dim('      dell\'utente. Dichiaralo, perché entrambi gli store lo verificano.'));
console.log('');
