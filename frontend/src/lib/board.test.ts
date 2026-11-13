import { describe, expect, it } from "vitest";
import {
  addCard,
  countCards,
  deleteCard,
  editCard,
  initialBoard,
  moveColumn,
  moveCard,
  renameColumn,
  type Board,
  type Card,
} from "./board";

const card: Card = {
  id: "new-card",
  title: "عنوان تازه",
  details: "جزئیات تازه",
};

function createBoard(): Board {
  return [
    { id: "first", name: "اول", cards: [{ id: "a", title: "الف", details: "" }] },
    {
      id: "second",
      name: "دوم",
      cards: [{ id: "b", title: "ب", details: "" }],
    },
    { id: "third", name: "سوم", cards: [] },
    { id: "fourth", name: "چهارم", cards: [] },
    { id: "fifth", name: "پنجم", cards: [] },
  ];
}

describe("initial board", () => {
  it("starts with the six fixed columns and sample cards", () => {
    expect(initialBoard.map((column) => column.name)).toEqual([
      "برای انجام",
      "در حال انجام",
      "انجام‌شده",
      "در انتظار تأیید",
      "پروژه‌های در انتظار",
      "پروژه‌های اتمام‌شده",
    ]);
    expect(initialBoard.every((column) => column.cards.length > 0)).toBe(true);
    expect(countCards(initialBoard)).toBe(9);
  });
});

describe("column updates", () => {
  it("renames a column without changing the others", () => {
    const board = createBoard();
    const renamed = renameColumn(board, "second", "  در حال انجام  ");

    expect(renamed[1].name).toBe("در حال انجام");
    expect(renamed.map((column) => column.name)).toEqual([
      "اول",
      "در حال انجام",
      "سوم",
      "چهارم",
      "پنجم",
    ]);
  });

  it("ignores a blank name or an unknown column", () => {
    const board = createBoard();

    expect(renameColumn(board, "first", "  ")).toBe(board);
    expect(renameColumn(board, "missing", "نام تازه")).toEqual(board);
  });

  it("moves a column to another column's position without changing its contents", () => {
    const board = createBoard();
    const updated = moveColumn(board, "third", "first");

    expect(updated.map((column) => column.id)).toEqual([
      "third",
      "first",
      "second",
      "fourth",
      "fifth",
    ]);
    expect(updated[0]).toBe(board[2]);
    expect(updated[1].cards).toEqual(board[0].cards);
    expect(board.map((column) => column.id)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
      "fifth",
    ]);
  });

  it("moves a column forward to the target column's position", () => {
    const updated = moveColumn(createBoard(), "first", "third");

    expect(updated.map((column) => column.id)).toEqual([
      "second",
      "third",
      "first",
      "fourth",
      "fifth",
    ]);
  });

  it("preserves every card in its original column when reordering", () => {
    const board = createBoard();
    const updated = moveColumn(board, "first", "third");

    for (const column of board) {
      expect(
        updated.find((updatedColumn) => updatedColumn.id === column.id)?.cards,
      ).toBe(column.cards);
    }
    expect(
      updated.flatMap((column) => column.cards.map((card) => card.id)).sort(),
    ).toEqual(board.flatMap((column) => column.cards.map((card) => card.id)).sort());
  });

  it("leaves the board unchanged for the same or unknown column ids", () => {
    const board = createBoard();

    expect(moveColumn(board, "first", "first")).toBe(board);
    expect(moveColumn(board, "missing", "first")).toBe(board);
    expect(moveColumn(board, "first", "missing")).toBe(board);
  });
});

describe("card updates", () => {
  it("adds a card to the requested column", () => {
    const board = createBoard();
    const updated = addCard(board, "third", card);

    expect(updated[2].cards).toEqual([card]);
    expect(updated[0].cards).toHaveLength(1);
    expect(countCards(updated)).toBe(3);
  });

  it("does not add a card to an unknown column", () => {
    const board = createBoard();

    expect(addCard(board, "missing", card)).toEqual(board);
  });

  it("edits a card title and details without changing other cards", () => {
    const board = createBoard();
    const updated = editCard(board, "a", "  عنوان جدید  ", "  جزئیات جدید  ");

    expect(updated[0].cards[0]).toEqual({
      id: "a",
      title: "عنوان جدید",
      details: "جزئیات جدید",
    });
    expect(updated[1].cards).toEqual(board[1].cards);
    expect(board[0].cards[0].title).toBe("الف");
  });

  it("ignores an empty title or unknown card when editing", () => {
    const board = createBoard();

    expect(editCard(board, "a", " ", "جزئیات")).toBe(board);
    expect(editCard(board, "missing", "عنوان", "جزئیات")).toEqual(board);
  });

  it("deletes a card and leaves other cards intact", () => {
    const board = createBoard();
    const updated = deleteCard(board, "a");

    expect(updated[0].cards).toEqual([]);
    expect(updated[1].cards).toEqual(board[1].cards);
    expect(countCards(updated)).toBe(1);
  });

  it("does not change the board for an unknown card", () => {
    const board = createBoard();

    expect(deleteCard(board, "missing")).toBe(board);
  });

  it("moves a card between columns and inserts it before the target card", () => {
    const board = createBoard();
    const updated = moveCard(board, "a", "second", "b");

    expect(updated[0].cards).toEqual([]);
    expect(updated[1].cards.map((item) => item.id)).toEqual(["a", "b"]);
    expect(countCards(updated)).toBe(2);
  });

  it("moves a card to an empty column", () => {
    const updated = moveCard(createBoard(), "b", "third");

    expect(updated[1].cards).toEqual([]);
    expect(updated[2].cards.map((item) => item.id)).toEqual(["b"]);
  });

  it("reorders cards within their column", () => {
    const board = createBoard();
    board[0].cards.push({ id: "c", title: "ج", details: "" });

    const updated = moveCard(board, "c", "first", "a");

    expect(updated[0].cards.map((item) => item.id)).toEqual(["c", "a"]);
    expect(board[0].cards.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("ignores unknown card or destination ids", () => {
    const board = createBoard();

    expect(moveCard(board, "missing", "second")).toBe(board);
    expect(moveCard(board, "a", "missing")).toBe(board);
  });
});
