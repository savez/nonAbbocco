/**
 * Cosa può dire il modello, e cosa ne mostriamo.
 *
 * Il modello è un ospite: la sua risposta si valida come se arrivasse dalla
 * rete. Qualunque cosa fuori forma diventa `null` e la UI dice «risposta non
 * valida», senza mai lanciare.
 */

/** Lista chiusa: il modello sceglie fra queste, non ne inventa altre. */
export const SITE_CATEGORIES = [
  'banca',
  'pagamenti',
  'e-commerce',
  'social',
  'posta',
  'pubblica-amministrazione',
  'spedizioni',
  'altro'
];

/**
 * @typedef {{ phishing: number, category: string }} AiAnswer
 *   `phishing` è una probabilità fra 0 e 1.
 */

/**
 * @param {unknown} raw
 * @returns {AiAnswer | null}
 */
export function parseAnswer(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const { phishing, category } = /** @type {Record<string, unknown>} */ (raw);

  if (typeof phishing !== 'number' || !Number.isFinite(phishing)) return null;
  if (phishing < 0 || phishing > 1) return null;
  // `includes` su array, non una ricerca per chiave: `constructor` e
  // `__proto__` non sono categorie.
  if (typeof category !== 'string' || !SITE_CATEGORIES.includes(category)) return null;

  return { phishing, category };
}

/**
 * La categoria «altro» non dice niente: non si mostra.
 * @param {AiAnswer} ai
 * @returns {string | null}
 */
export function displayCategory(ai) {
  return ai.category === 'altro' ? null : ai.category;
}
