/**
 * NonAbbocco Defender — Content Script (content.js)
 *
 * Raccoglie segnali dal DOM, li manda al background, disegna quello che il
 * background risponde. Non decide nulla.
 *
 * ─── PERCHÉ NON DECIDE NULLA ─────────────────────────────────────────────────
 *
 * Questo file gira su <all_urls>, cioè anche dentro la pagina dell'attaccante.
 * Ogni euristica che vive qui è un'euristica che l'avversario può leggere e
 * calibrare, e ogni segreto che passa di qui è un segreto bruciato.
 *
 * Fino alla versione precedente conteneva una copia storica del motore — somma
 * di punti, soglie fisse, tredici marchi confrontati per sottostringa — mentre
 * la definizione canonica stava già in `src/scoring.js`, testata e coperta dal
 * corpus, ma non caricata da nessun percorso runtime. Le due divergevano:
 * `www.posteitaliane.it` prendeva 3/5 qui e 1/5 dal motore vero, perché
 * `hostname.includes('poste')` non sa distinguere Poste dal phishing che la
 * imita. Quella copia non c'è più. Il motore gira in `background.js`, che è un
 * modulo ES e può importarlo.
 *
 * Quello che resta qui è deliberatamente stupido: leggere il DOM, spedire,
 * disegnare.
 *
 * ─── DIFETTI NOTI ANCORA PRESENTI ────────────────────────────────────────────
 *
 * Documentati in docs/RANKING.md:
 *   - l'overlay e la pillola sono nodi del DOM della pagina, quindi la pagina
 *     ostile li rimuove con una riga di JS;
 *   - il bypass vive in sessionStorage, che la pagina può scrivere da sé.
 *
 * Nessuno dei due è risolvibile da dentro un content script; la strada è
 * `declarativeNetRequest` con una pagina di interstiziale dell'estensione.
 */
(function () {
  'use strict';

  // Solo il documento principale. Senza questo, ogni iframe pubblicitario di
  // ogni pagina raccoglierebbe il proprio DOM e manderebbe il proprio
  // messaggio. Il background filtra comunque per `frameId`, ma non far partire
  // il lavoro è meglio che scartarlo dopo.
  if (window.top !== window) return;

  if (window.__NONABBOCCO_INITIALIZED__) return;
  window.__NONABBOCCO_INITIALIZED__ = true;

  const api = globalThis.browser ?? globalThis.chrome;

  /**
   * Il testo della pagina serve solo a cercare i modi di dire dell'urgenza.
   * Troncarlo: è contenuto di una pagina potenzialmente ostile e non c'è
   * ragione di spedirne megabyte attraverso il confine dei processi.
   */
  const MAX_VISIBLE_TEXT = 20000;

  /** Oltre questo numero i nomi dei campi non aggiungono informazione. */
  const MAX_FIELD_NAMES = 200;

  const bypassStorageKey = `nonabbocco_bypass_${window.location.hostname.toLowerCase()}`;

  run();

  async function run() {
    let response;
    try {
      response = await api.runtime.sendMessage({
        type: 'analyze',
        // Ripiego: il background preferisce `sender.url`, che la pagina non
        // può falsificare.
        url: window.location.href,
        dom: collectDomSignals()
      });
    } catch {
      // Il background non risponde: succede quando l'estensione è stata
      // ricaricata mentre la scheda era aperta. Non c'è niente da disegnare.
      return;
    }

    if (!response || !response.verdict) return;
    render(response);
  }

  // ─── RACCOLTA ──────────────────────────────────────────────────────────────

  /**
   * Produce esattamente la forma che `normalizeDomSignals` si aspetta in
   * `src/scoring.js`. Se quella cambia, cambia anche questa: è l'unico
   * contratto fra i due file.
   */
  function collectDomSignals() {
    return {
      passwordFieldCount: document.querySelectorAll('input[type="password"]').length,
      fieldNames: collectFieldNames(),
      credentialForms: collectCredentialForms(),
      title: document.title || '',
      ogSiteName: metaContent('og:site_name'),
      visibleText: (document.body?.innerText || '').slice(0, MAX_VISIBLE_TEXT)
    };
  }

  function collectFieldNames() {
    const names = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      for (const value of [el.name, el.id, el.getAttribute('autocomplete')]) {
        if (value) names.push(String(value));
        if (names.length >= MAX_FIELD_NAMES) return names;
      }
    }
    return names;
  }

  function collectCredentialForms() {
    const forms = [];
    for (const form of document.querySelectorAll('form')) {
      if (!form.querySelector('input[type="password"]')) continue;
      // L'attributo `action` grezzo può essere relativo, o assente: va risolto
      // contro l'URL della pagina, altrimenti un `action="/login"` verrebbe
      // scartato e un `action=""` letto come host vuoto.
      const actionHost = resolveHost(form.getAttribute('action'));
      if (actionHost) forms.push({ actionHost });
    }
    return forms;
  }

  function resolveHost(action) {
    try {
      return new URL(action || '', window.location.href).hostname;
    } catch {
      return null;
    }
  }

  function metaContent(property) {
    const el = document.querySelector(`meta[property="${property}"]`);
    return el?.getAttribute('content') || '';
  }

  // ─── RENDERING ─────────────────────────────────────────────────────────────

  /**
   * @param {{verdict: object, blockThreshold: number, presentation: object}} response
   */
  function render({ verdict, blockThreshold, presentation }) {
    // Le soppressioni spiegano perché NON è scattato nulla: non sono anomalie
    // e non vanno elencate come tali.
    const reasons = (verdict.fired || [])
      .filter((f) => f.kind !== 'suppress')
      .map((f) => f.message);

    if (presentation.rank >= blockThreshold) {
      // Il bypass non impedisce più l'analisi, solo il blocco. Prima usciva
      // prima di analizzare, e il popup restava muto proprio sulle pagine che
      // l'utente aveva scelto di scavalcare — cioè quelle su cui avrebbe avuto
      // più senso poter riguardare il verdetto.
      if (isBypassed()) return;
      injectFullBlockOverlay(presentation, reasons);
    } else if (presentation.rank >= 2) {
      injectDiscreetPill(presentation, reasons);
    }
  }

  function isBypassed() {
    try {
      return sessionStorage.getItem(bypassStorageKey) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Costruisce la lista delle anomalie con `textContent`.
   *
   * I messaggi del motore interpolano valori che vengono dalla pagina — il
   * titolo, l'host di destinazione di un form — quindi comporli con
   * `innerHTML`, come faceva la versione precedente, dava alla pagina ostile
   * un modo per scrivere markup dentro l'avviso che la accusa.
   */
  function reasonList(reasons) {
    const ul = document.createElement('ul');
    for (const reason of reasons) {
      const li = document.createElement('li');
      li.textContent = reason;
      ul.appendChild(li);
    }
    return ul;
  }

  // SCHERMATA DI BLOCCO TRAMITE CLOSED SHADOW DOM
  function injectFullBlockOverlay(presentation, reasons) {
    const { rank, label, subtitle } = presentation;

    const root = document.createElement('div');
    root.id = 'nonabbocco-shield-blocker';
    root.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:auto;';
    const shadow = root.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
      <style>
        .backdrop { position:fixed; inset:0; background:rgba(6,9,18,0.96); backdrop-filter:blur(16px); display:flex; align-items:center; justify-content:center; color:#fff; font-family:-apple-system,BlinkMacSystemFont,sans-serif; padding:16px; box-sizing:border-box; }
        .box { max-width:540px; width:100%; background:linear-gradient(180deg,#2b0810 0%,#090d16 100%); border:2px solid #f43f5e; border-radius:24px; padding:32px; box-shadow:0 25px 60px rgba(244,63,94,0.35); text-align:center; }
        .badge { display:inline-flex; align-items:center; gap:6px; background:#f43f5e; color:#fff; font-weight:800; font-size:12px; padding:4px 14px; border-radius:999px; margin-bottom:14px; letter-spacing:0.5px; }
        h1 { font-size:22px; font-weight:800; margin:0 0 10px; color:#fff; }
        p { font-size:13px; color:#cbd5e1; line-height:1.5; margin:0 0 18px; }
        .reasons { background:rgba(0,0,0,0.55); border:1px solid rgba(244,63,94,0.35); border-radius:14px; padding:14px; text-align:left; font-size:12px; margin-bottom:22px; }
        .reasons strong { color:#fda4af; display:block; margin-bottom:6px; }
        ul { margin:0; padding-left:18px; color:#f1f5f9; }
        li { margin-bottom:4px; }
        .actions { display:flex; gap:12px; }
        .btn-safe { flex:1; padding:12px; background:#ffffff; color:#0f172a; font-weight:700; border-radius:12px; border:none; cursor:pointer; font-size:13px; }
        .btn-bypass { padding:12px 18px; background:rgba(244,63,94,0.2); border:1px solid rgba(244,63,94,0.5); color:#fecdd3; border-radius:12px; font-weight:600; cursor:pointer; font-size:13px; }
      </style>
      <div class="backdrop">
        <div class="box">
          <div class="badge" id="badge"></div>
          <h1>Attenzione: Non Abboccare all'Esca!</h1>
          <p id="subtitle"></p>
          <div class="reasons">
            <strong>Anomalie individuate:</strong>
            <div id="reasons"></div>
          </div>
          <div class="actions">
            <button class="btn-safe" id="btn-safe">Torna al sicuro</button>
            <button class="btn-bypass" id="btn-bypass">Ignora rischio e procedi (Bypass)</button>
          </div>
        </div>
      </div>
    `;

    shadow.getElementById('badge').textContent = `🎣 NONABBOCCO: RANKING ${rank}/5 — ${label}`;
    shadow.getElementById('subtitle').textContent = subtitle;
    shadow.getElementById('reasons').appendChild(reasonList(reasons));

    document.documentElement.appendChild(root);

    shadow.getElementById('btn-safe').addEventListener('click', () => {
      window.history.length > 1 ? window.history.back() : (window.location.href = 'https://www.google.com');
    });

    shadow.getElementById('btn-bypass').addEventListener('click', () => {
      try {
        sessionStorage.setItem(bypassStorageKey, 'true');
      } catch { /* pagina senza sessionStorage: il bypass vale per questa vista */ }
      root.remove();
    });
  }

  // PILLOLA DISCRETA PER I LIVELLI SOTTO LA SOGLIA DI BLOCCO
  function injectDiscreetPill(presentation, reasons) {
    const { rank, label, palette } = presentation;

    const root = document.createElement('div');
    root.id = 'nonabbocco-pill-indicator';
    root.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;pointer-events:auto;';
    const shadow = root.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
      <style>
        .pill { background:${palette.bg}; border:1px solid ${palette.border}; color:${palette.text}; padding:8px 14px; border-radius:14px; font-family:-apple-system,BlinkMacSystemFont,sans-serif; font-size:12px; font-weight:700; display:flex; align-items:flex-start; gap:8px; box-shadow:0 8px 25px rgba(0,0,0,0.5); backdrop-filter:blur(8px); max-width:320px; }
        .body { display:flex; flex-direction:column; gap:4px; }
        ul { margin:0; padding-left:16px; font-weight:400; opacity:0.9; }
        li { margin-bottom:2px; }
        .close-btn { background:transparent; border:none; color:${palette.text}; cursor:pointer; font-weight:bold; font-size:14px; margin-left:4px; opacity:0.8; line-height:1; }
        .close-btn:hover { opacity:1; }
      </style>
      <div class="pill">
        <div class="body">
          <span id="headline"></span>
          <div id="reasons"></div>
        </div>
        <button class="close-btn" id="close-pill" title="Chiudi notifica">✕</button>
      </div>
    `;

    shadow.getElementById('headline').textContent = `🎣 NonAbbocco: ${label} (${rank}/5)`;
    // Il parametro `reasons` esisteva già nella firma e veniva ignorato: la
    // pillola diceva che qualcosa non andava senza mai dire cosa.
    shadow.getElementById('reasons').appendChild(reasonList(reasons));

    document.documentElement.appendChild(root);
    shadow.getElementById('close-pill').addEventListener('click', () => root.remove());
  }
})();
