# Contribuire a NonAbbocco

Grazie per l'interesse. Progetto MIT, contributi benvenuti.

Per le **vulnerabilità** non usare le issue pubbliche: vedi [SECURITY.md](SECURITY.md).

## Avvio rapido

Non c'è build step e non ci sono dipendenze da installare.

```bash
git clone <repo> && cd nonAbbocco
node --test          # la suite completa
```

Per caricare l'estensione:

- **Chrome / Edge / Brave** — `chrome://extensions`, attiva *Modalità sviluppatore*, poi
  *Carica estensione non pacchettizzata* e scegli la cartella del repo.
- **Firefox 121+** — `about:debugging#/runtime/this-firefox`, *Carica componente aggiuntivo
  temporaneo*, seleziona `manifest.json`. Il caricamento temporaneo si azzera alla chiusura.

Il `manifest.json` del repo dichiara il background **per entrambi i browser insieme**, così la
stessa cartella si carica in tutti e due: `service_worker` + `type: "module"` per Chrome, `page`
per Firefox, che i service worker non li supporta e non supporta ancora `type: "module"` su
`background.scripts` ([bug 1811443](https://bugzilla.mozilla.org/show_bug.cgi?id=1811443)).

Da qui il pavimento di Firefox 121 in sviluppo: prima di quella versione la sola presenza di
`service_worker` impediva alla background page di partire. **Gli utenti non sono toccati** —
`npm run package` consegna a ciascuno store solo le chiavi del suo browser, e il manifest per AMO
resta compatibile con Firefox 115, il pavimento reale (è la versione in cui è arrivato
`storage.session`, da cui il popup legge il verdetto). Se devi provare su un Firefox più vecchio,
lancia `npm run package:firefox` e carica `dist/.staging/firefox/manifest.json`.

## Il contributo più utile: casi per il corpus

Prima di toccare il codice, considera questo. Il motore si calibra su due file:

- `test/corpus/benign.json` — siti **legittimi**, con il rank massimo accettabile (`maxRank`).
  Superarlo è un falso positivo.
- `test/corpus/malicious.json` — pagine di **phishing**, con il rank minimo richiesto (`minRank`).

**Hai trovato un falso positivo?** Aggiungi il sito a `benign.json` con `maxRank` e una `note`
che spieghi perché è legittimo. **Un falso negativo?** Aggiungilo a `malicious.json`. Un caso
ben documentato vale più di una regola scritta in fretta: è ciò che impedisce che una correzione
futura riapra il difetto.

Non mettere nel corpus URL di phishing ancora attivi con parametri che identificano una vittima
reale: normalizza il path e rimuovi i token.

## Regola d'oro: il motore sta in un posto solo

Tutte le euristiche vivono in **`src/scoring.js`**, che è un modulo ES **puro** — nessun accesso
a `window`, `document` o `chrome`. Questo non è pignoleria di stile:

Il progetto ha già sofferto di un motore duplicato. Esistevano due copie divergenti dello
scoring — una in `content.js` e una incollata dentro `simulator.html` — con pesi diversi, e la
demo pubblica mostrava numeri che l'estensione non avrebbe mai prodotto. **Non reintrodurre una
seconda copia.** Se un contesto ti sembra costretto a duplicare la logica, apri una issue: è un
problema di architettura, non da risolvere copiando.

In particolare i content script **non possono** essere moduli ES su nessuno dei due browser.
La conseguenza è deliberata: le regole stanno in `background.js`, che il motore lo importa, e
`content.js` raccoglie segnali DOM e disegna quello che gli viene risposto. Gira su `<all_urls>`,
cioè anche dentro la pagina dell'attaccante, e per questo non deve contenere né segreti né
decisioni.

Il giro completo è uno solo:

```
content.js  ──sendMessage({ dom })──►  background.js  ──►  src/scoring.js
                                             │
                    risposta: verdetto ◄─────┤
                                             └──►  storage.session  ──►  popup.js
```

Il popup **non ricalcola**: legge dalla sessione lo stesso verdetto. `test/wiring.test.js`
verifica che il cablaggio resti così — in particolare che in `content.js` non ricompaiano somme
di punti, soglie di rank o liste di marchi. Quella suite esiste perché per un po' `src/scoring.js`
è stato corretto, testato *e scollegato*: la suite era verde e l'estensione installata usava
un'altra logica.

## Aggiungere una regola di rilevamento

1. Definiscila come **dato**, non come `if` annidato.
2. Aggiungi il testo utente in `src/messages.it.js`, chiavato sull'`id` della regola.
3. Documentala in `docs/DETECTION.md`, con **falsi positivi noti** e **come si evade**.
   Una regola senza queste due voci non è pronta.
4. Aggiungi casi a **entrambi** i corpus: quelli che deve prendere e quelli che non deve prendere.
5. `node --test` deve restare verde. La suite include un test che verifica che ogni `id` di
   regola sia documentato: aggiungere una regola senza documentarla fa fallire la build.

Prima di proporre una regola, chiediti se produce falsi positivi su login legittimi. I `<form>`
senza `action`, i campi password iniettati da JavaScript e gli iframe cross-origin con credenziali
sono **comportamento normale** del web moderno, non segnali di attacco.

## La pagina di progetto è generata

`simulator.html` **non si modifica a mano**: lo genera `tools/build-page.mjs`, e una modifica
diretta sparisce al primo `npm run page`. La pagina importa `src/scoring.js` e costruisce la
tabella delle regole da `src/rules.js` proprio perché non possa mostrare numeri diversi da quelli
che l'estensione produce.

Per cambiarne il contenuto:

- **struttura, testi, sezioni** → `tools/build-page.mjs`
- **il simulatore vero e proprio** → `tools/page-parts/simulator-ui.html`

```bash
npm run page && npx serve .   # poi http://localhost:3000/simulator.html
```

Serve un server: la pagina importa un modulo ES, e i moduli non si caricano con `file://`.

Il deploy su GitHub Pages pubblica il file committato, ma il workflow confronta con quello
rigenerato e segnala la deriva nel sommario del job — così una modifica a mano è visibile invece
di sparire in silenzio.

## Commit e rilasci

Il versionamento è automatico via [release-please](https://github.com/googleapis/release-please),
quindi i messaggi di commit devono seguire
[Conventional Commits](https://www.conventionalcommits.org/):

```
feat: rileva il brand nel sottodominio di un dominio registrabile diverso
fix: non bloccare più gli indirizzi IP privati e localhost
docs: spiega il modello di calibrazione in RANKING.md
refactor: estrai lo scoring in un modulo ES puro
test: aggiungi al corpus il caso dell'hosting effimero
```

`feat` alza la minor, `fix` la patch, un `!` o un footer `BREAKING CHANGE:` alza la major.
**Non modificare a mano il numero di versione** in `manifest.json` o `package.json`: li aggiorna
release-please.

## Cosa non finirà nel progetto

Per risparmiare tempo a entrambi:

- **Chiavi API committate.** La chiave Safe Browsing è *bring your own key* e va inserita
  dall'utente nelle opzioni. Il repo è pubblico: nessun segreto entra qui.
- **Telemetria o analytics**, in qualunque forma.
- **Patch di `fetch` o `XMLHttpRequest` nel MAIN world.** È inaffidabile come rilevamento — la
  pagina può girare prima o usare la `fetch` incontaminata di un iframe — e in compenso è una
  superficie d'attacco concreta.
- **Qualunque UI che dica a un utente che un sito è "sicuro".** L'assenza di segnali non è una
  garanzia, e comunicarla come tale fa più danni che non dire nulla.
