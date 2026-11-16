// SPIKE USA E GETTA — non è codice di produzione (vedi REPORT.md, «Provenienza»).
// Nucleo condiviso fra eval.mjs (Node) e index.html (browser): codifica delle
// domande per d1-omni-600M (solo testo) e lettura delle probabilità.
// Non dipende da onnxruntime: riceve il tokenizer e una funzione `run`.

const D = { state: '<|reserved_7|>', q: '<|reserved_8|>', opt: '<|reserved_9|>', optEnd: '<|reserved_10|>', decide: '<|reserved_11|>' };
const MARKER = '<|mask|>';

export const PHISHING = {
  type: 'noul', name: 'phishing',
  instructions: 'Is this web page a phishing page that tries to steal credentials, payments or personal data?',
  criteria: {
    true: 'yes, the page imitates another brand or tricks visitors into giving credentials, payments or personal data',
    false: 'no, it is the genuine website of the organisation or an ordinary legitimate page',
  },
};

export const CATEGORY = {
  type: 'choice', name: 'category',
  instructions: 'What kind of service does this web page belong to?',
  criteria: {
    banca: 'bank, credit institution or home banking',
    pagamenti: 'payment service, card or digital wallet',
    'e-commerce': 'online shop or marketplace',
    social: 'social network or messaging',
    posta: 'email or webmail',
    'pubblica-amministrazione': 'government, tax or public administration',
    spedizioni: 'courier, parcel delivery or postal service',
    altro: 'none of the above',
  },
};

const dumps = (x) => {
  if (x === null || x === undefined) return 'null';
  if (Array.isArray(x)) return '[' + x.map(dumps).join(', ') + ']';
  if (typeof x === 'object') return '{' + Object.entries(x).map(([k, v]) => JSON.stringify(k) + ': ' + dumps(v)).join(', ') + '}';
  return JSON.stringify(x);
};

const nOpt = (q) => (q.type === 'noul' ? 2 : Object.keys(q.criteria).length);
const tkey = (q) => { const k = nOpt(q); return `${q.type}:` + (k <= 2 ? '2' : k <= 5 ? '3-5' : k <= 10 ? '6-10' : '11+'); };
const softmax = (z) => { const m = Math.max(...z); const e = z.map((v) => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((v) => v / s); };

/** @returns {{ids:number[], markers:number[]}} */
export function encode(tok, config, state, q) {
  const one = (s) => {
    const ids = tok.encode(s, { add_special_tokens: false });
    if (ids.length !== 1) throw new Error(`non è un solo token: ${s}`);
    return ids[0];
  };
  const esc = (t) => t.replace(/<\|([A-Za-z0-9_]+)\|>/g, '<¦$1¦>');
  const enc = (s) => tok.encode(esc(s), { add_special_tokens: false });
  const MAX_LEN = config.max_length;
  const opts = q.type === 'noul'
    ? ['false: ' + q.criteria.false, 'true: ' + q.criteria.true]
    : Object.entries(q.criteria).map(([k, v]) => `${k}: ${v}`);
  const budget = Math.max(96, Math.min(opts.length * 24 + 32, Math.floor(MAX_LEN / 2)));
  const per = Math.max(2, Math.floor((budget - 3 * opts.length) / opts.length));
  let question = [one(D.q), ...enc(q.instructions)].slice(0, Math.max(16, budget));
  let markers = [];
  for (const text of opts) {
    markers.push(question.length + 1);
    question = question.concat([one(D.opt), one(MARKER)], enc(' ' + text).slice(0, per), [one(D.optEnd)]);
  }
  question.push(one(D.decide));
  const room = Math.max(0, MAX_LEN - question.length - 2);
  const stateIds = [one(D.state), ...enc(dumps(state)).slice(0, room)];
  const ids = [tok.bos_token_id ?? 1, ...stateIds, ...question].slice(0, MAX_LEN);
  markers = markers.map((m) => m + 1 + stateIds.length);
  return { ids, markers };
}

/**
 * @param run  async ({ids, markers, qtype}) => Float32Array con i logit delle opzioni
 * @returns probabilità per opzione; per `noul` p[0] = P(vero)
 */
export async function decide(tok, config, run, state, q) {
  const { ids, markers } = encode(tok, config, state, q);
  const logits = await run({ ids, markers, qtype: { choice: 0, score: 1, noul: 2 }[q.type] });
  const t = (config.temperatures ?? {})[tkey(q)] ?? 1;
  let p = softmax(Array.from(logits.slice(0, nOpt(q))).map((v) => v / t));
  if (q.type === 'noul') p = p.reverse(); // il modello legge [falso, vero]
  return p;
}

/** Le due domande del piano per una pagina. */
export async function classify(tok, config, run, state) {
  const pp = await decide(tok, config, run, state, PHISHING);
  const pc = await decide(tok, config, run, state, CATEGORY);
  const names = Object.keys(CATEGORY.criteria);
  const best = pc.indexOf(Math.max(...pc));
  return { phishing: pp[0], category: names[best], categoryConfidence: pc[best] };
}
