/**
 * Formats a quantity (unit count) for display.
 * Trailing zeros after the decimal point are stripped: 100.0 → "100", 10.5 → "10.5".
 * Returns "0" for zero.
 */
export function formatQty(qty: number): string {
  // parseFloat strips trailing zeros; String converts back without scientific notation
  // for the ranges typical of portfolio quantities.
  return String(parseFloat(qty.toFixed(10)));
}

/**
 * Converts a USD amount to ILS using the provided exchange rate.
 *
 * @param usdAmount - Amount in USD
 * @param rate - USD/ILS exchange rate (ILS per 1 USD). Null means rate unavailable.
 * @returns Converted amount in ILS, or null if the rate is unavailable or zero.
 */
export function convertUsdToIls(usdAmount: number, rate: number | null): number | null {
  if (rate === null || rate === 0) return null;
  return usdAmount * rate;
}
