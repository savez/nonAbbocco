/**
 * La scala del rank come dato: numero, etichetta, sottotitolo, colori.
 *
 * Esiste perché la stessa scala va disegnata in tre posti — la pillola e
 * l'interstiziale dentro la pagina, il popup della barra — e prima ne esisteva
 * una copia sola e incompleta: `colorConfig` in content.js definiva i colori
 * per i ranghi 2, 3 e 4 e ripiegava silenziosamente sul 3 per tutto il resto.
 * Il rango 5, cioè l'unico che conta davvero, era colorato come un sospetto
 * moderato.
 *
 * I colori non sono decorazione: sono il segnale letto per primo, spesso
 * l'unico letto. Il rango 1 è deliberatamente NEUTRO e non verde — un verde
 * comunica "sicuro", e il rango 1 significa soltanto "nessun segnale noto".
 * La distinzione è la stessa che RANK_SUBTITLES difende a parole, e vale la
 * pena difenderla anche a colori.
 *
 * Le etichette e i sottotitoli non sono duplicati qui: restano in
 * `messages.it.js`, che è il posto dei testi.
 */

import { RANK_LABELS, RANK_SUBTITLES } from './messages.it.js';

/** I ranghi esistenti, in ordine. Usato dai test per l'esaustività. */
export const RANK_RANGE = [1, 2, 3, 4, 5];

/**
 * @typedef {object} RankPalette
 * @property {string} bg      Sfondo della pillola o del badge.
 * @property {string} border  Bordo.
 * @property {string} text    Testo sopra `bg`.
 * @property {string} accent  Tinta piena, per le tacche delle categorie.
 */

/** @type {Record<number, RankPalette>} */
export const RANK_PALETTES = {
  1: { bg: '#1e293b', border: '#475569', text: '#cbd5e1', accent: '#64748b' },
  2: { bg: '#064e3b', border: '#10b981', text: '#a7f3d0', accent: '#10b981' },
  3: { bg: '#78350f', border: '#f59e0b', text: '#fde68a', accent: '#f59e0b' },
  4: { bg: '#831843', border: '#f43f5e', text: '#fecdd3', accent: '#f43f5e' },
  5: { bg: '#450a0a', border: '#dc2626', text: '#fecaca', accent: '#dc2626' }
};

/**
 * Normalizza un rango a un intero nell'intervallo valido. Un verdetto
 * malformato non deve far collassare il rendering su un colore arbitrario.
 * @param {unknown} rank
 * @returns {number}
 */
export function clampRank(rank) {
  const n = Math.round(Number(rank));
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, n));
}

/**
 * Tutto ciò che serve per disegnare un rango, in un colpo solo.
 * @param {unknown} rank
 * @returns {{rank: number, label: string, subtitle: string, palette: RankPalette}}
 */
export function rankPresentation(rank) {
  const r = clampRank(rank);
  return {
    rank: r,
    label: RANK_LABELS[r],
    subtitle: RANK_SUBTITLES[r],
    palette: RANK_PALETTES[r]
  };
}
