// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

it("loads older records continuously and filters legacy records without losing an unsaved draft", async () => {
  const a = task("A", "任务 A"), b = { ...task("B", "历史任务 B"), market: null };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const query = new URL(String(url), "https://example.invalid").searchParams;
    if (query.get("market") === "legacy") return json({ workspace: { name: "shared" }, tasks: [b], nextCursor: null });
    if (query.has("cursor")) return json({ workspace: { name: "shared" }, tasks: [b], nextCursor: null });
    return json({ workspace: { name: "shared" }, tasks: [a], nextCursor: "older-page" });
  }));
  render(createElement(TeamWorkbench));
  await screen.findByLabelText("任务 A复核备注");
  fireEvent.change(screen.getByLabelText("任务 A复核备注"), { target: { value: "保留草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "加载更早记录" }));
  await screen.findByLabelText("历史任务 B复核备注");
  expect(screen.getByLabelText("任务 A复核备注")).toHaveValue("保留草稿");
  fireEvent.change(screen.getByLabelText("记录站点筛选"), { target: { value: "legacy" } });
  fireEvent.click(screen.getByRole("button", { name: "查询记录" }));
  await waitFor(() => expect(screen.queryByLabelText("任务 A复核备注")).not.toBeInTheDocument());
  expect(await screen.findByLabelText("历史任务 B复核备注")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("记录站点筛选"), { target: { value: "" } });
  fireEvent.submit(screen.getByRole("button", { name: "查询记录" }).closest("form")!);
  await screen.findByLabelText("任务 A复核备注");
  expect(screen.getByLabelText("任务 A复核备注")).toHaveValue("保留草稿");
});

it("shows versioned historical evidence and explicitly identifies automatic re-review events", async () => {
  const evidence = { version: "v2", period: "2026-09", currency: "USD", sales: 900, profit: -50, profitVerified: true };
  vi.stubGlobal("fetch", vi.fn(async () => json({ workspace: { name: "shared" }, tasks: [{ ...task("A", "任务 A"), history: [{ at: "2026-10-13T00:00:00Z", actor: "system", action: "refresh-evidence", previousStatus: "DONE", status: "REVIEW", note: "人工结论保留", evidence, triggered: true }] }], nextCursor: null })));
  render(createElement(TeamWorkbench));
  await screen.findByLabelText("任务 A复核备注");
  expect(screen.getByText(/系统自动复核/)).toBeInTheDocument();
  expect(screen.getByText(/v2.*2026-09/)).toBeInTheDocument();
  expect(screen.getByText(/已处理.*待复核/)).toBeInTheDocument();
  expect(screen.getByText(/仍触发提醒/)).toBeInTheDocument();
});

it("submitting unchanged filters refreshes records", async () => {
  let title = "任务 A";
  vi.stubGlobal("fetch", vi.fn(async () => json({ workspace: { name: "shared" }, tasks: [task("A", title)], nextCursor: null })));
  render(createElement(TeamWorkbench)); await screen.findByLabelText("任务 A复核备注");
  title = "刷新后的任务";
  fireEvent.submit(screen.getByRole("button", { name: "查询记录" }).closest("form")!);
  await screen.findByLabelText("刷新后的任务复核备注");
});

it("ignores a late older-page response after the operator changes the site filter", async () => {
  let resolveOld!: (value: Response) => void;
  const oldPage = new Promise<Response>(resolve => { resolveOld = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const query = new URL(String(url), "https://example.invalid").searchParams;
    if (query.has("cursor")) return oldPage;
    if (query.get("market") === "CA") return json({ workspace: { name: "shared" }, tasks: [{ ...task("C", "CA 任务"), market: "CA" }], nextCursor: null });
    return json({ workspace: { name: "shared" }, tasks: [task("A", "任务 A")], nextCursor: "old" });
  }));
  render(createElement(TeamWorkbench)); await screen.findByLabelText("任务 A复核备注");
  fireEvent.click(screen.getByRole("button", { name: "加载更早记录" }));
  fireEvent.change(screen.getByLabelText("记录站点筛选"), { target: { value: "CA" } });
  fireEvent.submit(screen.getByRole("button", { name: "查询记录" }).closest("form")!);
  await screen.findByLabelText("CA 任务复核备注");
  await act(async () => { resolveOld(json({ workspace: { name: "shared" }, tasks: [task("B", "旧页任务")], nextCursor: null })); await oldPage; });
  await waitFor(() => expect(screen.queryByLabelText("旧页任务复核备注")).not.toBeInTheDocument());
  expect(screen.getByLabelText("CA 任务复核备注")).toBeInTheDocument();
});
