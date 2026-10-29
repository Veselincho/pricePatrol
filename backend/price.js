function normalizeWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function normalizePriceText(text) {
  return normalizeWhitespace(text);
}

export function parsePriceText(text) {
  const input = normalizeWhitespace(text);
  const match = input.match(/\d[\d\s\u00a0.,]*\d|\d/);
  if (!match) return null;

  let num = match[0].replace(/[\s\u00a0]/g, "");
  const lastDot = num.lastIndexOf(".");
  const lastComma = num.lastIndexOf(",");
  const sepIdx = Math.max(lastDot, lastComma);

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = num[sepIdx];
    const thousandsSep = decimalSep === "." ? "," : ".";
    num = num.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (sepIdx !== -1) {
    const digitsAfter = num.length - sepIdx - 1;
    const sepCount = (num.match(/[.,]/g) || []).length;
    num = digitsAfter <= 2 && sepCount === 1 ? num.replace(",", ".") : num.replace(/[.,]/g, "");
  }

  const amount = Number.parseFloat(num);
  if (Number.isNaN(amount)) return null;

  const currencyMatch = input.match(/(?:лв\.?|BGN|€|EUR|\$|USD|£|GBP|RON|lei)/i);
  return {
    amount,
    currency: currencyMatch ? currencyMatch[0] : null,
    raw: input,
  };
}

export function buildPriceKey(text, currencyHint = null) {
  const parsed = parsePriceText(text);
  if (!parsed) return normalizePriceText(text).toLowerCase();

  const currency = currencyHint || parsed.currency || "";
  return `${parsed.amount.toFixed(2)}|${String(currency).toUpperCase()}`;
}

export function toIsoFileStamp(date = new Date()) {
  return date.toISOString().replace(/:/g, "-");
}

export function toAmountObject(text, currencyHint = null) {
  const parsed = parsePriceText(text);
  if (!parsed) return null;
  return {
    amount: parsed.amount,
    currency: currencyHint || parsed.currency || null,
  };
}
