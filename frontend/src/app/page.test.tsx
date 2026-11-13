import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "./page";

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/image", () => ({ default: "img" }));

afterEach(cleanup);

describe("Kanban page integration", () => {
  it("renders all six fixed columns", () => {
    render(<Home />);

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
    render(<Home />);

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
