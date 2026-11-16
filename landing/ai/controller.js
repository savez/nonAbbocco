/**
 * Mette insieme le parti: input → domande → modello → risposta validata →
 * confronto col motore.
 *
 * Non lancia mai e non restituisce un rank: la UI decide cosa mostrare dallo
 * `status`, e il verdetto del motore resta quello di `src/scoring.js`.
 * Il modello si carica altrove (`runner.load()`, dopo il consenso).
 */

import { buildQuestions } from './prompt.js';
import { parseAnswer } from './schema.js';
import { compare } from './compare.js';

/**
 * @typedef {{ answer(qs: ReturnType<typeof buildQuestions>): Promise<unknown> }} Answerer
 */

/**
 * @param {Parameters<typeof buildQuestions>[0]} input
 * @param {number} engineRank
 * @param {Answerer} runner
 * @returns {Promise<
 *   { status: 'ok', ai: import('./schema.js').AiAnswer, relation: ReturnType<typeof compare> } |
 *   { status: 'invalid' | 'error', message: string }
 * >}
 */
export async function analyzeUrl(input, engineRank, runner) {
  let raw;
  try {
    raw = await runner.answer(buildQuestions(input));
  } catch (e) {
    const detail = e instanceof Error && e.message ? e.message : 'errore sconosciuto';
    return { status: 'error', message: `Il modello non ha risposto: ${detail}` };
  }

  const ai = parseAnswer(raw);
  if (!ai) return { status: 'invalid', message: 'La risposta del modello non è valida: la ignoro.' };

  return { status: 'ok', ai, relation: compare(engineRank, ai) };
}
