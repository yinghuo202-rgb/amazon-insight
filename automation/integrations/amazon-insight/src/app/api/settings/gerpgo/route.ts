import { z } from "zod";

import { requireApiAuth } from "@/lib/auth";
import {
  getGerpGoSettingsView,
  saveGerpGoSettings,
  syncGerpGoData,
  testGerpGoConnection,
} from "@/lib/gerpgo/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  action: z.enum(["save", "test", "sync"]).default("save"),
  appId: z.string().trim().max(128).optional(),
  appKey: z.string().trim().max(256).optional(),
  baseUrl: z.string().trim().max(256).optional(),
  baseCurrency: z.string().trim().length(3).optional(),
  selectedStoreIds: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
  enabled: z.boolean().optional(),
  demoMode: z.boolean().optional(),
});

export async function GET() {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  return Response.json(await getGerpGoSettingsView());
}

export async function POST(request: Request) {
  const auth = await requireApiAuth({ role: "ADMIN" });
  if ("response" in auth) return auth.response;

  try {
    const payload = payloadSchema.parse(await request.json());

    if (payload.action === "test") {
      if (payload.appId || payload.appKey || payload.baseUrl) {
        await saveGerpGoSettings({
          appId: payload.appId,
          appKey: payload.appKey,
          baseUrl: payload.baseUrl,
        });
      }
      const test = await testGerpGoConnection();
      return Response.json({ status: "ok", test, settings: await getGerpGoSettingsView() });
    }

    if (payload.action === "sync") {
      await syncGerpGoData();
      return Response.json({ status: "synced", settings: await getGerpGoSettingsView() });
    }

    const settings = await saveGerpGoSettings({
      appId: payload.appId,
      appKey: payload.appKey,
      baseUrl: payload.baseUrl,
      baseCurrency: payload.baseCurrency,
      selectedStoreIds: payload.selectedStoreIds,
      enabled: payload.enabled,
      demoMode: payload.demoMode,
    });
    return Response.json({ status: "saved", settings });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "GerpGo 配置参数格式不正确。" }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "GerpGo 操作失败。" },
      { status: 400 },
    );
  }
}
