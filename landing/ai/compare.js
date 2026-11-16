/**
 * Il confronto fra il motore e il modello.
 *
 * Questa funzione NON riceve e NON restituisce un rank: il modello non può
 * alzare né abbassare il verdetto del motore, può solo dire se è d'accordo.
 * Un testo ostile che convince il modello a rispondere «sicuro» produce al
 * massimo un disaccordo visibile, mai un rank più basso.
 */

/** Dal livello 3 («Sospetto moderato») in su il motore considera la pagina sospetta. */
export const ENGINE_SUSPECT_FROM = 3;
/** Da questa probabilità in su il modello considera la pagina phishing. */
export const AI_SUSPECT_FROM = 0.5;

/**
 * @param {number} engineRank
 * @param {{ phishing: number } | null} ai
 * @returns {'nessun-parere' | 'concorde' | 'ia-piu-severa' | 'ia-meno-severa'}
 */
export function compare(engineRank, ai) {
  if (!ai) return 'nessun-parere';
  const engineSuspects = engineRank >= ENGINE_SUSPECT_FROM;
  const aiSuspects = ai.phishing >= AI_SUSPECT_FROM;
  if (engineSuspects === aiSuspects) return 'concorde';
  return aiSuspects ? 'ia-piu-severa' : 'ia-meno-severa';
}
