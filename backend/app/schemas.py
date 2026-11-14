from pydantic import BaseModel, Field


class CardCreate(BaseModel):
    title: str
    details: str = ""


class CardUpdate(BaseModel):
    title: str | None = None
    details: str | None = None
    column_id: int | None = None
    position: int | None = Field(default=None, ge=0)


class CardResponse(BaseModel):
    id: int
    title: str
    details: str
    position: int


class ColumnUpdate(BaseModel):
    name: str | None = None
    position: int | None = Field(default=None, ge=0)


class ColumnResponse(BaseModel):
    id: int
    name: str
    position: int
    cards: list[CardResponse]


class BoardUpdate(BaseModel):
    name: str


class BoardResponse(BaseModel):
    id: int
    name: str
    columns: list[ColumnResponse]
