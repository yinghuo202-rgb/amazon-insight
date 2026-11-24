export const CURRENCIES = [
  "USD", "CAD", "MXN", "GBP", "EUR", "JPY", "CNY", "AUD", "NZD", "SGD",
  "HKD", "KRW", "INR", "BRL", "PLN", "SEK", "NOK", "DKK", "CHF", "TRY",
  "ZAR", "AED", "SAR", "THB", "VND", "CLP", "COP", "CZK", "HUF", "ILS",
  "MYR", "PHP", "IDR", "TWD",
] as const;

export const SCALE = 1_000_000_000;

export function digits(currency: string) {
  return currency.toUpperCase() === "JPY" ? 0 : 2;
}

export function isCurrencyCode(currency: unknown): currency is string {
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency);
}

export const DEMO_USD: Readonly<Record<string, number>> = Object.freeze({
  USD: 1,
  CAD: 0.73,
  MXN: 0.052,
  GBP: 1.3,
  EUR: 1.1,
  JPY: 0.0067,
  CNY: 0.14,
  AUD: 0.66,
  NZD: 0.61,
  SGD: 0.74,
  HKD: 0.128,
  KRW: 0.00074,
  INR: 0.012,
  BRL: 0.18,
  CHF: 1.12,
});

export function scaledRate(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100_000) {
    throw new Error("Invalid exchange rate");
  }
  return Math.round(rate * SCALE);
}

function pow10BigInt(exp: number): bigint {
  let result = BigInt(1);
  const ten = BigInt(10);
  for (let i = 0; i < exp; i += 1) {
    result *= ten;
  }
  return result;
}

export function convertMinor(amount: number, source: string, target: string, rateScaled: number) {
  if (
    !Number.isSafeInteger(amount) ||
    !isCurrencyCode(source) ||
    !isCurrencyCode(target) ||
    !Number.isSafeInteger(rateScaled) ||
    rateScaled <= 0
  ) {
    throw new Error("Invalid currency conversion");
  }
  const sign = BigInt(amount < 0 ? -1 : 1);
  const numerator =
    BigInt(Math.abs(amount)) *
    BigInt(rateScaled) *
    pow10BigInt(digits(target));
  const denominator = BigInt(SCALE) * pow10BigInt(digits(source));
  const result = Number(sign * ((numerator + denominator / BigInt(2)) / denominator));
  if (!Number.isSafeInteger(result)) {
    throw new Error("Money exceeds safe integer range");
  }
  return result;
}

export function demoRate(source: string, target: string) {
  const sourceRate = DEMO_USD[source.toUpperCase()] || 1;
  const targetRate = DEMO_USD[target.toUpperCase()] || 1;
  return scaledRate(sourceRate / targetRate);
}

export function formatMoneyMinor(amountMinor: number, currency = "USD") {
  const code = isCurrencyCode(currency.toUpperCase()) ? currency.toUpperCase() : "USD";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(
    amountMinor / 10 ** digits(code),
  );
}

export function formatCompactSalesMinor(amountMinor: number, currency = "USD") {
  const code = isCurrencyCode(currency.toUpperCase()) ? currency.toUpperCase() : "USD";
  const value = amountMinor / 10 ** digits(code);
  if (Math.abs(value) >= 1_000_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return formatMoneyMinor(amountMinor, code);
}
