import { afterEach, describe, expect, it, vi } from "vitest";
import { getBoard, updateCard } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("board API client", () => {
  it("maps persisted identifiers and sends the demo credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 8,
        name: "Team board",
        columns: [
          {
            id: 12,
            name: "Todo",
            position: 0,
            cards: [
              {
                id: 34,
                title: "Write tests",
                details: "Persist them",
                position: 0,
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBoard()).resolves.toEqual([
      {
        id: "12",
        name: "Todo",
        cards: [
          {
            id: "34",
            title: "Write tests",
            details: "Persist them",
          },
        ],
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith("/api/board", expect.any(Object));
    const [, options] = fetchMock.mock.calls[0];
    expect(new Headers(options.headers).get("Authorization")).toBe(
      "Basic dXNlcjpwYXNzd29yZA==",
    );
  });

  it("sends card moves with the API's snake-case column identifier", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 34,
        title: "Write tests",
        details: "",
        position: 1,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await updateCard("34", { columnId: "12", position: 1 });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(options.body))).toEqual({
      column_id: 12,
      position: 1,
    });
  });

  it("surfaces API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    await expect(getBoard()).rejects.toThrow("500");
  });
});
