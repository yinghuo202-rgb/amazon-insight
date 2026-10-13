import { describe, expect, it } from "vitest";
import { redactGerpgoEvidence } from "@/lib/inventory/gerpgo-evidence";

function freezeJson(value: unknown): unknown {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freezeJson(item);
    Object.freeze(value);
  }
  return value;
}

describe("Gerpgo persisted evidence redaction", () => {
  it("copies nested pages without credentials while retaining literal business facts and paging metadata", () => {
    const page = {
      page: 2, pagesize: 97, total: 194, totalUnit: "markets", sha256: "provider-page-hash",
      rows: [{
        key: "business-key", businessId: 123, sku: "MA001_US", quantity: 12, amount: 19.95, currency: "USD", date: "2026-10-13",
        productName: "Token valve / key adapter", tokenCount: 4,
        credentials: { configured: true }, grants: { enabled: false, accessToken: "SYNTHETIC_SECRET_GRANT" },
        marketListVos: [{ marketId: 1, serverId: 2, market: "amazon-us", publicToken: "SYNTHETIC_SECRET_PUBLIC", authToken: "SYNTHETIC_SECRET_AUTH", refreshToken: "SYNTHETIC_SECRET_REFRESH", authTokenUrl: "SYNTHETIC_SECRET_URL" }],
        nested: [[{ sign: "SYNTHETIC_SECRET_SIGN", count: 3 }], null, false, "literal product description"],
      }],
    };
    const before = JSON.stringify(page);
    freezeJson(page);
    const safe = redactGerpgoEvidence(page);
    expect(safe).toEqual({
      page: 2, pagesize: 97, total: 194, totalUnit: "markets", sha256: "provider-page-hash",
      rows: [{
        key: "business-key", businessId: 123, sku: "MA001_US", quantity: 12, amount: 19.95, currency: "USD", date: "2026-10-13",
        productName: "Token valve / key adapter", tokenCount: 4,
        credentials: { configured: true }, grants: { enabled: false },
        marketListVos: [{ marketId: 1, serverId: 2, market: "amazon-us" }],
        nested: [[{ count: 3 }], null, false, "literal product description"],
      }],
    });
    expect(JSON.stringify(safe)).not.toContain("SYNTHETIC_SECRET");
    expect(JSON.stringify(page)).toBe(before);
    expect(safe).not.toBe(page);
    expect((safe as { rows: unknown[] }).rows).not.toBe(page.rows);
  });

  it("matches only normalized authentication names across casing and separators", () => {
    const authenticationFields = {
      "APP_KEY": "SYNTHETIC_SECRET_1", "app-secret": "SYNTHETIC_SECRET_2", "Client Secret": "SYNTHETIC_SECRET_3",
      "API.KEY": "SYNTHETIC_SECRET_4", "ACCESS_TOKEN": "SYNTHETIC_SECRET_5", "refresh-token": "SYNTHETIC_SECRET_6",
      "Auth Token": "SYNTHETIC_SECRET_7", "PUBLIC_TOKEN": "SYNTHETIC_SECRET_8", "auth_token_url": "SYNTHETIC_SECRET_9",
      AUTHORIZATION: "SYNTHETIC_SECRET_10", Cookie: "SYNTHETIC_SECRET_11", "Set-Cookie": "SYNTHETIC_SECRET_12",
      Password: "SYNTHETIC_SECRET_13", SECRET: "SYNTHETIC_SECRET_14", token: "SYNTHETIC_SECRET_15",
      SIGN: "SYNTHETIC_SECRET_16", Signature: "SYNTHETIC_SECRET_17", "X-API-Key": "SYNTHETIC_SECRET_18", "X_APP_KEY": "SYNTHETIC_SECRET_19",
      key: "SKU-key", tokenCount: 5, businessId: 77, signatureCount: 2, appKeyStatus: true, authorizationStatus: false,
      productName: "publicToken accessory; signature wrench", notes: "secret is a product word, not a field",
    };
    const safe = redactGerpgoEvidence(authenticationFields);
    expect(safe).toEqual({ key: "SKU-key", tokenCount: 5, businessId: 77, signatureCount: 2, appKeyStatus: true, authorizationStatus: false,
      productName: "publicToken accessory; signature wrench", notes: "secret is a product word, not a field" });
    expect(JSON.stringify(safe)).not.toContain("SYNTHETIC_SECRET");
  });

  it("redacts array roots and preserves JSON scalar values without value-based rewriting", () => {
    expect(redactGerpgoEvidence([{ token: "SYNTHETIC_SECRET", quantity: 0 }, [false, 0, null, "token-shaped product name"]])).toEqual([{ quantity: 0 }, [false, 0, null, "token-shaped product name"]]);
    for (const value of [null, false, 0, "Bearer literal product description"]) expect(redactGerpgoEvidence(value)).toBe(value);
  });
});
