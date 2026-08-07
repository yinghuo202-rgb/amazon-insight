import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser, isBootstrapRequired } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/inventory");
  return <LoginForm bootstrapRequired={await isBootstrapRequired()} />;
}
