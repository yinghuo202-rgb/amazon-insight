import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { TeamWorkbench } from "@/components/inventory/team-workbench";

export const dynamic = "force-dynamic";

export default function TeamPage() {
  return <><OpsPageHeader eyebrow="Shared workspace" title="团队协作" description="把 SKU 拉量、清货、补货和内容任务放进同一个可认领、可追踪的工作区。" /><TeamWorkbench /></>;
}
