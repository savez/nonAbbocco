# Avvisi di terze parti — secondo parere IA

Questa cartella (`landing/ai/`) è parte della landing di NonAbbocco, sotto licenza MIT, e **non**
fa parte dell'estensione. Il modello che usa non è sotto licenza MIT.

## Il modello

| | |
|---|---|
| Modello | `d1-omni-600M` — © Liquid AI, Inc. |
| Sorgente | <https://huggingface.co/LiquidAI/d1-omni-600M> |
| Build usata | <https://huggingface.co/onnx-community/d1-omni-600M-ONNX> (`onnx-community/d1-omni-600M-ONNX`), file `onnx/model_q4.onnx` e `onnx/model_q4.onnx_data` |
| Licenza | **LFM Open License v1.0** — <https://www.liquid.ai/lfm-license> |
| Verifica della licenza | 2026-11-16, sul testo del file `LICENSE` del repo ONNX (soglia di ricavi annui di $10,000,000 o più; clausola 5(c) per i Qualified Non-Profit) |
| File `NOTICE` nei repo del modello | nessuno, né in `LiquidAI/d1-omni-600M` né in `onnx-community/d1-omni-600M-ONNX` (verificato il 2026-11-16) |

I pesi **non sono in questo repository né sul sito**: li scarica il browser del visitatore da
Hugging Face, dopo il suo consenso. Il repo ONNX di `onnx-community` è un lavoro derivato dei pesi
originali di Liquid AI (esportati in ONNX e quantizzati, senza riaddestramento): vale la sua scheda.

## Il codice derivato

`encode.js` è un port in JavaScript del file `prompt.py` di `LiquidAI/d1-omni-600M`
(<https://huggingface.co/LiquidAI/d1-omni-600M/blob/main/prompt.py>), © Liquid AI, Inc., sotto
LFM Open License v1.0.

Modifiche rispetto all'originale, come richiede la licenza:

- riscritto da Python a JavaScript;
- limitato alle domande `noul` (sì/no) e `choice` (scelta); tolti i percorsi per `score`, audio e immagini;
- il tokenizer e la configurazione del modello sono passati dal chiamante;
- la scelta della chiave di temperatura (`temperatureKey` nell'originale) è nello stesso file; il
  calcolo delle probabilità (temperatura, softmax, ordine [vero, falso] per il sì/no) è scritto per
  questa pagina in `readProbabilities`, al posto di `answer` dell'originale, che non è portata.

## Marchio

NonAbbocco dice che usa un modello di Liquid AI. Non usa il nome, i loghi o il marchio di Liquid AI
in altro modo, e non è né approvato né sponsorizzato da Liquid AI.

## Librerie caricate da una CDN (versioni fissate in `models.js`)

- `onnxruntime-web` — © Microsoft Corporation, licenza MIT.
- `@huggingface/transformers` (solo il tokenizer) — © Hugging Face, licenza Apache 2.0.
