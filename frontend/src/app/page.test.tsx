import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCard,
  deleteCard as removeCard,
  editCard,
  initialBoard,
  moveCard,
  moveColumn,
  renameColumn,
  type Board,
} from "@/lib/board";
import {
  applyChatProposal,
  ApiError,
  createCard,
  deleteCard,
  getChatHistory,
  getBoard,
  rejectChatProposal,
  sendChatMessage,
  updateCard,
  updateColumn,
} from "@/lib/api";
import Home from "./page";

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) {
      super(`Request failed (${status}).`);
    }
  },
  applyChatProposal: vi.fn(),
  createCard: vi.fn(),
  deleteCard: vi.fn(),
  getChatHistory: vi.fn(),
  getBoard: vi.fn(),
  rejectChatProposal: vi.fn(),
  sendChatMessage: vi.fn(),
  updateCard: vi.fn(),
  updateColumn: vi.fn(),
}));

const authSessionKey = "pm-authenticated-user";
const localePreferenceKey = "pm-locale";
const themePreferenceKey = "pm-theme";
let apiBoard: Board;
let nextCardId: number;

function renderAuthenticatedHome() {
  window.sessionStorage.setItem(authSessionKey, "user");
  return render(<Home />);
}

function copyBoard(board: Board): Board {
  return board.map((column) => ({
    ...column,
    cards: column.cards.map((card) => ({ ...card })),
  }));
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.documentElement.lang = "fa";
  document.documentElement.dir = "rtl";
  delete document.documentElement.dataset.theme;
  apiBoard = copyBoard(initialBoard);
  nextCardId = 0;
  vi.mocked(getChatHistory).mockResolvedValue([]);
  vi.mocked(sendChatMessage).mockResolvedValue({
    message: "پاسخ دستیار",
    proposal: null,
  });
  vi.mocked(applyChatProposal).mockResolvedValue(copyBoard(apiBoard));
  vi.mocked(rejectChatProposal).mockImplementation(async (id) => ({
    id,
    operations: [],
    status: "rejected",
  }));
  vi.mocked(getBoard).mockImplementation(async () => copyBoard(apiBoard));
  vi.mocked(createCard).mockImplementation(async (columnId, title, details) => {
    apiBoard = addCard(apiBoard, columnId, {
      id: `new-card-${++nextCardId}`,
      title,
      details,
    });
  });
  vi.mocked(deleteCard).mockImplementation(async (cardId) => {
    apiBoard = removeCard(apiBoard, cardId);
  });
  vi.mocked(updateColumn).mockImplementation(async (columnId, update) => {
    if (update.name !== undefined) {
      apiBoard = renameColumn(apiBoard, columnId, update.name);
    }
    if (update.position !== undefined) {
      const target = apiBoard[update.position];
      if (target) apiBoard = moveColumn(apiBoard, columnId, target.id);
    }
  });
  vi.mocked(updateCard).mockImplementation(async (cardId, update) => {
    const source = apiBoard.find((column) =>
      column.cards.some((card) => card.id === cardId),
    );
    const destination = apiBoard.find(
      (column) => column.id === (update.columnId ?? source?.id),
    );
    if (source && destination && update.position !== undefined) {
      const targetCards = destination.cards.filter(
        (card) => card.id !== cardId,
      );
      apiBoard = moveCard(
        apiBoard,
        cardId,
        destination.id,
        targetCards[update.position]?.id,
      );
    }
    const card = apiBoard
      .flatMap((column) => column.cards)
      .find((item) => item.id === cardId);
    if (card && (update.title !== undefined || update.details !== undefined)) {
      apiBoard = editCard(
        apiBoard,
        cardId,
        update.title ?? card.title,
        update.details ?? card.details,
      );
    }
  });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.documentElement.lang = "fa";
  document.documentElement.dir = "rtl";
  delete document.documentElement.dataset.theme;
});

describe("Kanban page integration", () => {
  it("switches and persists the interface language, direction, and theme", async () => {
    const { unmount } = render(<Home />);
    expect(
      await screen.findByRole("heading", { name: "ورود به حساب کاربری" }),
    ).toBeVisible();

    fireEvent.click(screen.getByTestId("locale-toggle"));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(window.localStorage.getItem(localePreferenceKey)).toBe("en");

    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(screen.getByTestId("theme-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(themePreferenceKey)).toBe("dark");

    unmount();
    render(<Home />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("localizes HTTP errors in the selected interface language", async () => {
    window.localStorage.setItem(localePreferenceKey, "en");
    vi.mocked(getBoard).mockRejectedValue(new ApiError(503));
    renderAuthenticatedHome();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Request to the server failed (503).",
    );
  });

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

  it("renders all six fixed columns", async () => {
    renderAuthenticatedHome();

    expect(await screen.findAllByTestId(/^kanban-column-/)).toHaveLength(6);
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

  it("persists column renames and card edits through the board API", async () => {
    renderAuthenticatedHome();
    await screen.findByRole("heading", { name: "تختهٔ تیم محصول" });

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
    expect(
      await screen.findByRole("heading", { name: "آماده‌سازی" }),
    ).toBeVisible();
    expect(updateColumn).toHaveBeenCalledWith("todo", { name: "آماده‌سازی" });

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
      await within(card).findByRole("heading", { name: "روایت تازه‌شده" }),
    ).toBeVisible();
    expect(within(card).getByText("جزئیات تازه‌شده")).toBeVisible();
    expect(updateCard).toHaveBeenCalledWith("brand-story", {
      title: "روایت تازه‌شده",
      details: "جزئیات تازه‌شده",
    });
  });

  it("sends a chat message and renders the assistant reply", async () => {
    renderAuthenticatedHome();
    await screen.findByRole("heading", { name: "تختهٔ تیم محصول" });
    fireEvent.click(screen.getByTestId("assistant-launcher"));

    fireEvent.change(
      screen.getByRole("textbox", { name: "پیامتان را بنویسید..." }),
      { target: { value: "لطفاً یک کارت بساز" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "ارسال پیام" }));

    expect(await screen.findByText("پاسخ دستیار")).toBeVisible();
    expect(screen.getByText("لطفاً یک کارت بساز")).toBeVisible();
    expect(sendChatMessage).toHaveBeenCalledWith("لطفاً یک کارت بساز");
  });

  it("applies a proposal only after explicit approval and refreshes the board", async () => {
    const proposal = {
      id: 42,
      status: "pending" as const,
      operations: [
        {
          type: "create_card" as const,
          column_id: 1,
          title: "کارت پیشنهادی",
          details: "جزئیات پیشنهادی",
        },
      ],
    };
    vi.mocked(getChatHistory).mockResolvedValue([
      {
        id: 8,
        role: "assistant",
        content: "این پیشنهاد را بررسی کنید.",
        proposal,
      },
    ]);
    vi.mocked(applyChatProposal).mockImplementation(async () => {
      apiBoard = addCard(apiBoard, "todo", {
        id: "ai-card",
        title: "کارت پیشنهادی",
        details: "جزئیات پیشنهادی",
      });
      return copyBoard(apiBoard);
    });
    renderAuthenticatedHome();
    await screen.findByRole("heading", { name: "تختهٔ تیم محصول" });
    fireEvent.click(screen.getByTestId("assistant-launcher"));
    await screen.findByText("این پیشنهاد را بررسی کنید.");

    expect(screen.queryByTestId("kanban-card-ai-card")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "تأیید و اعمال" }));

    expect(await screen.findByTestId("kanban-card-ai-card")).toBeVisible();
    expect(screen.getByText("اعمال شد")).toBeVisible();
    expect(applyChatProposal).toHaveBeenCalledWith(42);
  });

  it("rejects a proposal without changing the board", async () => {
    const proposal = {
      id: 43,
      status: "pending" as const,
      operations: [
        {
          type: "create_card" as const,
          column_id: 1,
          title: "کارت ردشده",
          details: "",
        },
      ],
    };
    vi.mocked(getChatHistory).mockResolvedValue([
      {
        id: 9,
        role: "assistant",
        content: "پیشنهاد آزمایشی",
        proposal,
      },
    ]);
    const originalCardCount = apiBoard.flatMap((column) => column.cards).length;
    renderAuthenticatedHome();
    await screen.findByRole("heading", { name: "تختهٔ تیم محصول" });
    fireEvent.click(screen.getByTestId("assistant-launcher"));
    await screen.findByText("پیشنهاد آزمایشی");
    fireEvent.click(screen.getByRole("button", { name: "رد پیشنهاد" }));

    expect(await screen.findByText("رد شد")).toBeVisible();
    expect(rejectChatProposal).toHaveBeenCalledWith(43);
    expect(applyChatProposal).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "کارت ردشده" }),
    ).not.toBeInTheDocument();
    expect(apiBoard.flatMap((column) => column.cards)).toHaveLength(
      originalCardCount,
    );
  });
});
