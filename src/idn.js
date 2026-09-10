/**
 * Analisi dei nomi di dominio internazionalizzati (IDN).
 *
 * Serve a distinguere due cose che il motore storico confondeva: un dominio
 * IDN legittimo e un attacco omografo. La regola storica dava +40 punti alla
 * sola presenza di `xn--` nell'hostname, quindi penalizzava qualunque dominio
 * scritto in greco, cirillico, arabo o cinese — cioè un pezzo consistente del
 * web non anglofono — senza guardare se somigliasse a qualcosa.
 *
 * Qui il segnale nasce solo da due condizioni verificabili:
 *
 *   1. MIXED-SCRIPT DENTRO UNA SINGOLA LABEL. Un dominio interamente in
 *      cirillico è normale; una label che mescola latino e cirillico quasi
 *      mai lo è, perché non serve a nessuna lingua reale — serve a far
 *      sembrare latino qualcosa che non lo è.
 *   2. COLLISIONE DI SKELETON CON UN MARCHIO. Normalizzando i caratteri
 *      confondibili verso il loro equivalente ASCII, `аррӏе` diventa `apple`.
 *      Se lo skeleton coincide con un marchio noto ma il dominio non è suo,
 *      è un attacco.
 *
 * Il decoder punycode è scritto qui perché non esiste una funzione built-in
 * per decodificare: `new URL()` produce la forma punycode, non la riporta a
 * Unicode. È l'implementazione di RFC 3492.
 */

// ─── Punycode (RFC 3492) ─────────────────────────────────────────────────────

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = '-';

function decodeDigit(code) {
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26; // '0'-'9' → 26..35
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;      // 'a'-'z' → 0..25
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;      // 'A'-'Z' → 0..25
  return BASE;
}

function adapt(delta, numPoints, firstTime) {
  let d = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) / 2) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/**
 * Decodifica una singola label punycode (senza il prefisso `xn--`).
 * Restituisce null se la label non è punycode valido.
 *
 * @param {string} input
 * @returns {string|null}
 */
export function punycodeDecode(input) {
  const output = [];
  const delimiterIndex = input.lastIndexOf(DELIMITER);

  if (delimiterIndex > 0) {
    for (let i = 0; i < delimiterIndex; i++) {
      const code = input.charCodeAt(i);
      if (code >= 0x80) return null; // la parte letterale deve essere ASCII
      output.push(input[i]);
    }
  }

  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  let index = delimiterIndex > 0 ? delimiterIndex + 1 : 0;

  while (index < input.length) {
    const oldI = i;
    let w = 1;

    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) return null;
      const digit = decodeDigit(input.charCodeAt(index++));
      if (digit >= BASE) return null;
      if (digit > Math.floor((0x7fffffff - i) / w)) return null; // overflow
      i += digit * w;

      const t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
      if (digit < t) break;
      if (w > Math.floor(0x7fffffff / (BASE - t))) return null; // overflow
      w *= BASE - t;
    }

    const outLength = output.length + 1;
    bias = adapt(i - oldI, outLength, oldI === 0);

    if (Math.floor(i / outLength) > 0x7fffffff - n) return null;
    n += Math.floor(i / outLength);
    i %= outLength;

    if (n > 0x10ffff) return null;
    output.splice(i, 0, String.fromCodePoint(n));
    i++;
  }

  return output.join('');
}

/**
 * Riporta un hostname punycode alla sua forma Unicode, label per label.
 * Le label non punycode restano invariate.
 *
 * @param {string} hostname
 * @returns {string}
 */
export function toUnicode(hostname) {
  return String(hostname || '')
    .split('.')
    .map((label) => {
      if (!label.toLowerCase().startsWith('xn--')) return label;
      const decoded = punycodeDecode(label.slice(4));
      return decoded === null ? label : decoded;
    })
    .join('.');
}

// ─── Rilevamento degli script Unicode ────────────────────────────────────────

/**
 * Intervalli sufficienti a rispondere alla domanda che ci interessa: questa
 * label mescola sistemi di scrittura? Non è una classificazione Unicode
 * completa, e non deve esserlo.
 */
const SCRIPT_RANGES = [
  ['Latin', /[A-Za-zÀ-ɏḀ-ỿ]/],
  ['Greek', /[Ͱ-Ͽἀ-῿]/],
  ['Cyrillic', /[Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/],
  ['Armenian', /[԰-֏]/],
  ['Hebrew', /[֐-׿]/],
  ['Arabic', /[؀-ۿݐ-ݿࢠ-ࣿ]/],
  ['Devanagari', /[ऀ-ॿ]/],
  ['Bengali', /[ঀ-৿]/],
  ['Thai', /[฀-๿]/],
  ['Hangul', /[ᄀ-ᇿ㄰-㆏가-힯]/],
  ['Han', /[㐀-䶿一-鿿豈-﫿]/],
  ['Kana', /[぀-ゟ゠-ヿ]/]
];

// Caratteri che non appartengono a nessuno script: cifre, trattino, simboli
// comuni. Non contano nel giudizio di mixed-script.
const SCRIPT_NEUTRAL = /[0-9-_ -,.-/:-@]/;

/**
 * Gli script presenti in una stringa.
 * @param {string} text
 * @returns {Set<string>}
 */
export function scriptsIn(text) {
  const found = new Set();
  for (const ch of String(text || '')) {
    if (SCRIPT_NEUTRAL.test(ch)) continue;
    for (const [name, re] of SCRIPT_RANGES) {
      if (re.test(ch)) {
        found.add(name);
        break;
      }
    }
  }
  return found;
}

/**
 * Vero se una singola label mescola più sistemi di scrittura.
 *
 * Attenzione al motivo per cui il controllo è PER LABEL e non sull'hostname
 * intero: un hostname come `банк.example.com` mescola cirillico e latino fra
 * label diverse in modo perfettamente legittimo (il dominio è latino, il
 * sottodominio cirillico). Ciò che non ha usi legittimi è mescolarli DENTRO
 * la stessa parola.
 *
 * @param {string} label già in forma Unicode
 * @returns {boolean}
 */
export function isMixedScriptLabel(label) {
  return scriptsIn(label).size > 1;
}

// ─── Skeleton dei confondibili ───────────────────────────────────────────────

/**
 * Mappa dei caratteri che a occhio nudo passano per lettere ASCII.
 * Sottoinsieme curato di UTS #39: copre cirillico, greco, armeno, le forme
 * fullwidth e i caratteri matematici, che sono i vettori realistici contro i
 * nomi di marchio.
 */
const CONFUSABLES = new Map(Object.entries({
  // Cirillico
  'а': 'a', 'б': 'b', 'в': 'b', 'г': 'r', 'д': 'd', 'е': 'e', 'ж': 'x',
  'з': '3', 'и': 'u', 'й': 'u', 'к': 'k', 'л': 'n', 'м': 'm', 'н': 'h',
  'о': 'o', 'п': 'n', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'ф': 'o',
  'х': 'x', 'ц': 'u', 'ч': 'h', 'ш': 'w', 'щ': 'w', 'ъ': 'b', 'ы': 'bi',
  'ь': 'b', 'э': 'e', 'ю': 'io', 'я': 'r', 'ѕ': 's', 'і': 'i', 'ј': 'j',
  'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ӏ': 'l', 'ѐ': 'e', 'ё': 'e',
  // Greco
  'α': 'a', 'β': 'b', 'γ': 'y', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'n',
  'θ': 'o', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'u', 'ν': 'v', 'ξ': 'e',
  'ο': 'o', 'π': 'n', 'ρ': 'p', 'σ': 'o', 'τ': 't', 'υ': 'u', 'φ': 'o',
  'χ': 'x', 'ψ': 'w', 'ω': 'w', 'ϲ': 'c', 'ϳ': 'j', 'ϱ': 'p',
  'Α': 'a', 'Β': 'b', 'Ε': 'e', 'Ζ': 'z', 'Η': 'h', 'Ι': 'i', 'Κ': 'k',
  'Μ': 'm', 'Ν': 'n', 'Ο': 'o', 'Ρ': 'p', 'Τ': 't', 'Υ': 'y', 'Χ': 'x',
  // Armeno
  'ա': 'w', 'գ': 'q', 'ի': 'h', 'ո': 'n', 'օ': 'o', 'ս': 'u', 'ց': 'g',
  'ԛ': 'q', 'ղ': 'n', 'յ': 'j', 'պ': 'y', 'ք': 'p',
  // Latino con diacritici o forme alternative
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ā': 'a',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ī': 'i', 'ı': 'i',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'ō': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ū': 'u',
  'ç': 'c', 'ć': 'c', 'č': 'c', 'ñ': 'n', 'ń': 'n', 'š': 's', 'ś': 's',
  'ž': 'z', 'ź': 'z', 'ý': 'y', 'ÿ': 'y', 'ł': 'l', 'ð': 'd', 'þ': 'p',
  'ƅ': 'b', 'ɡ': 'g', 'ɩ': 'l', 'ʏ': 'y', 'ʋ': 'v',
  // Fullwidth
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g',
  'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n',
  'ｏ': 'o', 'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't', 'ｕ': 'u',
  'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z',
  // Cifre confondibili con lettere: è così che si fa "paypa1" o "g00gle"
  '1': 'l', '0': 'o', '5': 's', '@': 'a'
}));

/**
 * Riduce una stringa alla sua forma "scheletro": tutto ciò che somiglia a una
 * lettera ASCII diventa quella lettera. Serve per confrontare l'apparenza di
 * un dominio con quella di un marchio.
 *
 * @param {string} text
 * @returns {string}
 */
export function skeleton(text) {
  let out = '';
  for (const ch of String(text || '').toLowerCase()) {
    out += CONFUSABLES.get(ch) ?? ch;
  }
  return out;
}
