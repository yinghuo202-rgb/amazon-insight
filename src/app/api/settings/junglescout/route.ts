import { NextResponse } from "next/server";
import { z } from "zod";

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
  const status = await getJungleScoutCredentialStatus();
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  const payload = payloadSchema.parse(await request.json());
  await saveLocalJungleScoutSettings(payload);
  const status = await getJungleScoutCredentialStatus();
  return NextResponse.json(status);
}
