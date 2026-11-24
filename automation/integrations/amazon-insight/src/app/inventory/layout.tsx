import { Suspense, type ReactNode } from "react";

import { OperationsShell } from "@/components/inventory/operations-shell";
import { getCurrentUser } from "@/lib/auth";
import { loadInventorySnapshotDate } from "@/lib/inventory/data";
import { redirect } from "next/navigation";

export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [usSnapshot, caSnapshot] = await Promise.all([
    loadInventorySnapshotDate("US").catch(() => null),
    loadInventorySnapshotDate("CA").catch(() => null),
  ]);
  return <Suspense fallback={null}><OperationsShell snapshots={{ US: usSnapshot, CA: caSnapshot }} currentUser={user}>{children}</OperationsShell></Suspense>;
}
