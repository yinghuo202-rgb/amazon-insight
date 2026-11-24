import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/auth";
import {
  getJungleScoutCredentialStatus,
  saveLocalJungleScoutSettings,
} from "@/lib/junglescout/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  keyName: z.string().optional(),
  apiKey: z.string().optional(),
});

export async function GET() {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  const status = await getJungleScoutCredentialStatus();
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  const auth = await requireApiAuth({ role: "ADMIN" });
  if ("response" in auth) return auth.response;

  try {
    const payload = payloadSchema.parse(await request.json());
    await saveLocalJungleScoutSettings(payload);
    const status = await getJungleScoutCredentialStatus();
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "凭证参数格式不正确。" }, { status: 400 });
    }
    return NextResponse.json({ error: "保存 Jungle Scout 配置失败。" }, { status: 500 });
  }
}
