import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { inspirationRequestSchema } from "@/lib/contracts";
import { executeInspiration, getErrorResponse } from "@/lib/workbench";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  try {
    const payload = inspirationRequestSchema.parse(await request.json());
    const response = await executeInspiration(payload);
    return NextResponse.json(response);
  } catch (error) {
    const mapped = getErrorResponse(error);
    return NextResponse.json(
      { error: mapped.message, code: mapped.code },
      { status: mapped.status },
    );
  }
}
