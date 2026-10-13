const authenticationKeys = new Set([
  "appkey", "appsecret", "clientsecret", "apikey", "accesstoken", "refreshtoken", "authtoken", "publictoken", "authtokenurl",
  "authorization", "cookie", "setcookie", "password", "secret", "token", "sign", "signature", "xapikey", "xappkey",
]);

/** Copy JSON evidence without authentication fields; leave business values and live inputs intact. */
export function redactGerpgoEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactGerpgoEvidence);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !authenticationKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")))
      .map(([key, item]) => [key, redactGerpgoEvidence(item)]));
  }
  return value;
}
