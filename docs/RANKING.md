# Come NonAbbocco decide

Questo documento spiega **come si arriva al numero** che vedi. Non serve leggere il codice per
seguirlo, ma ogni affermazione qui corrisponde a qualcosa in
[`src/scoring.js`](../src/scoring.js) e [`src/rules.js`](../src/rules.js).

---

## 1. Il problema del modello precedente

La prima versione del motore sommava punti e confrontava il totale con soglie fisse. IP grezzo
valeva 45, un marchio imitato 55, password su HTTP 50, e così via; da 40 punti in su era rank 3, da
60 rank 4, da 80 rank 5.

Sembra ragionevole, e non funziona. Ecco cosa produceva:

| Indirizzo | Punti | Rank |
|---|---|---|
| `paypal-secure.xyz/login` | 55 | 3 |
| `www.posteitaliane.it` | 55 | 3 |

Un attacco da manuale e il sito vero di Poste Italiane ricevevano **lo stesso identico verdetto**.
E c'era di peggio:

| Indirizzo | Punti | Rank | Problema |
|---|---|---|---|
| `login-paypal.xyz` | 85 | 5 | bloccato |
| `paypal-secure.xyz/login` | 55 | 3 | **non** bloccato |

Lo stesso attacco, due verdetti diversi, e l'unica differenza era che nel primo caso la parola
"login" stava nell'hostname e nel secondo nel path.

| Indirizzo | Punti | Rank | Problema |
|---|---|---|---|
| `http://192.168.1.1/login` | 95 | 5 | **blocco a schermo intero sul router di casa** |
| `random-kit.pages.dev/signin` | 0 | 1 | phishing giudicato «Ritenuto Sicuro» |

**La causa non erano i pesi.** Ritoccarli avrebbe prodotto una nuova generazione di incoerenze.
La causa era sommare fra grandezze incommensurabili: 55 punti significavano la stessa cosa
qualunque regola li avesse generati, e un numero solo non può distinguere «questo sito mente
sulla propria identità» da «questo sito chiede una password».

---

## 2. Quattro domande invece di un punteggio

Le regole sono raggruppate in quattro categorie. Non sono un'astrazione tecnica: sono le quattro
domande che una persona si fa davanti a una pagina sospetta.

| Categoria | La domanda |
|---|---|
| `identity` | **Chi dice di essere** questo sito? |
| `credentials` | **Cosa mi sta chiedendo?** |
| `transport` | **Come lo trasmette?** |
| `reputation` | **Cosa ne sanno gli altri?** |

Tenerle separate è ciò che permette di dire «imita un marchio **e** chiede credenziali», che è
un'affermazione verificabile, invece di «punteggio 55», che non vuol dire niente.

---

## 3. Livelli di evidenza, non punti

Ogni categoria produce un **livello da 0 a 3**, e i livelli si saturano.

- Una regola **forte** contribuisce 2.
- Una regola **debole** contribuisce 1.
- **Senza almeno una regola forte, il livello si ferma a 1.**

L'ultima riga è la più importante: dieci indizi deboli non diventano una prova. Nel modello a
punti dieci regole da 15 punti facevano 150 e superavano qualunque soglia; qui restano al livello 1.

---

## 4. I quattro tipi di regola

| Tipo | Effetto |
|---|---|
| `suppress` | **Azzera** una o più categorie. Valutate per prime: nessun punteggio sopravvive a un'esenzione. |
| `veto` | Porta direttamente a rank 5, senza passare dai livelli. |
| `strong` | Contribuisce 2 livelli. |
| `weak` | Contribuisce 1 livello, e da sola non supera il livello 1. |

Due scelte deliberate.

**Il `veto` è riservato al solo riscontro di Safe Browsing.** Nessuna euristica può emetterlo,
perché nessuna euristica è un fatto verificato. Questo lega strutturalmente il rank 5 alla
variante dell'interstiziale che riporta l'attribuzione a Google, come i termini d'uso di Safe
Browsing richiedono: la conformità diventa una proprietà del modello invece di una cosa da
ricordarsi a mano.

**Le esenzioni vengono prima di tutto.** È il meccanismo che ha chiuso il falso positivo più
grave: `192.168.1.1` è una rete privata, non raggiungibile da un attaccante remoto, e su una rete
privata l'assenza di HTTPS è normale. La regola `private-network` azzera identità e trasporto, e
nessuna somma può più portare il router di casa a rank 5.

---

## 5. La tabella che produce il rank

```
rank 5  ⟸  veto (solo Safe Browsing)
rank 4  ⟸  identità ≥ 2  E  credenziali ≥ 1
rank 3  ⟸  identità ≥ 2
           O  (identità ≥ 1  E  credenziali ≥ 1)
           O  (trasporto ≥ 2  E  credenziali ≥ 1)
rank 2  ⟸  identità ≥ 1  O  trasporto ≥ 1  O  reputazione ≥ 1
rank 1  ⟸  nessuna evidenza
```

Guarda cosa **non** c'è: `credentials` non compare mai da sola.

Una pagina che chiede una password non è per questo sospetta — è la cosa più normale del web. Se
le credenziali potessero alzare il rank da sole, ogni pagina di login di ogni banca sarebbe un
allarme, e in due giorni disinstalleresti l'estensione. Le credenziali sono un **moltiplicatore**:
contano solo quando c'è già un problema di identità o di trasporto.

L'implementazione è la funzione `rankFromCategories` in [`src/scoring.js`](../src/scoring.js), ed è
l'unica: non esiste una seconda copia da tenere allineata.

---

## 6. Il percorso completo di un URL

```
        pagina caricata (document_end)
                     │
                     ▼
        ┌────────────────────────┐
        │ content.js             │   campi password, nomi dei campi,
        │ raccoglie segnali DOM  │   action dei form, titolo, og:site_name,
        └────────────┬───────────┘   testo visibile (troncato)
                     │  runtime.sendMessage
                     ▼
        ┌────────────────────────┐
        │ background.js          │   è l'unico contesto che può importare
        │ importa src/scoring.js │   moduli ES, quindi l'unico che decide
        └────────────┬───────────┘
                     ▼
        ┌────────────────────────┐
        │ buildUrlSignals        │   decodifica punycode
        │                        │   dominio registrabile via PSL
        │                        │   tokenizzazione, skeleton confondibili
        │ normalizeDomSignals    │   campi sensibili, host dei form,
        │                        │   linguaggio d'urgenza
        └────────────┬───────────┘
                     ▼
              evaluate({ phase: 'full' })
                     │
        ┌────────────┴───────────────────────────┐
        ▼                                        ▼
  risposta a content.js                  storage.session
  → interstiziale o pillola              → letto dal popup della barra
```

**Il verdetto è uno solo.** Il popup non ricalcola: legge dalla sessione lo stesso oggetto che ha
prodotto la pillola. È una scelta strutturale, non un'ottimizzazione — finché esistevano due
percorsi di calcolo ne esistevano due che divergevano, ed è successo due volte: prima fra
`content.js` e `simulator.html`, poi fra la copia legacy in `content.js` e questo motore, che
davano 3/5 e 1/5 alla stessa `www.posteitaliane.it`.

### Cosa non è ancora collegato

`mergeVerdicts` e la valutazione in due fasi esistono in `src/scoring.js`, sono testate, e non
girano ancora: il verdetto preliminare sul solo indirizzo richiederebbe di intercettare la
navigazione prima che la pagina esista, cioè `webNavigation` o `declarativeNetRequest`, e quindi
permessi che l'estensione oggi non chiede. Il costo è che l'interstiziale appare a pagina già
caricata invece che al suo posto.

La fusione è **monotona** — il rank sale, mai scende — e non è un dettaglio implementativo: se il
verdetto potesse scendere dopo il caricamento, basterebbe a un attaccante iniettare nel DOM
qualcosa che abbassi il punteggio per far ritirare un interstiziale già mostrato. La proprietà va
conservata quando la seconda fase verrà collegata.

---

## 7. Otto casi svolti

Livelli per categoria e rank risultante. Sono generati eseguendo il motore, non scritti a mano.

| Indirizzo | id | cr | tr | Rank | Regole scattate | Esenzioni |
|---|:-:|:-:|:-:|:-:|---|---|
| `https://paypal-secure.xyz/login` | 3 | 1 | 0 | **4** | `brand-in-registrable-domain`, `suspicious-tld`, `credential-surface`, `access-words-in-url` | — |
| `https://www.posteitaliane.it/` | 0 | 1 | 0 | **1** | `credential-surface` | `identity` |
| `https://login.microsoftonline.com/` | 0 | 1 | 0 | **1** | `credential-surface`, `access-words-in-url` | `identity` |
| `http://192.168.1.1/login` | 0 | 1 | 0 | **1** | `credential-surface`, `access-words-in-url` | `identity`, `transport` |
| `https://random-kit.pages.dev/signin` | 1 | 1 | 0 | **3** | `ephemeral-hosting`, `credential-surface`, `access-words-in-url` | — |
| `https://xn--80ak6aa92e.com/` | 2 | 0 | 0 | **3** | `homograph-brand-collision` | — |
| `https://xn--bcher-kva.de/` | 0 | 0 | 0 | **1** | — | — |
| `https://paypal.com@evil-collector.xyz/login` | 3 | 1 | 0 | **4** | `userinfo-in-authority`, `suspicious-tld`, `credential-surface`, `access-words-in-url` | — |

Le due righe da leggere insieme sono le ultime due degli IDN:

- `xn--80ak6aa92e.com` è `аррӏе.com` scritto in cirillico, l'omografo classico di Apple → **rank 3**
- `xn--bcher-kva.de` è `bücher.de`, un dominio tedesco perfettamente legittimo → **rank 1**

Il vecchio motore dava **rank 3 a entrambi**, perché assegnava 40 punti alla sola presenza di
`xn--` nell'hostname. Puniva ogni dominio non anglofono e, per il caso vero, arrivava alla risposta
giusta per il motivo sbagliato. Ora l'omografo scatta perché lo *skeleton* del suo nome collide con
un marchio noto — cioè perché **somiglia** ad Apple — che è la ragione per cui è pericoloso.

Nota anche la seconda riga: su `posteitaliane.it` la categoria identità non vale 0 perché nessuna
regola l'abbia guardata, ma perché `trusted-brand-domain` l'ha **soppressa**. Il dominio è
dichiarato come legittimo del marchio Poste in [`src/brands.js`](../src/brands.js).

---

## 8. Perché il rank 1 non dice «sicuro»

L'etichetta del livello 1 è **«Nessun segnale noto»**, e c'è un test nella suite che fallisce se
qualcuno la cambia in qualcosa che contenga la parola «sicuro».

Il motivo sta nella tabella sopra: `random-kit.pages.dev/signin` è phishing reale, con certificato
valido, su un dominio che nessuna lista nera conosce, e nel vecchio motore prendeva **zero punti**.
La forma dominante del phishing attuale è esattamente questa — hosting gratuito, TLS valido,
esfiltrazione via JavaScript — e un motore euristico può non vederla.

Un'estensione che in quel caso avesse scritto «sito sicuro» avrebbe fatto **più danni che non
esistere**, perché avrebbe sostituito la prudenza dell'utente con una certezza falsa. L'assenza di
segnali è assenza di informazione, e va comunicata come tale.

---

## 9. Come si ricalibra

Senza modello statistico, e senza dover indovinare: **il corpus è lo strumento**.

- [`test/corpus/benign.json`](../test/corpus/benign.json) — siti legittimi, ciascuno con il
  `maxRank` accettabile. Superarlo è un falso positivo.
- [`test/corpus/malicious.json`](../test/corpus/malicious.json) — pagine di phishing, ciascuna con
  il `minRank` richiesto e con `mustFire`, l'elenco delle regole che *devono* scattare perché il
  caso non passi per il motivo sbagliato.

Una modifica ai pesi o alle regole che faccia regredire uno dei due insiemi **rompe la build**.

Le voci portano anche la memoria dei difetti chiusi: `wasFalsePositive` e `wasFalseNegative`
registrano il rank che il vecchio motore additivo produceva, e un test verifica che quei valori non
tornino. Sono nove falsi positivi e tre falsi negativi che non possono riaprirsi in silenzio.

Il modo più utile di contribuire al progetto è aggiungere un caso qui: vale più di una regola
scritta in fretta, perché è ciò che impedisce a una correzione futura di riaprire il difetto.

---

## Vedi anche

- [`../README.md`](../README.md) — cos'è il progetto, installazione, privacy
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — come aggiungere regole e casi
- [`../SECURITY.md`](../SECURITY.md) — modello di minaccia e segnalazione delle vulnerabilità
