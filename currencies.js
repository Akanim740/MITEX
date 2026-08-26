const CURRENCIES = {
  NG: { code: "NGN", symbol: "\u20A6", name: "Nigerian Naira", rate: 1 },
  GH: { code: "GHS", symbol: "GH\u20B5", name: "Ghanaian Cedi", rate: 0.0063 },
  KE: { code: "KES", symbol: "KSh", name: "Kenyan Shilling", rate: 0.084 },
  ZA: { code: "ZAR", symbol: "R", name: "South African Rand", rate: 0.012 },
  TZ: { code: "TZS", symbol: "TSh", name: "Tanzanian Shilling", rate: 0.16 },
  UG: { code: "UGX", symbol: "USh", name: "Ugandan Shilling", rate: 0.23 },
  US: { code: "USD", symbol: "$", name: "US Dollar", rate: 0.00065 },
  GB: { code: "GBP", symbol: "\u00A3", name: "British Pound", rate: 0.00051 },
  EU: { code: "EUR", symbol: "\u20AC", name: "Euro", rate: 0.00060 },
  IN: { code: "INR", symbol: "\u20B9", name: "Indian Rupee", rate: 0.055 },
  BR: { code: "BRL", symbol: "R$", name: "Brazilian Real", rate: 0.0033 },
  FR: { code: "XOF", symbol: "CFA", name: "CFA Franc (West)", rate: 0.39 },
  CM: { code: "XAF", symbol: "FCFA", name: "CFA Franc (Central)", rate: 0.39 },
  SN: { code: "XOF", symbol: "CFA", name: "CFA Franc (West)", rate: 0.39 },
  CI: { code: "XOF", symbol: "CFA", name: "CFA Franc (West)", rate: 0.39 },
  EG: { code: "EGP", symbol: "E\u00A3", name: "Egyptian Pound", rate: 0.032 },
  SA: { code: "SAR", symbol: "SAR", name: "Saudi Riyal", rate: 0.0024 },
  AE: { code: "AED", symbol: "AED", name: "UAE Dirham", rate: 0.0024 },
  PK: { code: "PKR", symbol: "Rs", name: "Pakistani Rupee", rate: 0.18 },
  BD: { code: "BDT", symbol: "\u09F3", name: "Bangladeshi Taka", rate: 0.071 },
  PH: { code: "PHP", symbol: "\u20B1", name: "Philippine Peso", rate: 0.037 },
  ID: { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah", rate: 1.05 },
  MX: { code: "MXN", symbol: "MX$", name: "Mexican Peso", rate: 0.011 },
  JP: { code: "JPY", symbol: "\u00A5", name: "Japanese Yen", rate: 0.098 },
  CN: { code: "CNY", symbol: "\u00A5", name: "Chinese Yuan", rate: 0.0047 },
  CA: { code: "CAD", symbol: "CA$", name: "Canadian Dollar", rate: 0.00089 },
  AU: { code: "AUD", symbol: "A$", name: "Australian Dollar", rate: 0.0010 },
  DE: { code: "EUR", symbol: "\u20AC", name: "Euro", rate: 0.00060 },
  IT: { code: "EUR", symbol: "\u20AC", name: "Euro", rate: 0.00060 },
  ES: { code: "EUR", symbol: "\u20AC", name: "Euro", rate: 0.00060 },
  NL: { code: "EUR", symbol: "\u20AC", name: "Euro", rate: 0.00060 },
  PT: { code: "EUR", symbol: "\u20AC", name: "Euro", rate: 0.00060 },
};

const DEFAULT_COUNTRY = "NG";

function detectCountry() {
  try {
    const lang = navigator.language || navigator.userLanguage || "";
    const parts = lang.split("-");
    if (parts.length === 2) {
      const cc = parts[1].toUpperCase();
      if (CURRENCIES[cc]) return cc;
    }
    const langMap = {
      en: "US", fr: "FR", es: "ES", pt: "BR", ar: "EG",
      sw: "KE", ha: "NG", yo: "NG", ig: "NG", am: "ET",
      zu: "ZA", af: "ZA", bn: "BD", hi: "IN", ur: "PK",
      id: "ID", tl: "PH", ja: "JP", zh: "CN", ko: "KR",
      de: "DE", it: "IT", nl: "NL", tr: "TR", ru: "RU",
    };
    const base = (parts[0] || "").toLowerCase();
    if (langMap[base]) return langMap[base];
  } catch {}
  return DEFAULT_COUNTRY;
}

function getCurrency(countryCode) {
  return CURRENCIES[countryCode] || CURRENCIES[DEFAULT_COUNTRY];
}

function formatPrice(amountNGN, countryCode) {
  const cur = getCurrency(countryCode);
  if (cur.code === "NGN") {
    return "\u20A6" + Number(amountNGN).toLocaleString("en-NG");
  }
  const converted = amountNGN * cur.rate;
  const formatted = converted.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: converted < 10 ? 2 : 0,
  });
  return cur.symbol + formatted;
}

function formatPriceWithOriginal(amountNGN, countryCode) {
  const cur = getCurrency(countryCode);
  if (cur.code === "NGN") {
    return "\u20A6" + Number(amountNGN).toLocaleString("en-NG");
  }
  const converted = amountNGN * cur.rate;
  const formatted = converted.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: converted < 10 ? 2 : 0,
  });
  const naira = "\u20A6" + Number(amountNGN).toLocaleString("en-NG");
  return `${cur.symbol}${formatted} (\u2248 ${naira})`;
}
