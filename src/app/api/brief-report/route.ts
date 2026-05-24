import { NextResponse } from "next/server";

import { executeBriefReport } from "@/lib/brief-report";
import { briefReportRequestSchema } from "@/lib/contracts";
import { getErrorResponse } from "@/lib/workbench";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = briefReportRequestSchema.parse(await request.json());
    const response = await executeBriefReport(payload);
    return NextResponse.json(response);
  } catch (error) {
    const mapped = getErrorResponse(error);
    return NextResponse.json(
      { error: mapped.message, code: mapped.code },
      { status: mapped.status },
    );
  }
}
