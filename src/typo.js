/**
 * L'errore di battitura come segnale.
 *
 * Il motore prendeva il marchio scritto per intero (`paypal-secure.xyz`, per
 * token) e il marchio scritto con caratteri confondibili (`pаypal.com`, per
 * skeleton). Non prendeva il caso più banale di tutti: il marchio scritto
 * male. `paypall.com`, `amazn.it`, `microsft-account.xyz` passavano puliti.
 *
 * ─── PERCHÉ NON LA DISTANZA DI EDIT, MA TRE FORME SCELTE ─────────────────────
 *
 * La tentazione è «distanza di Levenshtein ≤ 1». È sbagliata, e si vede
 * misurando invece che ragionando. Su 208 domini reali — i domini legittimi
 * dichiarati dai marchi, più un campione di siti italiani veri — e 17
 * typosquatting costruiti a mano:
 *
 *     distanza 1 piena ................. 17/17 attacchi,  3 falsi positivi
 *     senza sostituzione ............... 17/17 attacchi,  1 falso positivo
 *     + inserzione solo come raddoppio . 17/17 attacchi,  0 falsi positivi
 *
 * La SOSTITUZIONE non aggiungeva un solo attacco e triplicava i falsi
 * positivi: è quella che trasforma `intesa` in `intera`, che è una parola
 * italiana. L'INSERZIONE LIBERA ne lasciava uno: `intesa` → `intensa`, un
 * aggettivo comune.
 *
 * Restano tre forme, che sono poi i modi in cui le dita sbagliano davvero e in
 * cui gli attaccanti registrano i domini:
 *
 *     raddoppio      paypal  → paypall,  google → gooogle
 *     cancellazione  paypal  → payal,    google → gogle
 *     trasposizione  paypal  → paypla,   google → googel
 *
 * Il vincolo del raddoppio vale solo per l'inserzione. Togliere una lettera a
 * un marchio non produce parole di senso compiuto, quindi la cancellazione non
 * ha bisogno di guardie.
 */

/**
 * `candidate` è `word` scritta male?
 *
 * Non simmetrica di proposito: `word` è il marchio, `candidate` è quello che
 * sta scritto nel dominio. Il vincolo sul raddoppio guarda quale delle due è
 * più lunga, quindi scambiarle cambia il risultato.
 *
 * @param {string} word       Il marchio, scritto giusto.
 * @param {string} candidate  Quello che c'è nel dominio.
 * @returns {boolean}
 */
export function isTypoOf(word, candidate) {
  const a = String(word ?? '');
  const b = String(candidate ?? '');

  if (!a || !b || a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  // Stessa lunghezza ⇒ può essere solo una trasposizione. Una sola posizione
  // diversa sarebbe una sostituzione, che è deliberatamente esclusa.
  if (a.length === b.length) {
    const diff = [];
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        diff.push(i);
        if (diff.length > 2) return false;
      }
    }
    if (diff.length !== 2) return false;
    const [i, j] = diff;
    return j === i + 1 && a[i] === b[j] && a[j] === b[i];
  }

  // Lunghezze diverse ⇒ una lettera in più o in meno. Si scorrono in parallelo
  // saltandone al massimo una.
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;

  let i = 0;
  let j = 0;
  let extra = -1;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else {
      if (extra >= 0) return false;
      extra = j;
      j += 1;
    }
  }
  if (extra < 0) extra = longer.length - 1;

  // La lettera in più sta nel marchio ⇒ è una cancellazione: nessuna guardia.
  if (longer === a) return true;

  // La lettera in più sta nel dominio ⇒ deve raddoppiare una vicina, altrimenti
  // è l'inserzione che produce parole reali.
  return longer[extra] === longer[extra - 1] || longer[extra] === longer[extra + 1];
}
