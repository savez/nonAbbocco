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
- **Firefox** — `about:debugging#/runtime/this-firefox`, *Carica componente aggiuntivo
  temporaneo*, seleziona `manifest.json`. Il caricamento temporaneo si azzera alla chiusura.

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
La conseguenza è deliberata: le regole stanno nel service worker, e il content script raccoglie
segnali DOM e nient'altro. Gira su `<all_urls>`, cioè anche dentro la pagina dell'attaccante, e
per questo non deve contenere né segreti né decisioni.

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
