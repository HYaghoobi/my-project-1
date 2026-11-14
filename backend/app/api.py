import sqlite3
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from .database import get_database, last_inserted_id, verify_password
from .schemas import (
    BoardResponse,
    BoardUpdate,
    CardCreate,
    CardResponse,
    CardUpdate,
    ColumnResponse,
    ColumnUpdate,
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


@router.get("/board", response_model=BoardResponse)
def read_board(
    connection: DatabaseConnection,
    user_id: AuthenticatedUserId,
) -> BoardResponse:
    return _load_board(connection, user_id)


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
