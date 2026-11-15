import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.database import connect_database, initialize_database, last_inserted_id
from app.main import create_app
from app.openrouter import ChatMessage, OpenRouterRequestError

DEMO_AUTH = ("user", "password")


@pytest.fixture
def database_path(tmp_path: Path) -> Path:
    return tmp_path / "pm.sqlite3"


@pytest.fixture
def client(database_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(database_path)) as test_client:
        yield test_client


def test_chat_sends_board_and_full_history_and_requires_approval(
    monkeypatch: pytest.MonkeyPatch,
    database_path: Path,
) -> None:
    board_proposal = {
        "operations": [
            {
                "type": "create_card",
                "column_id": 1,
                "title": "New card",
                "details": "Created after approval",
            },
            {
                "type": "update_card",
                "card_id": 1,
                "title": "Updated card",
            },
            {
                "type": "move_card",
                "card_id": 2,
                "column_id": 2,
            },
        ]
    }
    results = [
        json.dumps(
            {
                "message": "I suggest three updates.",
                "proposal": board_proposal,
            }
        ),
        json.dumps({"message": "What would you like to adjust?", "proposal": None}),
    ]
    sent_messages: list[list[ChatMessage]] = []

    async def fake_complete_chat(messages: list[ChatMessage]) -> str:
        sent_messages.append(messages)
        return results.pop(0)

    monkeypatch.setattr("app.assistant.complete_chat", fake_complete_chat)

    with TestClient(create_app(database_path)) as test_client:
        original_board = test_client.get("/api/board", auth=DEMO_AUTH).json()
        response = test_client.post(
            "/api/chat",
            auth=DEMO_AUTH,
            json={"message": "Create, update, and move cards"},
        )

        assert response.status_code == 200
        data = response.json()
        proposal_id = data["proposal"]["id"]
        assert len(data["proposal"]["operations"]) == 3
        assert test_client.get("/api/board", auth=DEMO_AUTH).json() == original_board

        follow_up = test_client.post(
            "/api/chat",
            auth=DEMO_AUTH,
            json={"message": "Can you explain that?"},
        )
        assert follow_up.status_code == 200

        assert sent_messages[0][-1] == {
            "role": "user",
            "content": "Create, update, and move cards",
        }
        assert '"columns"' in sent_messages[0][0]["content"]
        assert '"New card"' not in sent_messages[0][0]["content"]
        assert sent_messages[1][-1]["content"] == "Can you explain that?"
        assert sent_messages[1][1]["role"] == "user"
        assert sent_messages[1][2]["role"] == "assistant"
        assert '"type": "move_card"' in sent_messages[1][2]["content"]

        history = test_client.get("/api/chat", auth=DEMO_AUTH).json()["messages"]
        assert len(history) == 4
        assert history[1]["proposal"]["status"] == "pending"

    with TestClient(create_app(database_path)) as restarted_client:
        persisted_history = restarted_client.get(
            "/api/chat", auth=DEMO_AUTH
        ).json()["messages"]
        assert len(persisted_history) == 4
        assert persisted_history[1]["proposal"]["id"] == proposal_id

        applied = restarted_client.post(
            f"/api/chat/proposals/{proposal_id}/apply",
            auth=DEMO_AUTH,
        )
        assert applied.status_code == 200
        updated_board = applied.json()
        assert updated_board["columns"][0]["cards"][0]["title"] == "Updated card"
        assert any(
            card["title"] == "New card"
            for card in updated_board["columns"][0]["cards"]
        )
        assert updated_board["columns"][1]["cards"][-1]["id"] == 2
        assert updated_board["columns"][1]["cards"][-1]["title"] == (
            original_board["columns"][0]["cards"][1]["title"]
        )
        assert restarted_client.get("/api/chat", auth=DEMO_AUTH).json()[
            "messages"
        ][1]["proposal"]["status"] == "applied"
        assert (
            restarted_client.post(
                f"/api/chat/proposals/{proposal_id}/apply",
                auth=DEMO_AUTH,
            ).status_code
            == 409
        )


@pytest.mark.parametrize(
    "completion",
    [
        "not json",
        json.dumps({"message": "No operations", "proposal": {"operations": []}}),
        json.dumps(
            {
                "message": "Invalid target",
                "proposal": {
                    "operations": [
                        {
                            "type": "move_card",
                            "card_id": 999999,
                            "column_id": 1,
                        }
                    ]
                },
            }
        ),
    ],
)
def test_invalid_completion_is_rejected_without_changing_board_or_history(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    completion: str,
) -> None:
    async def fake_complete_chat(messages: list[ChatMessage]) -> str:
        assert messages[-1]["role"] == "user"
        return completion

    monkeypatch.setattr("app.assistant.complete_chat", fake_complete_chat)
    original_board = client.get("/api/board", auth=DEMO_AUTH).json()

    response = client.post(
        "/api/chat",
        auth=DEMO_AUTH,
        json={"message": "Please update a card"},
    )

    assert response.status_code == 502
    assert client.get("/api/board", auth=DEMO_AUTH).json() == original_board
    assert client.get("/api/chat", auth=DEMO_AUTH).json()["messages"] == []


def test_chat_requires_authentication_and_non_blank_message(client: TestClient) -> None:
    assert client.get("/api/chat").status_code == 401
    assert client.post("/api/chat", json={"message": "Hello"}).status_code == 401
    assert (
        client.post(
            "/api/chat",
            auth=DEMO_AUTH,
            json={"message": "   "},
        ).status_code
        == 422
    )


def test_existing_database_is_upgraded_without_losing_board_data(
    database_path: Path,
) -> None:
    initialize_database(database_path)
    connection = connect_database(database_path)
    try:
        with connection:
            connection.execute("DROP TABLE chat_proposals")
            connection.execute("DROP TABLE chat_messages")
            connection.execute("PRAGMA user_version = 1")
    finally:
        connection.close()

    with TestClient(create_app(database_path)) as test_client:
        assert test_client.get("/api/board", auth=DEMO_AUTH).status_code == 200
        assert test_client.get("/api/chat", auth=DEMO_AUTH).json()["messages"] == []

    connection = connect_database(database_path)
    try:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 3
    finally:
        connection.close()


def test_version_two_chat_proposals_gain_persistent_rejection(
    database_path: Path,
) -> None:
    initialize_database(database_path)
    connection = connect_database(database_path)
    try:
        with connection:
            connection.execute("DROP TABLE chat_proposals")
            connection.execute(
                "CREATE TABLE chat_proposals ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "message_id INTEGER NOT NULL UNIQUE REFERENCES "
                "chat_messages(id) ON DELETE CASCADE, "
                "operations_json TEXT NOT NULL, "
                "status TEXT NOT NULL DEFAULT 'pending' "
                "CHECK (status IN ('pending', 'applied')))"
            )
            message_cursor = connection.execute(
                "INSERT INTO chat_messages (user_id, role, content) "
                "VALUES (1, 'assistant', 'A card proposal')"
            )
            connection.execute(
                "INSERT INTO chat_proposals "
                "(user_id, message_id, operations_json) VALUES (1, ?, ?)",
                (
                    last_inserted_id(message_cursor),
                    json.dumps(
                        [
                            {
                                "type": "create_card",
                                "column_id": 1,
                                "title": "Rejected card",
                                "details": "",
                            }
                        ]
                    ),
                ),
            )
            connection.execute("PRAGMA user_version = 2")
    finally:
        connection.close()

    with TestClient(create_app(database_path)) as test_client:
        rejected = test_client.post(
            "/api/chat/proposals/1/reject",
            auth=DEMO_AUTH,
        )
        assert rejected.status_code == 200
        assert rejected.json()["status"] == "rejected"


def test_openrouter_failure_is_returned_and_not_saved(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    async def fail_completion(messages: list[ChatMessage]) -> str:
        assert messages[-1]["role"] == "user"
        raise OpenRouterRequestError("Could not connect to OpenRouter.")

    monkeypatch.setattr("app.assistant.complete_chat", fail_completion)

    response = client.post(
        "/api/chat",
        auth=DEMO_AUTH,
        json={"message": "Please update a card"},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "Could not connect to OpenRouter."
    assert client.get("/api/chat", auth=DEMO_AUTH).json()["messages"] == []


def test_rejecting_chat_proposal_does_not_change_board(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    async def fake_completion(messages: list[ChatMessage]) -> str:
        assert messages[-1]["role"] == "user"
        return json.dumps(
            {
                "message": "I suggest creating a card.",
                "proposal": {
                    "operations": [
                        {
                            "type": "create_card",
                            "column_id": 1,
                            "title": "Rejected card",
                            "details": "",
                        }
                    ]
                },
            }
        )

    monkeypatch.setattr("app.assistant.complete_chat", fake_completion)
    original_board = client.get("/api/board", auth=DEMO_AUTH).json()
    response = client.post(
        "/api/chat",
        auth=DEMO_AUTH,
        json={"message": "Make a card"},
    )
    proposal_id = response.json()["proposal"]["id"]

    rejected = client.post(
        f"/api/chat/proposals/{proposal_id}/reject",
        auth=DEMO_AUTH,
    )

    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    assert client.get("/api/board", auth=DEMO_AUTH).json() == original_board
    assert (
        client.get("/api/chat", auth=DEMO_AUTH).json()["messages"][1]["proposal"][
            "status"
        ]
        == "rejected"
    )
    assert (
        client.post(
            f"/api/chat/proposals/{proposal_id}/apply",
            auth=DEMO_AUTH,
        ).status_code
        == 409
    )
