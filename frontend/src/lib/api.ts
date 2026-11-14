import type { Board } from "./board";

interface ApiCard {
  id: number;
  title: string;
  details: string;
  position: number;
}

interface ApiColumn {
  id: number;
  name: string;
  position: number;
  cards: ApiCard[];
}

interface ApiBoard {
  id: number;
  name: string;
  columns: ApiColumn[];
}

interface ApiCardUpdate {
  title?: string;
  details?: string;
  columnId?: string;
  position?: number;
}

interface ApiColumnUpdate {
  name?: string;
  position?: number;
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`درخواست به سرور ناموفق بود (${status}).`);
    this.name = "ApiError";
  }
}

function databaseId(id: string): number {
  const parsedId = Number(id);
  if (!Number.isSafeInteger(parsedId) || parsedId < 1) {
    throw new Error("شناسهٔ دادهٔ برد نامعتبر است.");
  }
  return parsedId;
}

async function sendRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Basic ${window.btoa("user:password")}`);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    throw new ApiError(response.status);
  }
  return response;
}

async function requestJson<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await sendRequest(path, options);
  return response.json() as Promise<T>;
}

function toBoard(apiBoard: ApiBoard): Board {
  return apiBoard.columns.map((column) => ({
    id: String(column.id),
    name: column.name,
    cards: column.cards.map((card) => ({
      id: String(card.id),
      title: card.title,
      details: card.details,
    })),
  }));
}

export async function getBoard(): Promise<Board> {
  const board = await requestJson<ApiBoard>("/board");
  return toBoard(board);
}

export async function updateColumn(
  columnId: string,
  update: ApiColumnUpdate,
): Promise<void> {
  await requestJson<ApiColumn>(`/columns/${databaseId(columnId)}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export async function createCard(
  columnId: string,
  title: string,
  details: string,
): Promise<void> {
  await requestJson<ApiCard>(`/columns/${databaseId(columnId)}/cards`, {
    method: "POST",
    body: JSON.stringify({ title, details }),
  });
}

export async function updateCard(
  cardId: string,
  update: ApiCardUpdate,
): Promise<void> {
  const body = {
    title: update.title,
    details: update.details,
    column_id:
      update.columnId === undefined ? undefined : databaseId(update.columnId),
    position: update.position,
  };
  await requestJson<ApiCard>(`/cards/${databaseId(cardId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteCard(cardId: string): Promise<void> {
  await sendRequest(`/cards/${databaseId(cardId)}`, {
    method: "DELETE",
  });
}
