import { NextResponse } from "next/server";

import { analyzeRequestSchema } from "@/lib/contracts";
import { executeAnalysis, getErrorResponse } from "@/lib/workbench";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = analyzeRequestSchema.parse(await request.json());
    const response = await executeAnalysis(payload);
    return NextResponse.json(response);
  } catch (error) {
    const mapped = getErrorResponse(error);
    return NextResponse.json(
      { error: mapped.message, code: mapped.code },
      { status: mapped.status },
    );
  }
}
