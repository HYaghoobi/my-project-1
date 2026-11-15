import json
from collections.abc import Sequence

from pydantic import ValidationError

from .openrouter import ChatMessage, complete_chat
from .schemas import AssistantCompletion, BoardResponse


class InvalidAssistantResponseError(ValueError):
    pass


def build_chat_messages(
    board: BoardResponse,
    history: Sequence[ChatMessage],
    message: str,
) -> list[ChatMessage]:
    board_json = json.dumps(board.model_dump(mode="json"), ensure_ascii=False)
    system_message: ChatMessage = {
        "role": "system",
        "content": (
            "You are a project-board assistant. Reply in the user's language. "
            "Return only a JSON object with this shape: "
            '{"message":"text","proposal":null} or '
            '{"message":"text","proposal":{"operations":[...]}}. '
            "Each operation must be one of: "
            '{"type":"create_card","column_id":number,"title":"text","details":"text"}, '
            '{"type":"update_card","card_id":number,"title":"text","details":"text"} '
            "(include title and/or details for updates; details are optional for "
            "card creation), "
            '{"type":"move_card","card_id":number,"column_id":number}. '
            "A proposal may contain multiple operations. Use only IDs present in "
            "the board. Never claim that changes were applied; proposals require "
            "the user's explicit approval. Current board JSON: "
            f"{board_json}"
        ),
    }
    return [system_message, *history, {"role": "user", "content": message}]


async def generate_assistant_completion(
    board: BoardResponse,
    history: Sequence[ChatMessage],
    message: str,
) -> AssistantCompletion:
    messages = build_chat_messages(board, history, message)
    content = await complete_chat(messages)
    try:
        return AssistantCompletion.model_validate_json(content)
    except (ValidationError, ValueError):
        raise InvalidAssistantResponseError(
            "OpenRouter returned an invalid structured response."
        ) from None
