/**
 * Dalle domande ai token, e dai logit alle probabilità.
 *
 * Port in JavaScript del `prompt.py` di LiquidAI/d1-omni-600M
 * (https://huggingface.co/LiquidAI/d1-omni-600M), © Liquid AI, Inc., sotto
 * LFM Open License v1.0. Modifiche: riscritto in JavaScript, limitato alle
 * domande `noul` (sì/no) e `choice` (scelta), senza i percorsi per audio e
 * immagini; il tokenizer è iniettato. Vedi NOTICE.md.
 *
 * Ogni domanda diventa una sequenza:
 *
 *   <bos> <state> stato <q> istruzioni <opt> <mask> opzione_0 </opt> ... <decide>
 *
 * Il modello legge lo stato nascosto in corrispondenza di ogni `<mask>` e fa
 * il softmax sulle opzioni. I delimitatori sono token riservati, e ogni
 * `<|...|>` nel testo del chiamante viene riscritto, così uno stato non può
 * mai fabbricarne uno.
 */

const DELIM = {
  state: '<|reserved_7|>',
  q: '<|reserved_8|>',
  opt: '<|reserved_9|>',
  optEnd: '<|reserved_10|>',
  decide: '<|reserved_11|>'
};
const MARKER = '<|mask|>';

/**
 * @typedef {{ encode(text: string, opts: { add_special_tokens: false }): number[], bos_token_id?: number }} Tokenizer
 * @typedef {{ max_length?: number, temperatures?: Record<string, number> }} ModelConfig
 * @typedef {{ type: 'noul' | 'choice', instructions: string, criteria: Record<string, string> }} Question
 */

/** `<|nome|>` → `<¦nome¦>`: il testo del chiamante non può emettere un delimitatore. */
export function escapeSpecial(text) {
  return text.replace(/<\|([A-Za-z0-9_]+)\|>/g, '<¦$1¦>');
}

/** Come `json.dumps(x, ensure_ascii=False)`: separatori «, » e «: ». */
function pyJson(x) {
  if (x === null || x === undefined) return 'null';
  if (Array.isArray(x)) return '[' + x.map(pyJson).join(', ') + ']';
  if (typeof x === 'object') {
    return '{' + Object.entries(x).map(([k, v]) => JSON.stringify(k) + ': ' + pyJson(v)).join(', ') + '}';
  }
  return JSON.stringify(x);
}

const serialize = (state) => (typeof state === 'string' ? state : pyJson(state));

/** Il testo delle opzioni, nell'ordine del modello. Un `noul` si legge come [falso, vero]. */
function renderOptions(q) {
  if (q.type === 'choice') {
    return Object.entries(q.criteria).map(([k, v]) => (v ? `${k}: ${v}` : k));
  }
  if (q.type === 'noul') {
    const { true: yes, false: no } = q.criteria ?? {};
    return [
      'false: ' + (no || 'no, the statement does not hold'),
      'true: ' + (yes || 'yes, the statement holds')
    ];
  }
  throw new Error(`tipo di domanda non supportato: ${q.type}`);
}

const nOptions = (q) => renderOptions(q).length;

function temperatureKey(q) {
  const k = nOptions(q);
  return `${q.type}:` + (k <= 2 ? '2' : k <= 5 ? '3-5' : k <= 10 ? '6-10' : '11+');
}

/**
 * Gli id di una domanda su uno stato, e la posizione del marcatore di ogni opzione.
 *
 * Il blocco delle opzioni ha max(96, min(24k + 32, max_len / 2)) token, divisi
 * in parti uguali; lo stato si taglia a destra a quello che resta.
 *
 * @param {Tokenizer} tok
 * @param {ModelConfig} config
 * @param {object | string} state
 * @param {Question} q
 * @returns {{ ids: number[], markers: number[] }}
 */
export function encodeQuestion(tok, config, state, q) {
  const maxLen = config.max_length ?? 16384;
  const perOption = 24;

  const one = (token) => {
    const ids = tok.encode(token, { add_special_tokens: false });
    if (ids.length !== 1) throw new Error(`il tokenizer non riconosce il token speciale ${token}`);
    return ids[0];
  };
  const enc = (text) => tok.encode(escapeSpecial(text), { add_special_tokens: false });

  const opts = renderOptions(q);
  const budget = Math.max(96, Math.min(opts.length * perOption + 32, Math.floor(maxLen / 2)));
  const per = Math.max(2, Math.floor((budget - 3 * opts.length) / opts.length));

  let question = [one(DELIM.q), ...enc(q.instructions)].slice(0, Math.max(16, budget));
  let markers = [];
  for (const text of opts) {
    markers.push(question.length + 1);
    question = question.concat([one(DELIM.opt), one(MARKER)], enc(' ' + text).slice(0, per), [one(DELIM.optEnd)]);
  }
  question.push(one(DELIM.decide));

  const room = Math.max(0, maxLen - question.length - 2);
  const stateIds = [one(DELIM.state), ...enc(serialize(state)).slice(0, room)];
  const ids = [tok.bos_token_id ?? 1, ...stateIds, ...question].slice(0, maxLen);
  markers = markers.map((m) => m + 1 + stateIds.length);

  if (markers[markers.length - 1] >= maxLen) {
    throw new Error('le opzioni non entrano nel contesto del modello');
  }
  return { ids, markers };
}

const softmax = (z) => {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
};

/**
 * Dai logit del modello alle probabilità, con la temperatura di calibrazione
 * del config. Per un `noul` il modello restituisce [falso, vero]: qui torna
 * [vero, falso], quindi `p[0]` è la probabilità del sì.
 *
 * @param {ArrayLike<number>} logits
 * @param {Question} q
 * @param {ModelConfig} config
 * @returns {number[]}
 */
export function readProbabilities(logits, q, config) {
  const temperature = (config.temperatures ?? {})[temperatureKey(q)] ?? 1;
  const z = Array.from(logits).slice(0, nOptions(q)).map((v) => v / temperature);
  const p = softmax(z);
  return q.type === 'noul' ? p.reverse() : p;
}
