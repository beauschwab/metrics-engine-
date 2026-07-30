/**
 * What a filed amount *is*.
 *
 * Every number in this engine is a float64, and 0.01 has no exact binary
 * representation, so summing two thousand balances lands within about a cent of
 * the true total rather than on it. The conformance suite has been living with
 * that by comparing currency to ±$0.005 — a tolerance that quietly admits the
 * two engines do not actually agree.
 *
 * That is backwards for a regulatory submission. The filed figure is not "the
 * float64 that came out of the arithmetic"; it is *the correctly-rounded amount
 * in the minor unit*, and once that is the definition the engines can be
 * required to match exactly rather than closely.
 *
 * So rounding is not presentation here. It is the last step of the computation,
 * it happens in the same place on every backend, and the tolerance it replaces
 * becomes an equality — which is a stronger claim, not a weaker one.
 *
 * What this does not fix: intermediate arithmetic is still binary floating
 * point. A sum of a billion rows could in principle drift far enough that the
 * rounded result differs by a cent between two engines that add in different
 * orders. Fixing *that* needs a decimal type through the whole expression
 * evaluator; this makes the boundary exact and bounds the exposure to the last
 * addition rather than to all of them.
 */

/** The minor unit. Two decimal places for every currency the registry files in. */
export const MINOR_UNIT_DP = 2;

/**
 * Round half away from zero, at a given number of decimals.
 *
 * Not `toFixed`, and not `Math.round(x * 100) / 100`. Both are subtly wrong at
 * the boundary: `Math.round(1.005 * 100)` is 100 rather than 101, because
 * `1.005 * 100` is `100.49999999999999`. Going through the decimal exponent of
 * the string form avoids re-introducing the error the rounding exists to remove.
 *
 * Half *away from zero* rather than half-up, so a credit and a debit of the same
 * magnitude round to the same magnitude — an asymmetry there shows up as a
 * one-cent break between a total and the sum of its parts.
 */
export function quantize(value: number, dp: number = MINOR_UNIT_DP): number {
  if (!Number.isFinite(value)) return value;

  // Shift the decimal point through the *exponent*, not by multiplying.
  //
  // `value * 100` is where the naive version goes wrong: 1.005 is stored as
  // 1.00499999999999989, and multiplying gives 100.49999999999999, which rounds
  // down to 1.00. Re-parsing `1.005e2` instead asks the number parser for the
  // nearest double to the decimal value 100.5 — which is exact — so the rounding
  // sees the digits the author actually wrote.
  const shift = (n: number, by: number): number => {
    const [mantissa, exponent] = n.toExponential().split('e');
    return Number(`${mantissa}e${Number(exponent) + by}`);
  };

  const scaled = shift(value, dp);
  // Half away from zero, so a credit and a debit of the same size round to the
  // same size. `Math.round` alone rounds -0.5 towards zero and +0.5 away.
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return shift(rounded, -dp);
}

/** Formats whose values are amounts of money, and therefore get quantized. */
export function isCurrency(format: string | undefined): boolean {
  return /^currency/.test((format || '').trim());
}

/**
 * Apply the filing definition to a measure's value.
 *
 * Ratios and percentages are deliberately left alone: they are not amounts, a
 * coverage ratio is not reconciled to the cent, and rounding one to two places
 * would throw away precision the next calculation needs.
 */
export function asFiled(value: number, format: string | undefined): number {
  return isCurrency(format) ? quantize(value) : value;
}
