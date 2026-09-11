# Piano di sviluppo

Stato di partenza: il motore canonico gira davvero (PR #2), il falso positivo
sull'hosting condiviso è chiuso e l'allowlist esiste (PR #4). Questo documento
ordina il lavoro che resta.

L'ordine è per rapporto sicurezza/sforzo, con due regole trasversali:

- **Ogni fase è una PR autonoma** che lascia la suite verde (`node --test`),
  il pacchetto costruibile (`npm run package`) e — quando tocca il motore —
  il corpus arricchito PRIMA del codice, come prescrive CONTRIBUTING.md.
- **La landing page e il README si aggiornano nella stessa PR** che cambia il
  comportamento descritto, mai dopo. La landing è generata: le modifiche vanno
  in `tools/build-page.mjs`, poi `npm run page` (il workflow `pages.yml`
  segnala la deriva se si dimentica).

Riferimento rapido — dove vive cosa:

| Cosa | Dove |
|---|---|
| Motore e segnali | `src/scoring.js` |
| Regole come dati | `src/rules.js` (+ messaggio obbligatorio in `src/messages.it.js`, verificato da `test/rules.test.js`) |
| Corpus-contratto | `test/corpus/benign.json` (maxRank), `test/corpus/malicious.json` (minRank, mustFire) |
| Cablaggio non regredibile | `test/wiring.test.js` |
| Landing generata | `tools/build-page.mjs` + `tools/page-parts/style.css` → `simulator.html` |
| Packaging per store | `tools/package.mjs` (`SHIPPED`, `manifestFor`, `ONLY_FOR`) |

---

## Fase 0 — Il diagramma del flusso di ranking

*Richiesta esplicita; indipendente da tutto, si fa subito.*

Un diagramma che spiega i passi con cui una pagina arriva al suo rank, in due
posti che NON devono divergere fra loro:

1. **Landing** — dentro la sezione «Come decide» (`tools/build-page.mjs`,
   sezione a riga ~203), tra la lede e le quattro domande. Inline SVG generato
   dal builder, nello stile di `tools/page-parts/style.css`: **il colore è
   segnale, mai decorazione** — i passi del flusso in neutro, solo il rank
   finale usa la scala colorata già esistente (classi `r1`–`r5`).
2. **README** — blocco Mermaid (GitHub lo rende nativamente) nella sezione
   «Come decide», stesso flusso semplificato.

Il flusso da mostrare (stato attuale):

```
pagina caricata (document_end)
  → content.js raccoglie segnali DOM (password, nomi campi, form, titolo, testo)
  → background.js — l'unico posto dove gira il motore
      → buildUrlSignals: punycode, dominio registrabile (PSL), token, skeleton
      → normalizeDomSignals: campi sensibili, host dei form, urgenza
      → regole: esenzioni → veto → forti/deboli
      → quattro categorie, livello 0–3
      → tabella di lookup → rank 1–5
  → pillola o interstiziale sulla pagina + storage.session → popup
```

⚠️ Questo diagramma **cambia in Fase 5** (arriva la valutazione anticipata
sull'URL): entrambe le versioni vanno aggiornate in quella PR. È il costo della
doppia rappresentazione, e va scritto nel commento sopra l'SVG.

File: `tools/build-page.mjs`, `simulator.html` (rigenerato), `README.md`.
Commit: `docs:`.

---

## Fase 1 — Bypass fuori dalla portata della pagina (roadmap №2)

*La falla più concreta: mezza giornata, chiude un aggiramento reale.*

Oggi il bypass vive in `sessionStorage` sotto `nonabbocco_bypass_<host>`
(`content.js`): la pagina ostile può scriverselo da sola e non essere mai
bloccata. È dichiarato come difetto in `SECURITY.md` e nell'header di
`content.js`.

- `content.js` **smette di toccare `sessionStorage`**. Il click su «Ignora
  rischio» manda `{type: 'bypass'}` al background.
- `background.js` valida il mittente con gli stessi filtri di `analyze`
  (`sender.tab` presente, `frameId === 0`) e salva in **`storage.session`**,
  che i content script non possono leggere né scrivere. Chiave
  `bypass_${tabId}_${hostname}` per restare fedeli alla semantica attuale
  (sessionStorage era per scheda); pulizia nello stesso `forget()` già
  agganciato a `tabs.onRemoved` — ma NON in `onUpdated`, perché navigare
  dentro lo stesso sito non deve far ricomparire l'overlay appena scavalcato.
- La risposta di `analyze` include `bypassed`, e `content.js` la usa al posto
  del controllo locale. Il popup può mostrare lo stato («verdetto X, bypassato
  da te») — la voce in `storage.session` è già lì.

Test: `test/wiring.test.js` — `content.js` non contiene più `sessionStorage`
(stessa tecnica delle regressioni su somme di punti). Docs: chiudere il
difetto in `SECURITY.md`, nell'header di `content.js` e nella sezione
«Cosa non sa fare» della landing (verificare cosa dice: `#limiti`,
`tools/build-page.mjs` riga ~378). Commit: `fix:`.

---

## Fase 2 — I nomi dei campi sensibili che non matchano (№12)

*Un'ora con i test. Segnalato nella PR #2 e mai chiuso.*

`SENSITIVE_FIELD_PATTERNS` (`src/scoring.js:73`) usa `\b`, che non separa
underscore e cifre: `otp_code`, `otpCode`, `pin_code`, `user_pin`, `cvv2`,
`cvv_field`, `card_cvv` — le convenzioni più diffuse proprio per i campi che
la regola esiste per intercettare — non matchano.

Correzione in `normalizeDomSignals`: normalizzare i nomi PRIMA del match —
`[_-]` → spazio, split del camelCase (`otpCode` → `otp code`), spazio sulle
transizioni lettera↔cifra (`cvv2` → `cvv 2`). I pattern restano come sono.

Test: casi diretti in `test/scoring.test.js` per tutte le forme sopra, più le
guardie sui falsi positivi (`shipping` non deve diventare un match di `pin`);
un caso in `malicious.json` con `fieldNames`. Commit: `fix:`.

---

## Fase 3 — Typosquatting per distanza di edit (№4)

*Il buco di copertura più grosso a costo quasi zero: `paypall.com`,
`arnazon.it`, `microsofft.com` oggi passano puliti.*

Il motore prende il token esatto (`paypal-secure.xyz`) e il confusabile
(`pаypal.com` cirillico), ma non l'errore di battitura puro.

- Helper `isDamerauDistance1(a, b)` — sostituzione, inserzione, cancellazione
  o trasposizione singola; il controllo bounded a distanza ≤ 1 è O(n), niente
  matrice completa.
- Nuova regola `brand-typosquatting`: fase `url`, categoria `identity`,
  confronta i token del dominio registrabile con le label dei marchi
  (`LABEL_INDEX` in `src/brands.js`). Guardie: label di **lunghezza ≥ 6**
  (`poste`/`posta`, `intesa`/`intera` sono parole italiane a distanza 1 —
  fuori), dominio non in `LEGIT_DOMAINS`, match esatto escluso (già coperto da
  `brand-in-registrable-domain`), suffisso PSL noto.
- **Parte `weak`, non `strong`.** Da sola: rank 2. Con una password: rank 3.
  La promozione a `strong` (rank 4 col login — dove meriterebbe stare) si
  decide solo dopo che il corpus si è allargato abbastanza da misurarla: è
  la stessa prudenza che ha evitato il disastro su `trusted-brand-domain`.
- Messaggio in `src/messages.it.js` (obbligatorio, `test/rules.test.js` lo
  verifica). Il catalogo regole della landing si rigenera da solo da `RULES`:
  basta `npm run page`.

Corpus prima del codice: `malicious.json` con `paypall.com/login`,
`amazom.it`; `benign.json` con le guardie (`posta.it` è un sito reale).
Commit: `feat:`.

📌 *In questa fase, sistemare anche il debito №11*: `src/rules.js:11` e
`src/messages.it.js:8` promettono un `test/docs-sync.test.js` che non esiste.
Aggiungendo una regola nuova il vincolo diventa reale: o si scrive il test
(regola → messaggio → scheda in un `docs/DETECTION.md` da creare), o si
tolgono le promesse. Deciderlo qui, non rimandarlo di nuovo.

---

## Fase 4 — Safe Browsing: sbloccare il rank 5 (№3)

*Il rank 5 è irraggiungibile: la regola `safebrowsing-hit` esiste, il design
di privacy è già scritto nel README, manca solo il codice.*

- **`src/safebrowsing.js`** (puro, testabile offline): canonicalizzazione
  dell'URL secondo la spec v4, SHA-256 via WebCrypto, prefissi a 4 byte. La
  spec pubblica i vettori di test: usarli in `test/safebrowsing.test.js`.
- **`background.js`**: chiama `fullHashes:find` SOLO quando il verdetto
  euristico è già rank ≥ 3 (è la promessa del README: la maggioranza delle
  pagine non genera alcuna richiesta). Risposta → `context.safeBrowsingThreat`
  → il veto fa il resto. Cache positiva e negativa in `storage.session` con i
  TTL della risposta, per non richiamare a ogni load.
- **`options.html/js`**: campo per la chiave API dell'utente, salvata in
  **`storage.local`** — non `sync`, per non sincronizzarla sul cloud: è
  un'altra promessa esplicita del README.
- **`manifest.json`**: `host_permissions` per `safebrowsing.googleapis.com`
  (primo permesso di rete del progetto — da giustificare sugli store).
- **Interstiziale rank 5 con attribuzione Google**: i ToS di Safe Browsing la
  richiedono; il progetto ha già legato strutturalmente il rank 5 al veto
  proprio per questo. Variante del blocco in `content.js` (o in `block.html`
  dopo la Fase 5).

Docs: README (da «opzionale e disattivata» a disponibile), landing `#limiti`
e la riga `r5` della formula, `SECURITY.md`. Commit: `feat:`. È la prima fase
grossa: più sessioni.

---

## Fase 5 — Interstiziale non manomettibile + verdetto prima della pagina (№1+№8)

*Il progetto di sicurezza più importante. I due punti condividono permessi e
design: si fanno insieme.*

Oggi overlay e pillola sono nodi del DOM della pagina ostile: una riga di JS
li rimuove. E il verdetto arriva solo a `document_end`: l'utente vede la
pagina finta per tutto il caricamento.

- Permesso **`webNavigation`**. Su `onCommitted` (frame 0): `buildUrlSignals`
  → `evaluate({phase: 'url'})` — la fase URL esiste ed è testata da sempre,
  non è mai stata collegata. Se il rank supera la soglia:
  `chrome.tabs.update` verso **`block.html`**, pagina dell'estensione che la
  pagina ostile non può toccare.
- `block.html/js`: verdetto e ragioni letti da `storage.session` (riuso del
  pattern del popup), bottoni «Torna al sicuro» e «Procedi» — quest'ultimo usa
  il bypass della Fase 1, che a quel punto è già lato background.
- `content.js` resta per la fase DOM: **`mergeVerdicts`** (scritta, testata,
  mai usata) fonde i due verdetti. È monotona — il rank sale, mai scende — e
  quella proprietà va conservata: è ciò che impedisce alla pagina di iniettare
  DOM «rassicurante» per far ritirare un blocco già mostrato. Se il verdetto
  full supera la soglia a pagina già carica, l'overlay attuale resta come
  ripiego.
- `tools/package.mjs`: `block.html`/`block.js` in `SHIPPED`; verificare il
  preflight sui file citati dal manifest.

Docs: **aggiornare il diagramma della Fase 0 in entrambi i posti** (landing e
README) — il flusso diventa a due fasi; riscrivere `docs/RANKING.md` §6
(la sottosezione «Cosa non è ancora collegato» si chiude); `SECURITY.md`
(il blocco non è più rimovibile; resta la finestra di race, documentata).
Commit: `feat:`. Fase grossa.

---

## Fase 6 — Allowlist dove serve: popup e interstiziale (№9)

Ora che l'allowlist esiste (PR #4), il flusso naturale è «sono davanti al
blocco → è un falso positivo → lo segno QUI», non «apro le opzioni e scrivo
l'hostname a mano».

- Azione «Considera attendibile questo sito» nel popup (visibile con rank ≥ 2)
  e in `block.html`: scrive in `storage.sync` riusando `normalizeEntry` di
  `src/allowlist.js` — MAI una seconda copia della normalizzazione — e
  ricarica la pagina.
- Stessa avvertenza delle opzioni sulle piattaforme condivise (riusare il
  testo: mettere `awsapps.com` in allowlist accetta anche
  `paypal.awsapps.com`).
- Il popup smette di essere solo informativo: aggiornare l'header di
  `popup.js` e `test/wiring.test.js`.

Commit: `feat:`. Piccola, ma dopo la Fase 5 (tocca `block.html`).

---

## Fase 7 — Reputazione locale (№5)

*La categoria `reputation` è vuota (solo il veto). Tutto locale, zero rete,
coerente con la promessa di privacy. È la fase più incerta: design col corpus
in mano, non di contorno.*

- `tools/update-tranco.mjs` → `src/tranco-data.js`: bloom filter dei top-100k
  domini Tranco (~200KB), stesso pattern dati-generati/logica-a-mano di
  `psl-data.js`/`psl.js`. Lookup in `src/bloom.js`, scritto a mano.
- **Cosa NON fare**: la popolarità come esenzione. `amazonaws.com` è
  popolarissimo e ospita phishing — è esattamente la lezione della PR #4.
  Direzione probabile: segnale `weak` su `reputation` per il dominio NON
  popolare in congiunzione col resto, non un lasciapassare per quello
  popolare.
- **Tocca la tabella dei rank**: oggi `reputation` non compare mai insieme a
  `credentials`, quindi il segnale non peserebbe nulla nei casi che contano.
  Aggiungere la riga (es. `reputation ≥ 1 E credentials ≥ 1 → rank 3`)
  significa modificare `rankFromCategories`, la formula sulla landing, la
  tabella in `docs/RANKING.md` §5 e il README — con il corpus a fare da rete.

Commit: `feat:`. Da affrontare solo con un corpus più largo di oggi.

---

## Fase 8 — Pubblicazione sugli store (№10)

Il packaging è pronto (`npm run package` produce entrambi gli zip con i
manifest per-browser). Il lavoro è la scheda, non il codice:

- Screenshot 1280×800: interstiziale, popup, opzioni.
- Giustificazione dei permessi: `<all_urls>` (il phishing non vive su domini
  noti in anticipo), più `webNavigation` e l'host Safe Browsing dalle fasi
  4–5.
- Privacy policy: analisi locale; Safe Browsing opzionale, a chiave
  dell'utente, a prefissi hash. Entrambi gli store la verificano.
- Firefox/AMO: `gecko.id` è `nonabbocco@saveriomenin.it` e non va più
  cambiato (già stampato dal packager).
- README: sezione installazione, da «non ancora pubblicata» ai link.

E poi il ciclo di revisione degli store, che ha tempi suoi.

---

## Fuori piano (debiti riconosciuti, si agganciano quando si tocca l'area)

- **№11 — test docs-sync fantasma** → si risolve nella Fase 3 (vedi 📌).
- **№13 — i18n**: tutto l'italiano è hardcoded in tre posti. Non urgente
  finché il pubblico è italiano; `messages.it.js` è già pronto
  all'estrazione. Da fare prima che i testi raddoppino (Fase 5 li raddoppia:
  farla prima o durante).

## Sequenza e dipendenze

```
Fase 0 (diagramma)      → subito, indipendente
Fase 1 (bypass)         → subito; la Fase 5 la riusa
Fase 2 (campi sensibili)→ subito, indipendente
Fase 3 (typosquatting)  → subito; include il №11
Fase 4 (Safe Browsing)  → dopo le piccole; indipendente da 5
Fase 5 (interstiziale)  → dopo la 1; aggiorna il diagramma della 0
Fase 6 (allowlist UX)   → dopo la 5
Fase 7 (reputazione)    → dopo che il corpus è cresciuto (3 e 4 lo nutrono)
Fase 8 (store)          → quando il blocco è davvero un blocco (dopo la 5)
```
