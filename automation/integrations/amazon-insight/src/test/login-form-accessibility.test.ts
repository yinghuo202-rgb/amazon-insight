// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LoginForm } from "@/components/auth/login-form";
afterEach(cleanup);
it("labels only the password input and preserves its value when toggling visibility", () => {
  render(createElement(LoginForm, { bootstrapRequired: false }));
  const input = screen.getByLabelText("密码");
  expect(input).toHaveAttribute("type", "password");
  fireEvent.change(input, { target: { value: "qa-only-password" } });
  fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
  expect(input).toHaveAttribute("type", "text");
  expect(input).toHaveValue("qa-only-password");
  expect(screen.getByRole("button", { name: "隐藏密码" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
  expect(input).toHaveAttribute("type", "password");
});
