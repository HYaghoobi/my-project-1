from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator


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


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)

    @model_validator(mode="after")
    def message_is_not_blank(self) -> "ChatRequest":
        self.message = self.message.strip()
        if not self.message:
            raise ValueError("Message cannot be blank")
        return self


class CreateCardOperation(BaseModel):
    type: Literal["create_card"]
    column_id: int
    title: str
    details: str = ""


class UpdateCardOperation(BaseModel):
    type: Literal["update_card"]
    card_id: int
    title: str | None = None
    details: str | None = None

    @model_validator(mode="after")
    def has_card_changes(self) -> "UpdateCardOperation":
        if self.title is None and self.details is None:
            raise ValueError("An update operation must change title or details")
        return self


class MoveCardOperation(BaseModel):
    type: Literal["move_card"]
    card_id: int
    column_id: int


BoardOperation = Annotated[
    CreateCardOperation | UpdateCardOperation | MoveCardOperation,
    Field(discriminator="type"),
]


class BoardProposal(BaseModel):
    operations: list[BoardOperation] = Field(min_length=1)


class AssistantCompletion(BaseModel):
    message: str = Field(min_length=1)
    proposal: BoardProposal | None = None

    @model_validator(mode="after")
    def message_is_not_blank(self) -> "AssistantCompletion":
        self.message = self.message.strip()
        if not self.message:
            raise ValueError("Assistant message cannot be blank")
        return self


class ChatProposalResponse(BaseModel):
    id: int
    operations: list[BoardOperation]
    status: Literal["pending", "applied", "rejected"] = "pending"


class ChatMessageResponse(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    proposal: ChatProposalResponse | None = None


class ChatResponse(BaseModel):
    message: str
    proposal: ChatProposalResponse | None = None


class ChatHistoryResponse(BaseModel):
    messages: list[ChatMessageResponse]
