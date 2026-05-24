import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type CredentialSource = "env" | "local_settings" | "api_txt" | "missing";

export type JungleScoutLocalSettings = {
  keyName?: string;
  apiKey?: string;
};

export type JungleScoutCredentialStatus = {
  authorization: string | null;
  sourceStatus: "configured" | "partial" | "missing";
  diagnostics: string[];
  keyNameConfigured: boolean;
  apiKeyConfigured: boolean;
  keyNameSource: CredentialSource;
  apiKeySource: CredentialSource;
  keyNamePreview: string | null;
};

const LOCAL_SETTINGS_PATH = join(process.cwd(), ".local", "junglescout.json");
const API_TXT_PATH = join(process.cwd(), "api.txt");

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function maskValue(value: string | null) {
  if (!value) {
    return null;
  }

  if (value.length <= 6) {
    return `${value.slice(0, 2)}***`;
  }

  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function parseComposite(value: string | null) {
  if (!value) {
    return {
      keyName: null,
      apiKey: null,
      composite: null,
    };
  }

  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return {
      keyName: null,
      apiKey: null,
      composite: null,
    };
  }

  const keyName = trimOrNull(value.slice(0, separatorIndex));
  const apiKey = trimOrNull(value.slice(separatorIndex + 1));
  if (!keyName || !apiKey) {
    return {
      keyName: null,
      apiKey: null,
      composite: null,
    };
  }

  return {
    keyName,
    apiKey,
    composite: `${keyName}:${apiKey}`,
  };
}

type ParsedApiTxt = {
  keyName: string | null;
  apiKey: string | null;
  composite: string | null;
  format: "missing" | "composite" | "json" | "env" | "pair_lines" | "plain_key";
};

function parseApiTxtContent(rawValue: string | null): ParsedApiTxt {
  const value = trimOrNull(rawValue);
  if (!value) {
    return {
      keyName: null,
      apiKey: null,
      composite: null,
      format: "missing",
    };
  }

  const composite = parseComposite(value);
  if (composite.composite) {
    return {
      ...composite,
      format: "composite",
    };
  }

  try {
    const parsed = JSON.parse(value) as {
      keyName?: string;
      key_name?: string;
      apiKey?: string;
      api_key?: string;
    };
    const keyName = trimOrNull(parsed.keyName ?? parsed.key_name);
    const apiKey = trimOrNull(parsed.apiKey ?? parsed.api_key);
    return {
      keyName,
      apiKey,
      composite: keyName && apiKey ? `${keyName}:${apiKey}` : null,
      format: "json",
    };
  } catch {
    // ignore JSON parse errors and continue
  }

  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const envLike = Object.fromEntries(
    lines
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );

  const envKeyName = trimOrNull(envLike.KEY_NAME ?? envLike.JS_API_KEY_NAME);
  const envApiKey = trimOrNull(envLike.API_KEY ?? envLike.JS_API_KEY);
  if (envKeyName || envApiKey) {
    return {
      keyName: envKeyName,
      apiKey: envApiKey,
      composite: envKeyName && envApiKey ? `${envKeyName}:${envApiKey}` : null,
      format: "env",
    };
  }

  if (lines.length >= 2) {
    const pairKeyName = trimOrNull(lines[0]);
    const pairApiKey = trimOrNull(lines[1]);
    return {
      keyName: pairKeyName,
      apiKey: pairApiKey,
      composite: pairKeyName && pairApiKey ? `${pairKeyName}:${pairApiKey}` : null,
      format: "pair_lines",
    };
  }

  return {
    keyName: null,
    apiKey: value,
    composite: null,
    format: "plain_key",
  };
}

export async function readApiTxtConfig() {
  try {
    const raw = await readFile(API_TXT_PATH, "utf8");
    return parseApiTxtContent(raw);
  } catch {
    return parseApiTxtContent(null);
  }
}

export async function readLocalJungleScoutSettings(): Promise<JungleScoutLocalSettings> {
  try {
    const raw = await readFile(LOCAL_SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as JungleScoutLocalSettings;
    return {
      keyName: trimOrNull(parsed.keyName) ?? undefined,
      apiKey: trimOrNull(parsed.apiKey) ?? undefined,
    };
  } catch {
    return {};
  }
}

export async function saveLocalJungleScoutSettings(
  input: JungleScoutLocalSettings,
): Promise<JungleScoutLocalSettings> {
  const current = await readLocalJungleScoutSettings();
  const next: JungleScoutLocalSettings = {
    keyName:
      input.keyName === undefined ? current.keyName : trimOrNull(input.keyName) ?? undefined,
    apiKey: input.apiKey === undefined ? current.apiKey : trimOrNull(input.apiKey) ?? undefined,
  };

  await mkdir(join(process.cwd(), ".local"), { recursive: true });
  await writeFile(LOCAL_SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");

  return next;
}

export async function getJungleScoutCredentialStatus(): Promise<JungleScoutCredentialStatus> {
  const envKeyName = trimOrNull(process.env.JS_API_KEY_NAME);
  const envApiKeyRaw = trimOrNull(process.env.JS_API_KEY);
  const envComposite = parseComposite(envApiKeyRaw);
  const localSettings = await readLocalJungleScoutSettings();
  const apiTxt = await readApiTxtConfig();

  const keyName =
    envKeyName ?? envComposite.keyName ?? trimOrNull(localSettings.keyName) ?? apiTxt.keyName;
  const apiKey =
    (envKeyName ? envApiKeyRaw : null) ??
    envComposite.apiKey ??
    trimOrNull(localSettings.apiKey) ??
    apiTxt.apiKey;

  const keyNameSource: CredentialSource = envKeyName
    ? "env"
    : envComposite.keyName
      ? "env"
      : trimOrNull(localSettings.keyName)
        ? "local_settings"
        : apiTxt.keyName
          ? "api_txt"
          : "missing";
  const apiKeySource: CredentialSource =
    (envKeyName && envApiKeyRaw) || envComposite.apiKey
      ? "env"
      : trimOrNull(localSettings.apiKey)
        ? "local_settings"
        : apiTxt.apiKey
          ? "api_txt"
          : "missing";

  const authorization =
    envComposite.composite ??
    (envKeyName && envApiKeyRaw ? `${envKeyName}:${envApiKeyRaw}` : null) ??
    (keyName && apiKey ? `${keyName}:${apiKey}` : null);

  const diagnostics: string[] = [];

  if (authorization) {
    diagnostics.push("已检测到完整的 Jungle Scout 认证信息。");

    if (keyNameSource === "local_settings" && apiKeySource === "api_txt") {
      diagnostics.push("当前使用页面保存的 Key Name，并组合 api.txt 中的 API Key。");
    } else if (keyNameSource === "api_txt" && apiKeySource === "api_txt") {
      diagnostics.push("当前直接使用 api.txt 中的完整凭证。");
    } else if (keyNameSource === "env" || apiKeySource === "env") {
      diagnostics.push("当前优先使用环境变量中的凭证。");
    }
  } else if (keyName || apiKey) {
    diagnostics.push("Jungle Scout 凭证不完整，Authorization 需要使用 `KEY_NAME:API_KEY`。");

    if (!keyName) {
      diagnostics.push("当前缺少 Key Name。");
    }

    if (!apiKey) {
      diagnostics.push("当前缺少 API Key。");
    }

    if (apiTxt.format === "plain_key" && !keyName) {
      diagnostics.push("检测到 api.txt 里只有 API Key，补上 Key Name 后即可尝试 live。");
    }
  } else {
    diagnostics.push("当前未检测到 Jungle Scout 凭证，系统会自动回退到 mock。");
  }

  return {
    authorization,
    sourceStatus: authorization ? "configured" : keyName || apiKey ? "partial" : "missing",
    diagnostics,
    keyNameConfigured: Boolean(keyName),
    apiKeyConfigured: Boolean(apiKey),
    keyNameSource,
    apiKeySource,
    keyNamePreview: maskValue(keyName),
  };
}
