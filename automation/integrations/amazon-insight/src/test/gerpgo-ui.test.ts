// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://nas.example:3000"}
import { createElement } from "react";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GerpgoConnectionCheck } from "@/components/inventory/data-refresh-center";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows env status without a webpage credential form", () => {
  render(createElement(GerpgoConnectionCheck, { initialConfiguration: { configured: true, canSave: false, source: "env", updatedAt: null, message: "env 自动同步，无需手动保存" } }));
  expect(screen.queryByLabelText("积加 appKey")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保存积加凭证" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("env 自动同步");
});
it("does not send credentials from a plaintext public or NAS address", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(createElement(GerpgoConnectionCheck, { initialConfiguration: { configured: false, canSave: true, source: "missing", updatedAt: null, message: "未配置" } }));
  fireEvent.change(screen.getByLabelText("积加 appId"), { target: { value: "fixture-id" } });
  fireEvent.change(screen.getByLabelText("积加 appKey"), { target: { value: "fixture-key" } });
  fireEvent.click(screen.getByRole("button", { name: "保存积加凭证" }));
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("本次没有发送凭证");
  expect(screen.getByLabelText("积加 appKey")).toHaveValue("");
});
