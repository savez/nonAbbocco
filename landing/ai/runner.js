/**
 * Il modello nel browser. È l'unico file di `landing/ai/` che fa rete.
 *
 * Niente parte finché non si chiama `load()`, e `load()` si chiama solo dopo
 * il consenso del visitatore. Senza WebGPU non scarica nulla: lancia prima.
 *
 * Le librerie arrivano da una CDN con versione fissata (`models.js`) e si
 * importano dentro `load()`: questo modulo si può importare ovunque, anche in
 * Node, senza toccare la rete.
 *
 * I file del modello restano nella Cache API: la seconda visita non riscarica.
 */

import { MODEL, ORT_URL, ORT_BASE, TRANSFORMERS_URL, HF_BASE, CACHE_NAME } from './models.js';
import { encodeQuestion, readProbabilities } from './encode.js';
import { isWebGpuAvailable } from './support.js';

const GRAPH = `onnx/${MODEL.file}.onnx`;
const WEIGHTS = `onnx/${MODEL.file}.onnx_data`;
const MODEL_FILES = ['config.json', GRAPH, WEIGHTS];

/** Il modello è già nella cache del browser? (Il tokenizer, 5 MB, ha la cache sua.) */
export async function isModelCached() {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(CACHE_NAME);
    for (const path of MODEL_FILES) if (!(await cache.match(HF_BASE + path))) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ onProgress?: (p: { loadedMB: number, totalMB: number }) => void }} [opts]
 */
export function createRunner({ onProgress = () => {} } = {}) {
  let session = null;
  let tokenizer = null;
  let config = null;
  let ort = null;
  let abort = null;
  let loading = false;
  let loadedBytes = 0;

  const report = () => onProgress({ loadedMB: loadedBytes / 1e6, totalMB: MODEL.approxMB });

  async function fetchCached(path, signal) {
    const url = HF_BASE + path;
    let cache = null;
    try {
      cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) {
        const cached = new Uint8Array(await hit.arrayBuffer());
        loadedBytes += cached.length;
        report();
        return cached;
      }
    } catch { /* senza Cache API si scarica e basta */ }

    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);

    // Con la lunghezza nota si riempie un buffer solo, senza copiare 244 MB due volte.
    const length = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let buf = length ? new Uint8Array(length) : null;
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (buf && got + value.length <= buf.length) buf.set(value, got);
      else {
        if (buf) { chunks.push(buf.subarray(0, got)); buf = null; }
        chunks.push(value);
      }
      got += value.length;
      loadedBytes += value.length;
      report();
    }
    if (!buf) {
      buf = new Uint8Array(got);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }
    } else if (got !== buf.length) {
      buf = buf.subarray(0, got);
    }

    try { if (cache) await cache.put(url, new Response(buf)); } catch { /* cache piena: pazienza */ }
    return buf;
  }

  return {
    /** Scarica (o legge dalla cache) e prepara il modello. Idempotente. */
    async load() {
      if (session || loading) return;
      if (!(await isWebGpuAvailable())) {
        throw new Error('Questo browser non offre WebGPU: il secondo parere IA non è disponibile.');
      }
      loading = true;
      abort = new AbortController();
      loadedBytes = 0;
      try {
        const [ortModule, tf] = await Promise.all([import(ORT_URL), import(TRANSFORMERS_URL)]);
        ortModule.env.wasm.wasmPaths = ORT_BASE;
        ortModule.env.logLevel = 'error';
        tf.env.allowLocalModels = false;

        config = JSON.parse(new TextDecoder().decode(await fetchCached('config.json', abort.signal)));
        tokenizer = await tf.AutoTokenizer.from_pretrained(MODEL.repo);
        const graph = await fetchCached(GRAPH, abort.signal);
        const data = await fetchCached(WEIGHTS, abort.signal);

        session = await ortModule.InferenceSession.create(graph, {
          executionProviders: ['webgpu'],
          graphOptimizationLevel: 'all',
          externalData: [{ path: `${MODEL.file}.onnx_data`, data }]
        });
        ort = ortModule;
        report();
      } catch (e) {
        tokenizer = null; config = null; session = null; ort = null;
        throw e;
      } finally {
        loading = false;
        abort = null;
      }
    },

    /** Interrompe un `load()` in corso; non fa nulla altrimenti. */
    cancel() {
      abort?.abort();
    },

    /**
     * Le due domande, in due passaggi. Restituisce dato NON fidato: va validato (`parseAnswer`).
     * @param {ReturnType<typeof import('./prompt.js').buildQuestions>} qs
     */
    async answer(qs) {
      if (!session) throw new Error('il modello non è caricato');

      const i64 = (arr, dims) => new ort.Tensor('int64', BigInt64Array.from(arr, (v) => BigInt(v)), dims);
      const decide = async (q) => {
        const { ids, markers } = encodeQuestion(tokenizer, config, qs.state, q);
        const L = ids.length;
        const K = markers.length;
        const out = await session.run({
          input_ids: i64(ids, [1, L]),
          attention_mask: i64(new Array(L).fill(1), [1, L]),
          prefix_len: i64([0], [1]),
          marker_pos: i64(markers, [1, K]),
          marker_mask: i64(new Array(K).fill(1), [1, K]),
          qtype: i64([q.type === 'noul' ? 2 : 0], [1])
        });
        return readProbabilities(await out.logits.getData(), q, config);
      };

      const phishing = await decide(qs.phishing);
      const category = await decide(qs.category);
      const names = Object.keys(qs.category.criteria);
      const best = category.indexOf(Math.max(...category));
      return { phishing: phishing[0], category: names[best] };
    },

    dispose() {
      try { session?.release?.(); } catch { /* già rilasciata */ }
      session = null; tokenizer = null; config = null; ort = null;
    }
  };
}
