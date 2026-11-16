// SPIKE USA E GETTA. d1-omni-600M (solo testo) sul corpus di NonAbbocco, in Node su CPU.
//
//   cd docs/superpowers/spikes/d1-browser && npm install
//   node eval.mjs <cartella-modello> <q4|quantized> [--thr 0.5]
//
// <cartella-modello> contiene config.json, tokenizer.json, tokenizer_config.json e
// onnx/model_q4.onnx(+_data) oppure onnx/model_quantized.onnx(+_data), scaricati
// da onnx-community/d1-omni-600M-ONNX (vedi REPORT.md).
import * as ort from 'onnxruntime-node';
import { AutoTokenizer, env } from '@huggingface/transformers';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classify, CATEGORY } from './d1-core.mjs';

const [, , dir, variant = 'q4'] = process.argv;
const thrArg = process.argv.indexOf('--thr');
const THR = thrArg > 0 ? Number(process.argv[thrArg + 1]) : 0.5;
const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'test', 'corpus');

env.allowLocalModels = true;
env.allowRemoteModels = false;
const tok = await AutoTokenizer.from_pretrained(dir);
const config = JSON.parse(readFileSync(`${dir}/config.json`, 'utf8'));

const t0 = performance.now();
const session = await ort.InferenceSession.create(`${dir}/onnx/${variant === 'q4' ? 'model_q4' : 'model_quantized'}.onnx`);
const loadMs = performance.now() - t0;

const i64 = (a, dims) => new ort.Tensor('int64', BigInt64Array.from(a, (v) => BigInt(v)), dims);
const run = async ({ ids, markers, qtype }) => {
  const L = ids.length, K = markers.length;
  const out = await session.run({
    input_ids: i64(ids, [1, L]),
    attention_mask: i64(new Array(L).fill(1), [1, L]),
    prefix_len: i64([0], [1]),
    marker_pos: i64(markers, [1, K]),
    marker_mask: i64(new Array(K).fill(1), [1, K]),
    qtype: i64([qtype], [1]),
  });
  return out.logits.data;
};

const load = (f) => JSON.parse(readFileSync(`${corpusDir}/${f}.json`, 'utf8')).cases;
const sets = [['malicious', load('malicious'), true], ['benign', load('benign'), false]];

let tp = 0, tn = 0, fp = 0, fn = 0, ms = 0;
const rows = [];
for (const [label, cases, isPhish] of sets) {
  for (const c of cases) {
    const state = { url: c.url, has_password_field: !!c.hasPassword, form_action: c.formAction ?? null };
    const a = performance.now();
    const r = await classify(tok, config, run, state);
    ms += performance.now() - a;
    const flagged = r.phishing >= THR;
    if (isPhish) flagged ? tp++ : fn++; else flagged ? fp++ : tn++;
    rows.push({ set: label, id: c.id, url: c.url, p: +r.phishing.toFixed(3), category: r.category, conf: +r.categoryConfidence.toFixed(2), ok: flagged === isPhish });
  }
}

const pos = rows.filter((r) => r.set === 'malicious').map((r) => r.p);
const neg = rows.filter((r) => r.set === 'benign').map((r) => r.p);
let wins = 0;
for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
const auc = wins / (pos.length * neg.length);
const mean = (x) => x.reduce((a, b) => a + b, 0) / x.length;
const n = tp + tn + fp + fn;
console.log(JSON.stringify({
  variant, thr: THR, loadMs: Math.round(loadMs), msPerPage: Math.round(ms / n), cases: n,
  auc: +auc.toFixed(3), meanMalicious: +mean(pos).toFixed(3), meanBenign: +mean(neg).toFixed(3),
  accuracy: +((tp + tn) / n).toFixed(3), tp, tn, fp, fn,
}, null, 1));
console.log('\nERRORI:');
for (const r of rows.filter((r) => !r.ok)) console.log(`  [${r.set}] p=${r.p} ${r.url}  (${r.id})`);
console.log(`\nCATEGORIE (${Object.keys(CATEGORY.criteria).length} opzioni, da controllare a occhio):`);
for (const r of rows) console.log(`  ${r.set.padEnd(9)} p=${String(r.p).padEnd(5)} ${r.category.padEnd(24)} ${r.conf}  ${r.url}`);
