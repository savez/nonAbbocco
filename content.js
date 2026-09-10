/**
 * NonAbbocco Defender - Content Script (content.js)
 * Analisi euristica combinata di URL e DOM, calcolo Ranking 1-5,
 * gestione della soglia personalizzata via chrome.storage e layer protetto in Closed Shadow DOM.
 */
(function () {
  'use strict';

  // Evita reiniezioni multiple nella medesima pagina
  if (window.__NONABBOCCO_INITIALIZED__) return;
  window.__NONABBOCCO_INITIALIZED__ = true;

  const currentUrl = window.location.href;
  const hostname = window.location.hostname.toLowerCase();
  const protocol = window.location.protocol;
  const bypassStorageKey = `nonabbocco_bypass_${hostname}`;

  // Se l'utente ha scelto di ignorare il rischio per questa sessione, non bloccare
  if (sessionStorage.getItem(bypassStorageKey) === 'true') {
    console.info('[NonAbbocco] Sessione autorizzata tramite bypass utente.');
    return;
  }

  // Lettura della soglia configurata (Default = 5: blocco immediato a schermo solo al livello 5)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ blockThreshold: 5 }, (items) => {
      analyzePage(items.blockThreshold || 5);
    });
  } else {
    analyzePage(5);
  }

  function analyzePage(blockThreshold) {
    let score = 0;
    const anomalies = [];

    const KNOWN_BRANDS = [
      'paypal', 'poste', 'posteitaliane', 'intesasanpaolo', 'unicredit',
      'bnl', 'ingdirect', 'apple', 'google', 'amazon', 'microsoft', 'netflix', 'facebook'
    ];
    const HIGH_RISK_TLDS = ['.xyz', '.top', '.work', '.buzz', '.icu', '.tk', '.ml', '.ga', '.cf', '.gq', '.shop'];

    // 1. ANALISI EURISTICA DELL'URL
    const isIpHost = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    if (isIpHost) {
      score += 45;
      anomalies.push("L'indirizzo web è composto da un IP grezzo anziché da un dominio nominale.");
    }

    if (hostname.includes('xn--')) {
      score += 40;
      anomalies.push("Presenza di caratteri punycode (possibile attacco omografo fraudolento).");
    }

    for (const brand of KNOWN_BRANDS) {
      if (hostname.includes(brand)) {
        const isLegit = hostname === `${brand}.com` || hostname === `${brand}.it` ||
                        hostname.endsWith(`.${brand}.com`) || hostname.endsWith(`.${brand}.it`);
        if (!isLegit) {
          score += 55;
          anomalies.push(`Imitazione o typosquatting del marchio autentico "${brand.toUpperCase()}".`);
          break;
        }
      }
    }

    const matchedTld = HIGH_RISK_TLDS.find(tld => hostname.endsWith(tld));
    if (matchedTld && (hostname.includes('login') || hostname.includes('account') || hostname.includes('verify'))) {
      score += 30;
      anomalies.push(`Dominio con estensione economica a rischio (${matchedTld}) abbinata a parole d'accesso.`);
    }

    // 2. ANALISI DEL DOM DELLA PAGINA
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    const forms = document.querySelectorAll('form');

    if (passwordInputs.length > 0 && protocol === 'http:') {
      score += 50;
      anomalies.push("Invio credenziali di sicurezza su protocollo HTTP non crittografato.");
    }

    forms.forEach(form => {
      if (form.querySelector('input[type="password"]')) {
        const action = form.getAttribute('action') || '';
        try {
          if (action.startsWith('http://') || action.startsWith('https://')) {
            const targetHost = new URL(action).hostname.toLowerCase();
            if (targetHost !== hostname && !targetHost.endsWith('.' + hostname)) {
              score += 65;
              anomalies.push(`La password viene inviata a un server esterno non appartenente al dominio (${targetHost}).`);
            }
          }
        } catch (e) {}
      }
    });

    // 3. CALCOLO DEL RANKING DI RISCHIO SU SCALA 1-5
    let rank = 1;
    if (score >= 80) rank = 5;       // Minaccia Critica Phishing
    else if (score >= 60) rank = 4;  // Rischio Elevato
    else if (score >= 40) rank = 3;  // Sospetto Moderato
    else if (score >= 20) rank = 2;  // Attenzione Minima
    else rank = 1;                   // Ritenuto Sicuro

    // 4. DECISIONE: BLOCCO TOTALE vs PILLOLA VISIBILE
    if (rank >= blockThreshold) {
      injectFullBlockOverlay(rank, anomalies, bypassStorageKey);
    } else if (rank >= 2) {
      injectDiscreetPill(rank, anomalies);
    }
  }

  // SCHERMATA DI BLOCCO TRAMITE CLOSED SHADOW DOM
  function injectFullBlockOverlay(rank, reasons, storageKey) {
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
          <div class="badge">🎣 NONABBOCCO: RANKING DI RISCHIO ${rank}/5</div>
          <h1>Attenzione: Non Abboccare all'Esca!</h1>
          <p>Il motore di NonAbbocco ha rilevato caratteristiche evidenti di truffa e furto credenziali. La pagina è stata interrotta per salvaguardare le tue password.</p>
          <div class="reasons">
            <strong>Anomalie individuate:</strong>
            <ul>${reasons.map(r => `<li>${r}</li>`).join('')}</ul>
          </div>
          <div class="actions">
            <button class="btn-safe" id="btn-safe">Torna al sicuro</button>
            <button class="btn-bypass" id="btn-bypass">Ignora rischio e procedi (Bypass)</button>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(root);

    shadow.getElementById('btn-safe').addEventListener('click', () => {
      window.history.length > 1 ? window.history.back() : (window.location.href = 'https://www.google.com');
    });

    shadow.getElementById('btn-bypass').addEventListener('click', () => {
      sessionStorage.setItem(storageKey, 'true');
      root.remove();
    });
  }

  // PILLOLA DISCRETA PER LIVELLI INTERMEDI SOTTO SOGLIA (1-4)
  function injectDiscreetPill(rank, reasons) {
    const root = document.createElement('div');
    root.id = 'nonabbocco-pill-indicator';
    root.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;pointer-events:auto;';
    const shadow = root.attachShadow({ mode: 'closed' });

    const colorConfig = {
      2: { bg: '#064e3b', border: '#10b981', text: '#a7f3d0', label: 'Rischio Basso (2/5)' },
      3: { bg: '#78350f', border: '#f59e0b', text: '#fde68a', label: 'Sospetto Moderato (3/5)' },
      4: { bg: '#831843', border: '#f43f5e', text: '#fecdd3', label: 'Rischio Elevato (4/5)' }
    };
    const c = colorConfig[rank] || colorConfig[3];

    shadow.innerHTML = `
      <style>
        .pill { background:${c.bg}; border:1px solid ${c.border}; color:${c.text}; padding:8px 14px; border-radius:999px; font-family:sans-serif; font-size:12px; font-weight:700; display:flex; align-items:center; gap:8px; box-shadow:0 8px 25px rgba(0,0,0,0.5); backdrop-filter:blur(8px); }
        .close-btn { background:transparent; border:none; color:${c.text}; cursor:pointer; font-weight:bold; font-size:14px; margin-left:4px; opacity:0.8; }
        .close-btn:hover { opacity:1; }
      </style>
      <div class="pill">
        <span>🎣 NonAbbocco: ${c.label}</span>
        <button class="close-btn" id="close-pill" title="Chiudi notifica">✕</button>
      </div>
    `;

    document.documentElement.appendChild(root);
    shadow.getElementById('close-pill').addEventListener('click', () => root.remove());
  }
})();