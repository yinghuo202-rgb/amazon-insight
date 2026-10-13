// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TeamWorkbench } from "@/components/inventory/team-workbench";

const task = (id: string, title: string) => ({ id, sku: "SKU-" + id, market: "US", title, note: "原备注 " + id, status: "OPEN", updatedAt: "2026-10-13T00:00:00.000Z", context: null, history: [] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("saving one task preserves other drafts, reports success and detects remote note changes", async () => {
  const tasks = [task("A", "任务 A"), task("B", "任务 B")];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") { const body = JSON.parse(String(init.body)); tasks.find(item => item.id === body.id)!.note = body.note; tasks[1].note = "其他设备更新了 B"; return json({ status: "updated" }); }
    return json({ workspace: { name: "shared" }, tasks, limited: false });
  });
  vi.stubGlobal("fetch", fetcher);
  render(createElement(TeamWorkbench));
  await screen.findByLabelText("任务 A复核备注");
  fireEvent.change(screen.getByLabelText("任务 A复核备注"), { target: { value: "A 已复核" } });
  fireEvent.change(screen.getByLabelText("任务 B复核备注"), { target: { value: "B 未保存" } });
  fireEvent.click(within(screen.getByText("SKU-A · US · 任务 A").closest("article")!).getByRole("button", { name: "保存备注" }));
  await screen.findByText("记录已保存，其他未保存备注草稿已保留。");
  expect(screen.getByLabelText("任务 A复核备注")).toHaveValue("A 已复核");
  expect(screen.getByLabelText("任务 B复核备注")).toHaveValue("B 未保存");
  expect(within(screen.getByText("SKU-B · US · 任务 B").closest("article")!).getByText("未保存草稿")).toBeInTheDocument();
  expect(screen.getByText(/服务端最新备注：其他设备更新了 B/)).toBeInTheDocument();
});

it("refreshing review evidence keeps the same task's unsaved note", async () => {
  const evidence = { version: "v1", period: "2026-09", currency: "USD", sales: 10, profit: 1, profitVerified: true };
  const tasks = [{ ...task("A", "任务 A"), context: { issue: "利润待核查", baseline: evidence, latest: evidence } }];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { tasks[0].updatedAt = "2026-10-13T00:01:00.000Z"; return json({ task: { id: "A" } }); }
    return json({ workspace: { name: "shared" }, tasks, limited: false });
  }));
  render(createElement(TeamWorkbench, { review: { sku: "SKU-A", market: "US", period: "2026-09", version: "v1", issues: [] } }));
  await screen.findByLabelText("任务 A复核备注");
  fireEvent.change(screen.getByLabelText("任务 A复核备注"), { target: { value: "尚未保存的依据" } });
  fireEvent.click(screen.getByRole("button", { name: "按当前期间更新证据（不改结论）" }));
  await screen.findByText("依据已更新，未保存备注草稿已保留。");
  expect(screen.getByLabelText("任务 A复核备注")).toHaveValue("尚未保存的依据");
});

it("keeps drafts after a concurrent update and requires confirmation before retrying", async () => {
  const tasks = [task("A", "任务 A")];
  let conflict = true;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      if (conflict) { tasks[0].note = "其他设备的新备注"; tasks[0].updatedAt = "2026-10-13T00:01:00.000Z"; return json({ error: "changed" }, 409); }
      tasks[0].note = JSON.parse(String(init.body)).note; return json({ status: "updated" });
    }
    return json({ workspace: { name: "shared" }, tasks, limited: false });
  });
  vi.stubGlobal("fetch", fetcher);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(createElement(TeamWorkbench));
  await screen.findByLabelText("任务 A复核备注");
  fireEvent.change(screen.getByLabelText("任务 A复核备注"), { target: { value: "我的保留草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "保存备注" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("保存冲突"));
  expect(screen.getByLabelText("任务 A复核备注")).toHaveValue("我的保留草稿");
  expect(screen.getByText(/服务端最新备注：其他设备的新备注/)).toBeInTheDocument();
  const calls = fetcher.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "保存备注" }));
  expect(fetcher).toHaveBeenCalledTimes(calls);
  conflict = false; confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "保存备注" }));
  await screen.findByText("记录已保存，其他未保存备注草稿已保留。");
  const lastPatch = fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH").at(-1)![1];
  expect(JSON.parse(String(lastPatch?.body)).expectedUpdatedAt).toBe("2026-10-13T00:01:00.000Z");
});
