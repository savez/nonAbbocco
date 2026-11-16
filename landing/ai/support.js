/**
 * La landing usa il modello solo con WebGPU: senza, mostra un avviso e non fa
 * nulla (nessun fallback WASM, nessun download).
 *
 * Non basta che `navigator.gpu` esista: con la GPU in blocklist o i driver
 * vecchi il browser lo dichiara ma `requestAdapter()` restituisce `null`.
 */

/**
 * @param {{ gpu?: { requestAdapter?: () => Promise<unknown> } } | undefined} [nav]
 * @returns {Promise<boolean>}
 */
export async function isWebGpuAvailable(nav = globalThis.navigator) {
  try {
    if (typeof nav?.gpu?.requestAdapter !== 'function') return false;
    return Boolean(await nav.gpu.requestAdapter());
  } catch {
    return false;
  }
}
