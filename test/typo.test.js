/**
 * Il confronto per errore di battitura.
 *
 * Le tre forme ammesse — cancellazione, trasposizione, raddoppio di lettera —
 * non sono una scelta estetica: sono il risultato di una misura. Su 208 domini
 * reali (i 151 legittimi dichiarati dai marchi più un campione di siti
 * italiani veri) e 17 typosquatting costruiti a mano:
 *
 *   distanza 1 piena ................. 17/17 attacchi,  3 falsi positivi
 *   senza sostituzione ............... 17/17 attacchi,  1 falso positivo
 *   + inserzione solo come raddoppio . 17/17 attacchi,  0 falsi positivi
 *
 * La sostituzione non aggiungeva UN SOLO attacco e triplicava i falsi
 * positivi: è quella che trasforma `intesa` in `intera`. L'inserzione libera
 * ne lasciava uno: `intensa`, che è un aggettivo italiano comune.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isTypoOf } from '../src/typo.js';

test('il raddoppio di una lettera è un errore di battitura', () => {
  assert.ok(isTypoOf('paypal', 'paypall'));
  assert.ok(isTypoOf('google', 'gooogle'));
  assert.ok(isTypoOf('amazon', 'amazonn'));
  assert.ok(isTypoOf('facebook', 'faceboook'));
  assert.ok(isTypoOf('microsoft', 'microsofft'));
  assert.ok(isTypoOf('postepay', 'postepayy'));
});

test('la lettera mancante è un errore di battitura', () => {
  assert.ok(isTypoOf('paypal', 'payal'));
  assert.ok(isTypoOf('google', 'gogle'));
  assert.ok(isTypoOf('amazon', 'amazn'));
  assert.ok(isTypoOf('microsoft', 'microsft'));
  assert.ok(isTypoOf('netflix', 'netflx'));
});

test('due lettere invertite sono un errore di battitura', () => {
  assert.ok(isTypoOf('paypal', 'paypla'));
  assert.ok(isTypoOf('google', 'googel'));
  assert.ok(isTypoOf('amazon', 'amzaon'));
});

test('la sostituzione NON è un errore di battitura', () => {
  // È la regola che tiene fuori le parole reali. `intera` e `intesa`
  // differiscono per una sostituzione, e `intera` è una parola italiana.
  assert.ok(!isTypoOf('intesa', 'intera'));
  assert.ok(!isTypoOf('google', 'goggle'));
  assert.ok(!isTypoOf('paypal', 'paypak'));
});

test("l'inserzione che non raddoppia NON è un errore di battitura", () => {
  // `intensa` è un aggettivo italiano comune: inserisce una `n` che non
  // raddoppia nessuna lettera vicina.
  assert.ok(!isTypoOf('intesa', 'intensa'));
  assert.ok(!isTypoOf('poste', 'ponte'));
});

test('una parola identica non è un errore di battitura', () => {
  // Il match esatto è competenza di altre regole: qui produrrebbe un doppione.
  assert.ok(!isTypoOf('paypal', 'paypal'));
  assert.ok(!isTypoOf('amazon', 'amazon'));
});

test('la distanza 2 è troppo lontana', () => {
  assert.ok(!isTypoOf('paypal', 'paypalll'));
  assert.ok(!isTypoOf('amazon', 'amzn'));
  assert.ok(!isTypoOf('google', 'gooogel'));
  assert.ok(!isTypoOf('microsoft', 'micro'));
});

test('ingressi vuoti o assurdi non fanno esplodere nulla', () => {
  for (const [a, b] of [['', ''], ['a', ''], ['', 'a'], [null, 'paypal'], ['paypal', undefined]]) {
    assert.equal(typeof isTypoOf(a, b), 'boolean');
  }
});
