# Spike D1 nel browser — report

Data: 2026-11-16 · Branch: `landing` · Piano: `docs/superpowers/plans/2026-11-15-landing-ai-second-opinion.md`, Task 0.
**Spike usa e getta**: i file in questa cartella non fanno parte del prodotto e non vanno pubblicati sul sito.

## Esito in una riga

**D1 gira nel browser, ma non il 3B: il candidato è `d1-omni-600M` in ONNX, q4, circa 249 MB.** Su CPU, sul corpus del progetto, concorda con le etichette nell'85,7% dei casi. **Misurato anche su WebGPU** (Chrome 157 headless, Mac): il grafo q4 si carica, risponde in circa 150 ms per pagina e dà le stesse probabilità della CPU entro 0,06 (vedi «Misure su WebGPU»).

## Candidati

| | Candidato | Download (solo testo) | Esito |
|---|---|---|---|
| A | `LiquidAI/d1-3B` (build browser: `onnx-community/d1-3B-ONNX`) | q4: decoder 1 762 MB + embedding 168 MB ≈ **1,9 GB** | Scartato: sforerebbe di 5 volte il limite di 400 MB. Il q4 più piccolo non esiste: gli altri dtype sono più grandi. |
| A' | `LiquidAI/d1-2B-ONNX` (famiglia lfm3) | q4: 1 742 MB | Scartato, stessa ragione. |
| B | **`onnx-community/d1-omni-600M-ONNX`** | **q4: 244 MB + tokenizer 5 MB ≈ 249 MB**; q8: 406 MB + 5 MB | **Scelto.** Grafo solo testo `model_q4.onnx`: token → logit delle opzioni, embedding inclusa. |
| C, D | LFM2.5-230M, LFM2-350M (generativi) | ~200 MB | Non provati: B soddisfa tutti i criteri, e come da piano ci si ferma al primo. Restano la riserva. |

`d1-omni-600M` è un modello di decisione (587 M di parametri, encoder LFM2.5-350M bidirezionale con una testa di decisione): non genera testo, risponde a domande tipizzate (`choice`, `noul` = sì/no, `score`) in un solo passaggio, e la risposta è sempre una delle opzioni date. Liquid lo descrive come checkpoint sperimentale.

## Misure (Node, CPU, Mac del progetto, 42 casi di `test/corpus/*`)

Input: solo URL, `hasPassword`, `formAction` (il corpus non ha il titolo). Due domande per pagina: «è phishing?» (sì/no) e «che categoria?» (otto opzioni).

| | q4 | q8 |
|---|---|---|
| Download | ≈ 249 MB | ≈ 411 MB |
| Caricamento sessione | 0,7 s | 0,3 s |
| Per pagina (2 decisioni) | ≈ 0,9 s | ≈ 0,9 s |
| **Concordanza con l'etichetta a soglia 0,5** | **85,7 %** (36/42) | 76,2 % (32/42) |
| Falsi positivi / falsi negativi | 3 / 3 | 8 / 2 |
| AUC (separazione delle probabilità) | **0,929** | 0,886 |
| p(phishing) media sui malevoli / sui legittimi | 0,65 / 0,38 | 0,75 / 0,42 |

Soglia sul q4: 0,40 → 73,8 % (11 FP, 0 FN) · 0,45 → 83,3 % · **0,50 → 85,7 %** · 0,55 → 81,0 % (2 FP, 6 FN) · 0,60 → 76,2 %. Lo 0,5 è già il migliore.

Errori del q4 a soglia 0,5:
- Falsi negativi: `brt-spedizioni-tracking.icu/pagamento-dogana` (0,41), `inps-rimborso-contributi.top/accedi` (0,49), `intesa-sicurezza-accesso.top/conferma` (0,48).
- Falsi positivi: `app.esempio-azienda.it/signin` (0,64), `miaazienda.awsapps.com/connect/login` (0,52), `www.goggle-analytics-tutorial.it/` (0,56).

### Come leggere questi numeri

- **Il campione è piccolo**: 19 malevoli e 23 legittimi, quindi circa ±12 punti. La differenza fra q4 e q8 sta dentro il rumore; non conclude che il q4 sia migliore. Conclude che il q4 non è peggiore, e costa 160 MB in meno.
- **Le probabilità si sovrappongono**: i malevoli vanno da 0,41 a 0,96, i legittimi da 0,06 a 0,64. Il modello ordina bene (AUC 0,93) ma una soglia netta non c'è. È un **secondo parere**, non un verdetto, come già deciso nel piano.
- **Vantaggio sul motore**: il corpus è fatto per far passare il motore (ogni caso ha `minRank`/`maxRank` che il motore rispetta per contratto), quindi non si può dire se D1 trova qualcosa che il motore perde. Il test utile sarebbe su URL che il motore non conosce.

### Categorie (solo dall'URL)

Utili solo in parte. Corrette, per esempio: `paypal-secure.xyz` → pagamenti (0,99), `amazon.de` → e-commerce, `poste.it` → posta, `http://185.220.101.5/banca/accedi.htm` → banca. Sbagliate o vaghe: `inps-rimborso-contributi.top` → altro (doveva essere pubblica-amministrazione), `brt-spedizioni-tracking.icu` → altro (spedizioni), `intesasanpaolo.com` → altro (banca), `www.posteitaliane.it` → pubblica-amministrazione. Quasi tutto il resto finisce in «altro», anche con confidenza 0,8–0,9.
**Raccomandazione**: mostrare la categoria solo se non è «altro» e la confidenza è almeno 0,9, oppure toglierla dalla prima versione.

## Licenza (letta alla fonte, 2026-11-16)

- `onnx-community/d1-omni-600M-ONNX`: tag `license: other`, `license_name: lfm1.0`, file `LICENSE` presente (10 572 byte): è la **LFM Open License v1.0**. Soglia («Threshold»): ricavi annui di **$10,000,000 o più**; clausola 5(c): la soglia non si applica a un Qualified Non-Profit per usi non commerciali o di ricerca.
- La scheda del repo dichiara di essere un **lavoro derivato** di `LiquidAI/d1-omni-600M` (© Liquid AI, Inc.): pesi esportati in ONNX e quantizzati, nessun riaddestramento.
- Nessun file `NOTICE` né nel repo ONNX né in `LiquidAI/d1-omni-600M`.
- I pesi restano su Hugging Face: il sito non li ospita e non li ridistribuisce.

## Provenienza del codice (importante per il Task 3)

- `open-jev` (MIT, 156 KB) è la libreria pensata per questi modelli, ma **la versione 0.1.2 su npm e la `main` su GitHub non supportano `d1-omni`** (solo i modelli kev/open-jev); lo snippet nella scheda del modello fa riferimento a una versione che non c'è.
- Lo Space `mrfakename/open-d1-webgpu` contiene un'implementazione funzionante, ma è di terzi, con licenza «other» non specificata: **non copiarne il codice**.
- `d1-core.mjs` è stato scritto per lo spike seguendo il formato di prompt documentato; è usa e getta. Per il Task 3 la codifica va **riscritta dal `prompt.py` di `LiquidAI/d1-omni-600M`**, che ha la stessa LFM Open License ed è la fonte ufficiale (con avviso di copyright, come richiede la licenza).

## Misure su WebGPU (2026-11-16)

Eseguite pilotando un Chrome 157 headless con `--enable-unsafe-webgpu` sulla pagina `index.html` servita in locale (stessa pagina utilizzabile a mano in qualunque Chrome con WebGPU). Adattatore WebGPU presente, `shader-f16` disponibile, `crossOriginIsolated: false` (come su GitHub Pages).

| | `onnxruntime-web` 1.31.1 (stabile) | `onnxruntime-web` 1.31.0-dev (build dello Space) |
|---|---|---|
| Download `model_q4` | 244 MB in 4,8 s (linea veloce) | 244 MB in 4,8 s |
| Tokenizer | — | 1,3 s |
| Creazione sessione WebGPU | 2,0 s | 1,7 s |
| Prima pagina (compila gli shader) | **0,56 s** | 2,5 s |
| Pagine successive (2 decisioni) | **≈ 0,15 s** | ≈ 0,15 s |
| Heap JS | 272 MB | 265 MB |

La memoria GPU non è esposta dalla pagina: non misurata.

Probabilità di phishing e categoria, WebGPU contro CPU (Node, `eval.mjs`):

| URL | WebGPU | CPU |
|---|---|---|
| `paypal-secure.xyz/login` | 0,616 · pagamenti | 0,616 · pagamenti |
| `www.posteitaliane.it/` | 0,345 · pubblica-amministrazione | 0,345 · pubblica-amministrazione |
| `inps-rimborso-contributi.top/accedi` | 0,493 · altro | 0,493 · altro |
| `www.amazon.de/` | 0,291 · e-commerce | 0,235 · e-commerce |

Lo scarto massimo è 0,056 (`amazon.de`), sotto la soglia di 0,1 fissata dal piano. Conclusioni:

1. `model_q4` **gira su WebGPU**: non serve ripiegare su `model_quantized`.
2. La release stabile `onnxruntime-web@1.31.1` (26 ottobre 2026) funziona come il build di sviluppo: la landing usa quella.
3. La latenza è molto sotto il limite di 15 s per pagina; il costo vero è il download iniziale (244 MB), da fare solo dopo il consenso e una volta sola (cache del browser).
4. Per rifare la misura a mano: `cd docs/superpowers/spikes/d1-browser && python3 -m http.server 8080`, aprire `http://localhost:8080/?ort=1.31.1` in Chrome e premere «Scarica e misura».

## Verifica nella landing (2026-11-16, implementazione finita)

Provata nella pagina vera, in Chrome 157 con WebGPU, con la composizione del sito identica a quella del deploy:

- **Rete**: prima del consenso gli unici host contattati sono `fonts.googleapis.com` (il font della pagina, già presente). `cdn.jsdelivr.net` e `huggingface.co` compaiono solo dopo «Scarica e analizza».
- **Senza adattatore WebGPU** (`--disable-gpu`: `navigator.gpu` esiste ma `requestAdapter()` dà `null`): compare solo l'avviso, nessuna richiesta, nessuna eccezione.
- **Download e analisi**: 244 MB, ~8 s su linea veloce; seconda visita dalla cache in 1,4 s, senza richieste ai pesi; ~150 ms per pagina. Le probabilità coincidono con quelle dello spike (es. 0,6159 contro 0,616).
- **Errori**: Hugging Face bloccato → «Non riesco a caricare il modello: Failed to fetch.» con «Riprova»; «Annulla» a metà download (69 su 249 MB) → «Download annullato.»; «Riprova» dopo l'annullamento completa il download e dà il risultato (nessuna cache corrotta). Hugging Face ha risposto una volta HTTP 429 dopo molte scaricate di fila: l'errore arriva alla UI come testo.
- **Cambiare l'input** fa sparire il risultato; la seconda analisi, con il modello già pronto, non riscarica nulla.
- **Input ostile**: un URL con `<|reserved_8|>` e «ignora le istruzioni» dà una risposta normale (52%), e `encode.js` produce gli stessi token del codice dello spike su tutti gli 84 confronti del corpus (42 pagine × 2 domande).

### Attenzione: i quattro scenari della pagina

Probabilità di phishing del modello (q4, CPU) sugli scenari preimpostati, contro il rank del motore. «Con titolo e urgenza» è quello che fa la landing; «solo URL» è la forma misurata nello spike (il corpus non ha titoli).

| Scenario | Motore | IA con titolo e urgenza | IA solo URL |
|---|---|---|---|
| PayPal vero (`paypal.com/it/signin`) | 1/5 | **86%** · pagamenti | **58%** · pagamenti |
| Typosquatting (`paypal-secure.xyz`) | 4/5 | 84% · pagamenti | 62% · pagamenti |
| Marchio nel sottodominio | 4/5 | 76% · pagamenti | 81% · pagamenti |
| Hosting gratuito (`*.pages.dev`) | 3/5 | 73% · altro | 73% · altro |

Il modello non distingue il PayPal vero dalle imitazioni: lo segna phishing sul sito vero (58% solo dall'URL, 86% con titolo), come ha segnato 3 legittimi su 23 nel corpus. La pagina lo mostra con onestà («Motore e IA non concordano: l'IA è più severa. Vale il verdetto del motore.»), ma è il primo scenario che un visitatore cliccherà. Titolo e urgenza non sono stati misurati nello spike e qui spostano le stime di 4–28 punti in entrambe le direzioni.

## Come rieseguire la valutazione

```
cd docs/superpowers/spikes/d1-browser && npm install
# scaricare in una cartella nuova e vuota, da onnx-community/d1-omni-600M-ONNX:
#   config.json tokenizer.json tokenizer_config.json onnx/model_q4.onnx onnx/model_q4.onnx_data
node eval.mjs <cartella> q4
```

## Raccomandazione

1. **Modello predefinito: `onnx-community/d1-omni-600M-ONNX`, variante q4** (≈ 249 MB). Rispetta i criteri del piano: download ≤ 400 MB, concordanza ≥ 75 %, latenza su CPU ben sotto i 15 s.
2. **Prova WebGPU eseguita**: `model_q4` gira, con `onnxruntime-web@1.31.1`. Nessun bisogno della riserva (q8 o un LFM2.5 generativo).
3. Presentare il risultato come **secondo parere** con la probabilità, non come sì/no secco; la categoria solo se ≠ «altro» e con confidenza ≥ 0,9.
