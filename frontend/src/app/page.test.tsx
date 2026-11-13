import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./page";

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/image", () => ({ default: () => null }));

const authSessionKey = "pm-authenticated-user";

function renderAuthenticatedHome() {
  window.sessionStorage.setItem(authSessionKey, "user");
  return render(<Home />);
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("Kanban page integration", () => {
  it("requires the demo credentials before showing the board", async () => {
    render(<Home />);

    expect(
      await screen.findByRole("heading", { name: "ورود به حساب کاربری" }),
    ).toBeVisible();
    expect(screen.queryByTestId("board-columns")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("نام کاربری"), {
      target: { value: "invalid" },
    });
    fireEvent.change(screen.getByLabelText("رمز عبور"), {
      target: { value: "credentials" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "نام کاربری یا رمز عبور نادرست است.",
    );
    expect(screen.queryByTestId("board-columns")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("نام کاربری"), {
      target: { value: "user" },
    });
    fireEvent.change(screen.getByLabelText("رمز عبور"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ورود" }));

    expect(
      await screen.findByRole("heading", { name: "تختهٔ تیم محصول" }),
    ).toBeVisible();
    expect(window.sessionStorage.getItem(authSessionKey)).toBe("user");
  });

  it("clears the session and returns to sign-in on logout", async () => {
    renderAuthenticatedHome();

    expect(
      await screen.findByRole("heading", { name: "تختهٔ تیم محصول" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "خروج" }));

    expect(
      await screen.findByRole("heading", { name: "ورود به حساب کاربری" }),
    ).toBeVisible();
    expect(screen.queryByTestId("board-columns")).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(authSessionKey)).toBeNull();
  });

  it("renders all six fixed columns", () => {
    renderAuthenticatedHome();

    expect(screen.getAllByTestId(/^kanban-column-/)).toHaveLength(6);
    for (const name of [
      "برای انجام",
      "در حال انجام",
      "انجام‌شده",
      "در انتظار تأیید",
      "پروژه‌های در انتظار",
      "پروژه‌های اتمام‌شده",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeVisible();
    }
  });

  it("applies column renames and card edits to the rendered board", () => {
    renderAuthenticatedHome();

    const todoColumn = screen.getByTestId("kanban-column-todo");
    fireEvent.click(
      within(todoColumn).getByRole("button", {
        name: "تغییر نام ستون برای انجام",
      }),
    );
    const columnName = screen.getByRole("textbox", { name: "نام ستون" });
    fireEvent.change(columnName, { target: { value: "آماده‌سازی" } });
    const columnNameForm = columnName.closest("form");
    if (!columnNameForm) throw new Error("Column name form was not rendered.");
    fireEvent.submit(columnNameForm);
    expect(screen.getByRole("heading", { name: "آماده‌سازی" })).toBeVisible();

    const card = screen.getByTestId("kanban-card-brand-story");
    fireEvent.click(
      within(card).getByRole("button", {
        name: "ویرایش کارت روایت تازه برای برند",
      }),
    );
    fireEvent.change(within(card).getByLabelText("عنوان کارت"), {
      target: { value: "روایت تازه‌شده" },
    });
    fireEvent.change(within(card).getByLabelText("جزئیات کارت"), {
      target: { value: "جزئیات تازه‌شده" },
    });
    fireEvent.click(
      within(card).getByRole("button", { name: "ذخیره تغییرات" }),
    );

    expect(
      within(card).getByRole("heading", { name: "روایت تازه‌شده" }),
    ).toBeVisible();
    expect(within(card).getByText("جزئیات تازه‌شده")).toBeVisible();
  });
});
