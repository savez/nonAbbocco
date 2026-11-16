/**
 * Il modello e le librerie che lo fanno girare, in un posto solo.
 *
 * Dati misurati nello spike (docs/superpowers/spikes/d1-browser/REPORT.md):
 * `model_q4` pesa 244 MB, più 5 MB di tokenizer. Il 3B (≈ 1,9 GB) è scartato.
 *
 * I pesi NON stanno nel repo né nel sito: li scarica il browser del visitatore
 * da Hugging Face, e solo dopo il consenso. d1-omni-600M è © Liquid AI, Inc.,
 * sotto LFM Open License v1.0 (vedi NOTICE.md).
 */

export const MODEL = {
  repo: 'onnx-community/d1-omni-600M-ONNX',
  /** Grafo solo testo: token → logit delle opzioni, embedding inclusa. */
  file: 'model_q4',
  /** 244 MB di grafo + 5 MB di tokenizer. */
  approxMB: 249,
  license: 'LFM Open License v1.0',
  licenseUrl: 'https://www.liquid.ai/lfm-license'
};

// Versioni fissate: la landing non deve cambiare comportamento perché una CDN
// ha pubblicato una release. `onnxruntime-web` è la stabile del 26 ottobre 2026,
// provata nello spike (stesse probabilità del build di sviluppo).
export const ORT_VERSION = '1.31.1';
export const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
export const ORT_URL = `${ORT_BASE}ort.webgpu.bundle.min.mjs`;

// Serve solo `AutoTokenizer`: il grafo lo esegue onnxruntime-web.
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

export const HF_BASE = `https://huggingface.co/${MODEL.repo}/resolve/main/`;

/** Nome della Cache API in cui restano i file del modello fra una visita e l'altra. */
export const CACHE_NAME = 'nonabbocco-d1-omni-v1';
