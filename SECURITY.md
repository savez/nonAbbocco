# Segnalare una vulnerabilità

NonAbbocco è uno strumento di sicurezza: un difetto qui può esporre proprio gli utenti che
dovrebbe proteggere. Le segnalazioni sono benvenute e prese sul serio.

## Come segnalare

**Non aprire una issue pubblica per una vulnerabilità.** Usa una delle due strade:

1. **GitHub Security Advisories** — dalla tab *Security* del repository, "Report a vulnerability".
   È il canale preferito: resta privato fino alla pubblicazione della correzione.
2. In alternativa, contatta il manutentore in privato.

Includi, se puoi: versione dell'estensione e del browser, passi per riprodurre, e cosa un
attaccante otterrebbe.

Non c'è un programma di bug bounty: questo è un progetto personale a licenza MIT, mantenuto
nel tempo libero.

## Cosa rientra nel modello di minaccia

Considero vulnerabilità, in ordine di gravità:

- **Aggiramento del blocco**: una pagina ostile che riesce a rimuovere, nascondere o impedire
  l'interstiziale di blocco.
- **Concessione forgiata del bypass**: qualunque strada per cui una pagina web ottenga
  un'autorizzazione a procedere senza che l'utente l'abbia data dall'interstiziale.

  La concessione vive in `storage.session`, lato background, ed è chiavata su scheda e sito. I
  content script non possono leggerla né scriverla, e l'unico modo per registrarla è un messaggio
  che il background accetta soltanto se arriva dal documento principale di una scheda reale —
  condizione che verifica su `sender`, cioè su dati scritti dal browser e non dalla pagina.
  Finché stava in `sessionStorage` una pagina ostile poteva dichiararsi già scavalcata; quella
  strada è chiusa.
- **Escalation dal content script**: il content script gira su `<all_urls>`, quindi anche
  dentro la pagina dell'attaccante. Qualunque modo per cui la pagina lo usi per raggiungere il
  background, leggere stato privilegiato o influenzare un verdetto.

  Il canale fra i due esiste ed è volutamente stretto. Il content script manda segnali DOM e
  nient'altro; il background prende l'indirizzo da `sender.url`, che lo scrive il browser, e non
  dal messaggio, che viene da dentro la pagina; scarta i messaggi che non arrivano dal documento
  principale di una scheda reale; e archivia il verdetto in `storage.session`, che i content
  script non possono leggere. Un percorso che aggiri una qualunque di queste è una vulnerabilità.
- **Esfiltrazione di dati**: qualunque percorso per cui URL visitati, contenuti di pagina o la
  API key di Safe Browsing dell'utente lascino il browser in modo non documentato nel README.
- **Falso negativo strutturale**: non un singolo sito non riconosciuto, ma una *classe* di
  attacchi che il motore non può vedere per costruzione e che non sia già dichiarata nei limiti
  documentati.

## Cosa NON è una vulnerabilità

Per trasparenza, questi sono limiti noti e dichiarati, non difetti:

- **Un singolo sito di phishing non riconosciuto.** Il motore è euristico e la sua copertura è
  parziale per costruzione. Apri una normale issue: è un miglioramento di regola, non una falla.
- **Un falso positivo su un sito legittimo.** Apri una issue pubblica con l'URL: serve ad
  ampliare il corpus di test.
- **La finestra di race dell'interstiziale.** In Manifest V3 non esiste alcun hook di rete
  bloccante, quindi la pagina inizia a caricarsi prima che il verdetto esista.
- **La rimozione dell'overlay da parte della pagina.** L'interstiziale e la pillola sono nodi del
  DOM della pagina analizzata: una riga di JS li toglie. È un limite dell'approccio a content
  script, non un difetto di implementazione, ed è dichiarato. La strada per chiuderlo — un
  interstiziale che sia una pagina dell'estensione, raggiunta con `webNavigation` prima che la
  pagina esista — è la Fase 5 di `docs/ROADMAP.md`.
- **Il fatto che un rank 1 non garantisca nulla.** "Nessun segnale noto" non significa "sicuro",
  ed è scritto così di proposito in tutta la UI.
- **Rilevabilità dell'estensione** da parte di una pagina, quando derivi da meccanismi
  documentati.

## Versioni supportate

Riceve correzioni solo l'ultima versione pubblicata sul ramo `main`.
