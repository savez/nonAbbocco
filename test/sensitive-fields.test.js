/**
 * I nomi dei campi che chiedono dati particolarmente sensibili.
 *
 * La regola `sensitive-fields` cercava i suoi termini con `\b`, che in
 * espressione regolare NON separa il trattino basso né le cifre: `_` è un
 * carattere di parola e `cvv2` è una parola sola. Il risultato era che
 * `otp_code`, `pin_code`, `cvv2` — cioè le forme in cui quei campi si chiamano
 * davvero nei moduli veri — non scattavano, mentre `otp` da solo sì.
 *
 * Questi test fissano le due metà del problema: le forme che devono scattare,
 * e le parole innocue che non devono.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateUrlAndPage } from '../src/scoring.js';

/** I campi sensibili riconosciuti in una pagina con quei nomi. */
function labelsFor(...fieldNames) {
  const v = evaluateUrlAndPage('https://esempio-non-legittimo.xyz/accedi', {
    hasPassword: true,
    fieldNames
  });
  const rule = v.fired.find((f) => f.id === 'sensitive-fields');
  return rule ? rule.params.fields : [];
}

test('le forme con trattino basso vengono riconosciute', () => {
  assert.deepEqual(labelsFor('otp_code'), ['codice OTP']);
  assert.deepEqual(labelsFor('pin_code'), ['PIN']);
  assert.deepEqual(labelsFor('user_pin'), ['PIN']);
  assert.deepEqual(labelsFor('cvv_field'), ['CVV della carta']);
  assert.deepEqual(labelsFor('card_cvv'), ['CVV della carta']);
  assert.deepEqual(labelsFor('iban_input'), ['IBAN']);
});

test('le forme in camelCase vengono riconosciute', () => {
  assert.deepEqual(labelsFor('otpCode'), ['codice OTP']);
  assert.deepEqual(labelsFor('userPin'), ['PIN']);
  assert.deepEqual(labelsFor('ibanValue'), ['IBAN']);
});

test('le cifre attaccate alla parola non la nascondono', () => {
  // `cvv2` è il nome del campo su moltissimi moduli di pagamento.
  assert.deepEqual(labelsFor('cvv2'), ['CVV della carta']);
  assert.deepEqual(labelsFor('otp1'), ['codice OTP']);
});

test('le forme già riconosciute continuano a esserlo', () => {
  // La correzione non deve rompere i separatori che i pattern già gestivano.
  assert.deepEqual(labelsFor('otp'), ['codice OTP']);
  assert.deepEqual(labelsFor('codice-otp'), ['codice OTP']);
  assert.deepEqual(labelsFor('codice_fiscale'), ['codice fiscale']);
  assert.deepEqual(labelsFor('card_number'), ['numero di carta']);
  assert.deepEqual(labelsFor('cardNumber'), ['numero di carta']);
  assert.deepEqual(labelsFor('numero-carta'), ['numero di carta']);
  assert.deepEqual(labelsFor('recovery_phrase'), ['chiave o seed phrase']);
});

test('più campi sensibili insieme vengono elencati tutti', () => {
  const labels = labelsFor('otp_code', 'cvv2', 'iban_beneficiario');
  assert.deepEqual(labels.sort(), ['CVV della carta', 'IBAN', 'codice OTP']);
});

test('le parole innocue che contengono un termine non scattano', () => {
  // È la metà che conta: allargare il riconoscimento senza allargare i falsi
  // positivi. `shipping` contiene "pin", `japan` contiene "pan", e nessuno dei
  // due chiede dati sensibili.
  for (const innocuo of [
    'shipping', 'spinner', 'pinterest', 'japan', 'company', 'panel',
    'zipcode', 'seeds_newsletter_optin', 'description'
  ]) {
    assert.deepEqual(labelsFor(innocuo), [], `"${innocuo}" è stato scambiato per un campo sensibile`);
  }
});

test('nessun campo sensibile significa nessuna segnalazione', () => {
  assert.deepEqual(labelsFor('username', 'email'), []);
  assert.deepEqual(labelsFor(), []);
});
