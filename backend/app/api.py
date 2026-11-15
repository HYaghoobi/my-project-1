import json
import sqlite3
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from .assistant import (
    InvalidAssistantResponseError,
    generate_assistant_completion,
)
from .database import get_database, last_inserted_id, verify_password
from .openrouter import (
    ChatMessage,
    OpenRouterConfigurationError,
    OpenRouterRequestError,
)
from .schemas import (
    BoardProposal,
    BoardResponse,
    BoardUpdate,
    CardCreate,
    CardResponse,
    CardUpdate,
    ChatHistoryResponse,
    ChatMessageResponse,
    ChatProposalResponse,
    ChatRequest,
    ChatResponse,
    ColumnResponse,
    ColumnUpdate,
    CreateCardOperation,
    MoveCardOperation,
    UpdateCardOperation,
)

router = APIRouter(prefix="/api")
security = HTTPBasic(auto_error=False)
DatabaseConnection = Annotated[sqlite3.Connection, Depends(get_database)]


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid username or password",
        headers={"WWW-Authenticate": "Basic"},
    )


def get_current_user_id(
    credentials: Annotated[HTTPBasicCredentials | None, Depends(security)],
    connection: DatabaseConnection,
) -> int:
    if credentials is None:
        raise _unauthorized()

    user = connection.execute(
        "SELECT id, password_hash FROM users WHERE username = ?",
        (credentials.username,),
    ).fetchone()
    if user is None or not verify_password(
        credentials.password, str(user["password_hash"])
    ):
        raise _unauthorized()
    return int(user["id"])


AuthenticatedUserId = Annotated[int, Depends(get_current_user_id)]


def _board_for_user(
    connection: sqlite3.Connection, user_id: int
) -> sqlite3.Row:
    board = connection.execute(
        "SELECT id, name FROM boards WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if board is None:
        raise HTTPException(status_code=404, detail="Board not found")
    return board


def _owned_column(
    connection: sqlite3.Connection, column_id: int, user_id: int
) -> sqlite3.Row | None:
    return connection.execute(
        'SELECT c.id, c.board_id, c.name, c.position FROM "columns" AS c '
        "JOIN boards AS b ON b.id = c.board_id "
        "WHERE c.id = ? AND b.user_id = ?",
        (column_id, user_id),
    ).fetchone()


def _owned_card(
    connection: sqlite3.Connection, card_id: int, user_id: int
) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT cards.id, cards.column_id, cards.title, cards.details, "
        "cards.position FROM cards "
        'JOIN "columns" AS c ON c.id = cards.column_id '
        "JOIN boards AS b ON b.id = c.board_id "
        "WHERE cards.id = ? AND b.user_id = ?",
        (card_id, user_id),
    ).fetchone()


def _reorder_positions(
    connection: sqlite3.Connection,
    table: Literal['"columns"', "cards"],
    parent_column: Literal["board_id", "column_id"],
    parent_id: int,
    row_ids: list[int],
) -> None:
    if not row_ids:
        return

    maximum = connection.execute(
        f"SELECT COALESCE(MAX(position), -1) FROM {table} "
        f"WHERE {parent_column} = ?",
        (parent_id,),
    ).fetchone()[0]
    offset = int(maximum) + len(row_ids) + 1
    connection.executemany(
        f"UPDATE {table} SET position = ? WHERE id = ? AND {parent_column} = ?",
        [(offset + index, row_id, parent_id) for index, row_id in enumerate(row_ids)],
    )
    connection.executemany(
        f"UPDATE {table} SET position = ? WHERE id = ? AND {parent_column} = ?",
        [(index, row_id, parent_id) for index, row_id in enumerate(row_ids)],
    )


def _column_response(
    connection: sqlite3.Connection, column: sqlite3.Row
) -> ColumnResponse:
    cards = connection.execute(
        "SELECT id, title, details, position FROM cards "
        "WHERE column_id = ? ORDER BY position",
        (column["id"],),
    ).fetchall()
    return ColumnResponse(
        id=int(column["id"]),
        name=str(column["name"]),
        position=int(column["position"]),
        cards=[CardResponse(**dict(card)) for card in cards],
    )


def _load_board(
    connection: sqlite3.Connection, user_id: int
) -> BoardResponse:
    board = _board_for_user(connection, user_id)
    columns = connection.execute(
        'SELECT id, board_id, name, position FROM "columns" '
        "WHERE board_id = ? ORDER BY position",
        (board["id"],),
    ).fetchall()
    return BoardResponse(
        id=int(board["id"]),
        name=str(board["name"]),
        columns=[
            _column_response(connection, column)
            for column in columns
        ],
    )


def _validate_proposal(
    proposal: BoardProposal, board: BoardResponse
) -> None:
    columns = {column.id for column in board.columns}
    cards = {
        card.id
        for column in board.columns
        for card in column.cards
    }
    for operation in proposal.operations:
        if isinstance(operation, CreateCardOperation):
            if operation.column_id not in columns:
                raise InvalidAssistantResponseError(
                    "The proposal references a column outside the current board."
                )
            if not operation.title.strip():
                raise InvalidAssistantResponseError(
                    "The proposal contains a blank card title."
                )
        elif isinstance(operation, UpdateCardOperation):
            if operation.card_id not in cards:
                raise InvalidAssistantResponseError(
                    "The proposal references a card outside the current board."
                )
            if operation.title is not None and not operation.title.strip():
                raise InvalidAssistantResponseError(
                    "The proposal contains a blank card title."
                )
        elif isinstance(operation, MoveCardOperation):
            if operation.card_id not in cards or operation.column_id not in columns:
                raise InvalidAssistantResponseError(
                    "The proposal references an item outside the current board."
                )


def _chat_history(
    connection: sqlite3.Connection, user_id: int
) -> list[ChatMessage]:
    rows = connection.execute(
        "SELECT m.role, m.content, p.operations_json, p.status "
        "FROM chat_messages AS m "
        "LEFT JOIN chat_proposals AS p ON p.message_id = m.id "
        "WHERE m.user_id = ? ORDER BY m.id",
        (user_id,),
    ).fetchall()
    messages: list[ChatMessage] = []
    for row in rows:
        content = str(row["content"])
        if row["role"] == "assistant" and row["operations_json"] is not None:
            content = json.dumps(
                {
                    "message": content,
                    "proposal": {
                        "operations": json.loads(str(row["operations_json"])),
                        "status": row["status"],
                    },
                },
                ensure_ascii=False,
            )
        messages.append({"role": row["role"], "content": content})
    return messages


def _history_response(
    connection: sqlite3.Connection, user_id: int
) -> ChatHistoryResponse:
    rows = connection.execute(
        "SELECT m.id, m.role, m.content, p.id AS proposal_id, "
        "p.operations_json, p.status "
        "FROM chat_messages AS m "
        "LEFT JOIN chat_proposals AS p ON p.message_id = m.id "
        "WHERE m.user_id = ? ORDER BY m.id",
        (user_id,),
    ).fetchall()
    messages: list[ChatMessageResponse] = []
    for row in rows:
        proposal = None
        if row["proposal_id"] is not None:
            proposal_data = BoardProposal(
                operations=json.loads(str(row["operations_json"]))
            )
            proposal = ChatProposalResponse(
                id=int(row["proposal_id"]),
                operations=proposal_data.operations,
                status=row["status"],
            )
        messages.append(
            ChatMessageResponse(
                id=int(row["id"]),
                role=row["role"],
                content=str(row["content"]),
                proposal=proposal,
            )
        )
    return ChatHistoryResponse(messages=messages)


@router.get("/board", response_model=BoardResponse)
def read_board(
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> BoardResponse:
    return _load_board(connection, user_id)


@router.get("/chat", response_model=ChatHistoryResponse)
def read_chat_history(
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> ChatHistoryResponse:
    return _history_response(connection, user_id)


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> ChatResponse:
    board = _load_board(connection, user_id)
    history = _chat_history(connection, user_id)
    try:
        completion = await generate_assistant_completion(
            board, history, payload.message
        )
        if completion.proposal is not None:
            _validate_proposal(completion.proposal, board)
    except OpenRouterConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from None
    except (OpenRouterRequestError, InvalidAssistantResponseError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from None

    proposal_response = None
    with connection:
        connection.execute(
            "INSERT INTO chat_messages (user_id, role, content) "
            "VALUES (?, 'user', ?)",
            (user_id, payload.message),
        )
        assistant_cursor = connection.execute(
            "INSERT INTO chat_messages (user_id, role, content) "
            "VALUES (?, 'assistant', ?)",
            (user_id, completion.message),
        )
        if completion.proposal is not None:
            proposal_cursor = connection.execute(
                "INSERT INTO chat_proposals "
                "(user_id, message_id, operations_json) VALUES (?, ?, ?)",
                (
                    user_id,
                    last_inserted_id(assistant_cursor),
                    json.dumps(
                        [
                            operation.model_dump(mode="json")
                            for operation in completion.proposal.operations
                        ],
                        ensure_ascii=False,
                    ),
                ),
            )
            proposal_response = ChatProposalResponse(
                id=last_inserted_id(proposal_cursor),
                operations=completion.proposal.operations,
            )

    return ChatResponse(
        message=completion.message,
        proposal=proposal_response,
    )


@router.post(
    "/chat/proposals/{proposal_id}/apply",
    response_model=BoardResponse,
)
def apply_chat_proposal(
    proposal_id: int,
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> BoardResponse:
    row = connection.execute(
        "SELECT operations_json, status FROM chat_proposals "
        "WHERE id = ? AND user_id = ?",
        (proposal_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if row["status"] != "pending":
        raise HTTPException(status_code=409, detail="Proposal is no longer pending")

    proposal = BoardProposal(
        operations=json.loads(str(row["operations_json"]))
    )
    board = _load_board(connection, user_id)
    try:
        _validate_proposal(proposal, board)
    except InvalidAssistantResponseError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None

    with connection:
        claimed = connection.execute(
            "UPDATE chat_proposals SET status = 'applied' "
            "WHERE id = ? AND user_id = ? AND status = 'pending'",
            (proposal_id, user_id),
        )
        if claimed.rowcount != 1:
            raise HTTPException(status_code=409, detail="Proposal was already applied")
        for operation in proposal.operations:
            if isinstance(operation, CreateCardOperation):
                position = int(
                    connection.execute(
                        "SELECT COALESCE(MAX(position), -1) + 1 "
                        "FROM cards WHERE column_id = ?",
                        (operation.column_id,),
                    ).fetchone()[0]
                )
                connection.execute(
                    "INSERT INTO cards (column_id, title, details, position) "
                    "VALUES (?, ?, ?, ?)",
                    (
                        operation.column_id,
                        operation.title.strip(),
                        operation.details.strip(),
                        position,
                    ),
                )
            elif isinstance(operation, UpdateCardOperation):
                card = _owned_card(connection, operation.card_id, user_id)
                if card is None:
                    raise HTTPException(status_code=404, detail="Card not found")
                title = (
                    operation.title.strip()
                    if operation.title is not None
                    else str(card["title"])
                )
                details = (
                    operation.details.strip()
                    if operation.details is not None
                    else str(card["details"])
                )
                connection.execute(
                    "UPDATE cards SET title = ?, details = ? WHERE id = ?",
                    (title, details, operation.card_id),
                )
            elif isinstance(operation, MoveCardOperation):
                card = _owned_card(connection, operation.card_id, user_id)
                target = _owned_column(
                    connection, operation.column_id, user_id
                )
                if card is None or target is None:
                    raise HTTPException(
                        status_code=404, detail="Card or column not found"
                    )
                source_column_id = int(card["column_id"])
                if source_column_id == operation.column_id:
                    continue
                source_ids = [
                    int(item["id"])
                    for item in connection.execute(
                        "SELECT id FROM cards WHERE column_id = ? ORDER BY position",
                        (source_column_id,),
                    ).fetchall()
                    if int(item["id"]) != operation.card_id
                ]
                target_ids = [
                    int(item["id"])
                    for item in connection.execute(
                        "SELECT id FROM cards WHERE column_id = ? ORDER BY position",
                        (operation.column_id,),
                    ).fetchall()
                ]
                target_ids.append(operation.card_id)
                maximum = connection.execute(
                    "SELECT COALESCE(MAX(position), -1) FROM cards "
                    "WHERE column_id = ?",
                    (operation.column_id,),
                ).fetchone()[0]
                connection.execute(
                    "UPDATE cards SET column_id = ?, position = ? WHERE id = ?",
                    (
                        operation.column_id,
                        int(maximum) + 1,
                        operation.card_id,
                    ),
                )
                _reorder_positions(
                    connection, "cards", "column_id", source_column_id, source_ids
                )
                _reorder_positions(
                    connection, "cards", "column_id", operation.column_id, target_ids
                )
    return _load_board(connection, user_id)


@router.post(
    "/chat/proposals/{proposal_id}/reject",
    response_model=ChatProposalResponse,
)
def reject_chat_proposal(
    proposal_id: int,
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> ChatProposalResponse:
    row = connection.execute(
        "SELECT operations_json, status FROM chat_proposals "
        "WHERE id = ? AND user_id = ?",
        (proposal_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if row["status"] != "pending":
        raise HTTPException(status_code=409, detail="Proposal is no longer pending")

    proposal = BoardProposal(
        operations=json.loads(str(row["operations_json"]))
    )
    with connection:
        claimed = connection.execute(
            "UPDATE chat_proposals SET status = 'rejected' "
            "WHERE id = ? AND user_id = ? AND status = 'pending'",
            (proposal_id, user_id),
        )
        if claimed.rowcount != 1:
            raise HTTPException(
                status_code=409, detail="Proposal is no longer pending"
            )

    return ChatProposalResponse(
        id=proposal_id,
        operations=proposal.operations,
        status="rejected",
    )


@router.patch("/board", response_model=BoardResponse)
def rename_board(
    payload: BoardUpdate,
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> BoardResponse:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Board name cannot be blank")

    with connection:
        board = _board_for_user(connection, user_id)
        connection.execute(
            "UPDATE boards SET name = ? WHERE id = ?",
            (name, board["id"]),
        )
    return _load_board(connection, user_id)


@router.patch("/columns/{column_id}", response_model=ColumnResponse)
def update_column(
    column_id: int,
    payload: ColumnUpdate,
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> ColumnResponse:
    fields = payload.model_fields_set
    if not fields:
        raise HTTPException(status_code=422, detail="No column changes provided")
    if "name" in fields and payload.name is None:
        raise HTTPException(status_code=422, detail="Column name cannot be null")
    if "position" in fields and payload.position is None:
        raise HTTPException(status_code=422, detail="Column position cannot be null")

    column = _owned_column(connection, column_id, user_id)
    if column is None:
        raise HTTPException(status_code=404, detail="Column not found")

    name = payload.name.strip() if payload.name is not None else None
    if "name" in fields and not name:
        raise HTTPException(status_code=422, detail="Column name cannot be blank")

    board_id = int(column["board_id"])
    if payload.position is not None:
        columns = connection.execute(
            'SELECT id FROM "columns" WHERE board_id = ? ORDER BY position',
            (board_id,),
        ).fetchall()
        ordered_ids = [int(item["id"]) for item in columns]
        if payload.position >= len(ordered_ids):
            raise HTTPException(status_code=422, detail="Column position is out of range")
        ordered_ids.remove(column_id)
        ordered_ids.insert(payload.position, column_id)

    with connection:
        if name is not None:
            connection.execute(
                'UPDATE "columns" SET name = ? WHERE id = ? AND board_id = ?',
                (name, column_id, board_id),
            )
        if payload.position is not None:
            _reorder_positions(
                connection, '"columns"', "board_id", board_id, ordered_ids
            )

    updated = _owned_column(connection, column_id, user_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Column not found")
    return _column_response(connection, updated)


@router.post(
    "/columns/{column_id}/cards",
    response_model=CardResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_card(
    column_id: int,
    payload: CardCreate,
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> CardResponse:
    column = _owned_column(connection, column_id, user_id)
    if column is None:
        raise HTTPException(status_code=404, detail="Column not found")

    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Card title cannot be blank")
    details = payload.details.strip()
    position = int(
        connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM cards WHERE column_id = ?",
            (column_id,),
        ).fetchone()[0]
    )
    with connection:
        cursor = connection.execute(
            "INSERT INTO cards (column_id, title, details, position) "
            "VALUES (?, ?, ?, ?)",
            (column_id, title, details, position),
        )
    return CardResponse(
        id=last_inserted_id(cursor),
        title=title,
        details=details,
        position=position,
    )


@router.patch("/cards/{card_id}", response_model=CardResponse)
def update_card(
    card_id: int,
    payload: CardUpdate,
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> CardResponse:
    fields = payload.model_fields_set
    if not fields:
        raise HTTPException(status_code=422, detail="No card changes provided")
    for field in ("title", "details", "column_id", "position"):
        if field in fields and getattr(payload, field) is None:
            raise HTTPException(status_code=422, detail=f"{field} cannot be null")

    card = _owned_card(connection, card_id, user_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")

    title = payload.title.strip() if payload.title is not None else str(card["title"])
    if not title:
        raise HTTPException(status_code=422, detail="Card title cannot be blank")
    details = (
        payload.details.strip()
        if payload.details is not None
        else str(card["details"])
    )
    source_column_id = int(card["column_id"])
    target_column_id = (
        payload.column_id if payload.column_id is not None else source_column_id
    )
    target_column = _owned_column(connection, target_column_id, user_id)
    if target_column is None:
        raise HTTPException(status_code=404, detail="Column not found")

    source_ids = [
        int(row["id"])
        for row in connection.execute(
            "SELECT id FROM cards WHERE column_id = ? ORDER BY position",
            (source_column_id,),
        ).fetchall()
    ]
    moved_between_columns = target_column_id != source_column_id
    if moved_between_columns:
        source_ids.remove(card_id)
        target_ids = [
            int(row["id"])
            for row in connection.execute(
                "SELECT id FROM cards WHERE column_id = ? ORDER BY position",
                (target_column_id,),
            ).fetchall()
        ]
        target_position = (
            payload.position if payload.position is not None else len(target_ids)
        )
        if target_position > len(target_ids):
            raise HTTPException(status_code=422, detail="Card position is out of range")
        target_ids.insert(target_position, card_id)
    elif payload.position is not None:
        target_ids = source_ids.copy()
        if payload.position >= len(target_ids):
            raise HTTPException(status_code=422, detail="Card position is out of range")
        target_ids.remove(card_id)
        target_ids.insert(payload.position, card_id)
    else:
        target_ids = source_ids

    with connection:
        if moved_between_columns:
            maximum = connection.execute(
                "SELECT COALESCE(MAX(position), -1) FROM cards WHERE column_id = ?",
                (target_column_id,),
            ).fetchone()[0]
            connection.execute(
                "UPDATE cards SET column_id = ?, title = ?, details = ?, position = ? "
                "WHERE id = ?",
                (
                    target_column_id,
                    title,
                    details,
                    int(maximum) + 1,
                    card_id,
                ),
            )
            _reorder_positions(
                connection, "cards", "column_id", source_column_id, source_ids
            )
            _reorder_positions(
                connection, "cards", "column_id", target_column_id, target_ids
            )
        else:
            connection.execute(
                "UPDATE cards SET title = ?, details = ? WHERE id = ?",
                (title, details, card_id),
            )
            if payload.position is not None:
                _reorder_positions(
                    connection, "cards", "column_id", source_column_id, target_ids
                )

    updated = _owned_card(connection, card_id, user_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Card not found")
    return CardResponse(
        id=int(updated["id"]),
        title=str(updated["title"]),
        details=str(updated["details"]),
        position=int(updated["position"]),
    )


@router.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(
    card_id: int,
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> Response:
    card = _owned_card(connection, card_id, user_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")

    column_id = int(card["column_id"])
    card_ids = [
        int(row["id"])
        for row in connection.execute(
            "SELECT id FROM cards WHERE column_id = ? AND id != ? ORDER BY position",
            (column_id, card_id),
        ).fetchall()
    ]
    with connection:
        connection.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        _reorder_positions(connection, "cards", "column_id", column_id, card_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
