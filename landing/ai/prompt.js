/**
 * Le due domande che facciamo al modello, e lo stato su cui le facciamo.
 *
 * Il testo delle domande e delle opzioni è FISSO e in inglese: è quello
 * misurato nello spike (docs/superpowers/spikes/d1-browser/REPORT.md, 85,7% di
 * concordanza sul corpus). Riformularlo invalida la misura: rimisurare prima.
 *
 * L'input del visitatore entra solo nello `state`, che per il modello è un
 * dato: non compare mai nel testo delle domande, quindi «ignora le istruzioni»
 * in un titolo non ha nessun posto da cui parlare.
 */

import { SITE_CATEGORIES } from './schema.js';

/** Oltre questa lunghezza un campo si taglia: un URL di 5000 caratteri non è un URL. */
export const MAX_FIELD_CHARS = 500;

const PHISHING_INSTRUCTIONS = 'Is this web page a phishing page that tries to steal credentials, payments or personal data?';
const PHISHING_CRITERIA = {
  true: 'yes, the page imitates another brand or tricks visitors into giving credentials, payments or personal data',
  false: 'no, it is the genuine website of the organisation or an ordinary legitimate page'
};

const CATEGORY_INSTRUCTIONS = 'What kind of service does this web page belong to?';
const CATEGORY_DESCRIPTIONS = {
  banca: 'bank, credit institution or home banking',
  pagamenti: 'payment service, card or digital wallet',
  'e-commerce': 'online shop or marketplace',
  social: 'social network or messaging',
  posta: 'email or webmail',
  'pubblica-amministrazione': 'government, tax or public administration',
  spedizioni: 'courier, parcel delivery or postal service',
  altro: 'none of the above'
};

/**
 * @typedef {{ type: 'noul' | 'choice', instructions: string, criteria: Record<string, string> }} Question
 */

/** Taglia per punti di codice, per non lasciare mezza coppia surrogata. */
function clip(value) {
  const chars = Array.from(String(value));
  return chars.length > MAX_FIELD_CHARS ? chars.slice(0, MAX_FIELD_CHARS).join('') : chars.join('');
}

/**
 * @param {{ url?: string, title?: string, formAction?: string, hasPassword?: boolean, urgency?: boolean }} [input]
 * @returns {{ state: Record<string, string | boolean | null>, phishing: Question, category: Question }}
 */
export function buildQuestions(input = {}) {
  const { url, title, formAction, hasPassword, urgency } = input ?? {};

  // La forma di `url`, `has_password_field` e `form_action` è quella dello
  // spike: ha prodotto le misure del report, quindi non si cambia a occhio.
  const state = {
    url: clip(url ?? ''),
    has_password_field: Boolean(hasPassword),
    form_action: formAction ? clip(formAction) : null
  };
  if (title) state.title = clip(title);
  if (urgency) state.urgent_language = true;

  return {
    state,
    phishing: { type: 'noul', instructions: PHISHING_INSTRUCTIONS, criteria: { ...PHISHING_CRITERIA } },
    category: {
      type: 'choice',
      instructions: CATEGORY_INSTRUCTIONS,
      criteria: Object.fromEntries(SITE_CATEGORIES.map((name) => [name, CATEGORY_DESCRIPTIONS[name]]))
    }
  };
}
