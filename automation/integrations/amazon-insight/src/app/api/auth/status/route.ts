import { isBootstrapRequired } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ bootstrapRequired: await isBootstrapRequired() });
}
