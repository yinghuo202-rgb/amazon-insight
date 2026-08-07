import { destroyCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  await destroyCurrentSession();
  return Response.json({ status: "signed_out" });
}
