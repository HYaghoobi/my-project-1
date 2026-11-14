import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.database import connect_database, hash_password, last_inserted_id
from app.main import create_app

DEMO_AUTH = ("user", "password")


@pytest.fixture
def database_path(tmp_path: Path) -> Path:
    return tmp_path / "pm.sqlite3"


@pytest.fixture
def client(database_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(database_path)) as test_client:
        yield test_client


def test_missing_database_is_created_and_seeded(
    client: TestClient, database_path: Path
) -> None:
    assert database_path.is_file()
    board = client.get("/api/board", auth=DEMO_AUTH)

    assert board.status_code == 200
    data = board.json()
    assert data["name"] == "تختهٔ تیم محصول"
    assert [column["name"] for column in data["columns"]] == [
        "برای انجام",
        "در حال انجام",
        "انجام‌شده",
        "در انتظار تأیید",
        "پروژه‌های در انتظار",
        "پروژه‌های اتمام‌شده",
    ]
    assert sum(len(column["cards"]) for column in data["columns"]) == 9


def test_database_survives_app_restart(database_path: Path) -> None:
    with TestClient(create_app(database_path)) as first_client:
        renamed = first_client.patch(
            "/api/board",
            auth=DEMO_AUTH,
            json={"name": "Persistent board"},
        )
        assert renamed.status_code == 200

    with TestClient(create_app(database_path)) as restarted_client:
        board = restarted_client.get("/api/board", auth=DEMO_AUTH)
        assert board.status_code == 200
        assert board.json()["name"] == "Persistent board"


def test_api_requires_valid_demo_credentials(client: TestClient) -> None:
    assert client.get("/api/board").status_code == 401
    assert client.get("/api/board", auth=("user", "wrong")).status_code == 401
    assert client.get("/api/health").json() == {"status": "ok"}


def test_board_columns_and_cards_can_be_updated(client: TestClient) -> None:
    board = client.get("/api/board", auth=DEMO_AUTH).json()
    first_column, second_column = board["columns"][:2]

    renamed_board = client.patch(
        "/api/board",
        auth=DEMO_AUTH,
        json={"name": "برد آزمایشی"},
    )
    assert renamed_board.status_code == 200
    assert renamed_board.json()["name"] == "برد آزمایشی"

    renamed_column = client.patch(
        f"/api/columns/{first_column['id']}",
        auth=DEMO_AUTH,
        json={"name": "ایده‌ها"},
    )
    assert renamed_column.status_code == 200
    assert renamed_column.json()["name"] == "ایده‌ها"

    reordered_column = client.patch(
        f"/api/columns/{first_column['id']}",
        auth=DEMO_AUTH,
        json={"position": 5},
    )
    assert reordered_column.status_code == 200
    assert reordered_column.json()["position"] == 5

    created = client.post(
        f"/api/columns/{first_column['id']}/cards",
        auth=DEMO_AUTH,
        json={"title": "کارت تازه", "details": "جزئیات تازه"},
    )
    assert created.status_code == 201
    card_id = created.json()["id"]
    assert created.json()["position"] == 2

    updated = client.patch(
        f"/api/cards/{card_id}",
        auth=DEMO_AUTH,
        json={
            "title": "کارت ویرایش‌شده",
            "details": "جزئیات ویرایش‌شده",
            "column_id": second_column["id"],
            "position": 0,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "کارت ویرایش‌شده"
    assert updated.json()["position"] == 0

    current_board = client.get("/api/board", auth=DEMO_AUTH).json()
    target_column = next(
        column
        for column in current_board["columns"]
        if column["id"] == second_column["id"]
    )
    assert target_column["cards"][0]["id"] == card_id
    assert current_board["columns"][-1]["id"] == first_column["id"]
    assert current_board["columns"][-1]["name"] == "ایده‌ها"

    deleted = client.delete(f"/api/cards/{card_id}", auth=DEMO_AUTH)
    assert deleted.status_code == 204
    assert client.delete("/api/cards/999999", auth=DEMO_AUTH).status_code == 404


def test_invalid_changes_are_rejected(client: TestClient) -> None:
    board = client.get("/api/board", auth=DEMO_AUTH).json()
    column = board["columns"][0]
    card_id = column["cards"][0]["id"]

    assert (
        client.patch("/api/board", auth=DEMO_AUTH, json={"name": "  "}).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/columns/{column['id']}",
            auth=DEMO_AUTH,
            json={"name": " "},
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/columns/{column['id']}",
            auth=DEMO_AUTH,
            json={"position": 99},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/columns/{column['id']}/cards",
            auth=DEMO_AUTH,
            json={"title": " "},
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/cards/{card_id}",
            auth=DEMO_AUTH,
            json={"title": " "},
        ).status_code
        == 422
    )


def test_users_are_isolated_and_each_user_has_one_board(
    client: TestClient, database_path: Path
) -> None:
    connection = connect_database(database_path)
    try:
        with connection:
            user_cursor = connection.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                ("other", hash_password("other-password")),
            )
            other_user_id = last_inserted_id(user_cursor)
            board_cursor = connection.execute(
                "INSERT INTO boards (user_id, name) VALUES (?, ?)",
                (other_user_id, "برد کاربر دیگر"),
            )
            other_board_id = last_inserted_id(board_cursor)
            column_cursor = connection.execute(
                'INSERT INTO "columns" (board_id, name, position) VALUES (?, ?, ?)',
                (other_board_id, "خصوصی", 0),
            )
            other_column_id = last_inserted_id(column_cursor)
            card_cursor = connection.execute(
                "INSERT INTO cards (column_id, title, details, position) "
                "VALUES (?, ?, ?, ?)",
                (other_column_id, "کارت خصوصی", "", 0),
            )
            other_card_id = last_inserted_id(card_cursor)
    finally:
        connection.close()

    connection = connect_database(database_path)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            with connection:
                connection.execute(
                    "INSERT INTO boards (user_id, name) VALUES (?, ?)",
                    (other_user_id, "برد دوم"),
                )
    finally:
        connection.close()

    other_board = client.get(
        "/api/board",
        auth=("other", "other-password"),
    ).json()
    assert other_board["id"] == other_board_id
    assert other_board["columns"][0]["cards"][0]["title"] == "کارت خصوصی"
    assert (
        client.patch(
            f"/api/cards/{other_card_id}",
            auth=DEMO_AUTH,
            json={"title": "تغییر غیرمجاز"},
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/api/columns/{other_column_id}",
            auth=DEMO_AUTH,
            json={"name": "تغییر غیرمجاز"},
        ).status_code
        == 404
    )
