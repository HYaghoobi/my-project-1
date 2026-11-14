import asyncio
import json
import os
import urllib.error
import urllib.request
from collections.abc import Sequence
from typing import Literal, TypedDict

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "openai/gpt-oss-120b"
REQUEST_TIMEOUT_SECONDS = 30


class ChatMessage(TypedDict):
    role: Literal["system", "user", "assistant"]
    content: str


class OpenRouterConfigurationError(RuntimeError):
    pass


class OpenRouterRequestError(RuntimeError):
    pass


def _request_completion(
    messages: list[ChatMessage],
    api_key: str,
    model: str,
) -> str:
    body = json.dumps(
        {"model": model, "messages": messages},
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request, timeout=REQUEST_TIMEOUT_SECONDS
        ) as response:
            response_body = response.read()
    except urllib.error.HTTPError as error:
        try:
            error_response = json.loads(error.read())
        except (UnicodeDecodeError, json.JSONDecodeError):
            error_response = None
        detail = None
        if isinstance(error_response, dict):
            error_info = error_response.get("error")
            if isinstance(error_info, dict):
                detail = error_info.get("message")
        if isinstance(detail, str):
            detail = detail.replace(api_key, "[redacted]").strip()[:300]
        message = f"OpenRouter returned HTTP {error.code}."
        if detail:
            message = f"{message} {detail}"
        raise OpenRouterRequestError(
            message
        ) from None
    except TimeoutError:
        raise OpenRouterRequestError("The OpenRouter request timed out.") from None
    except urllib.error.URLError as error:
        if isinstance(error.reason, TimeoutError):
            raise OpenRouterRequestError(
                "The OpenRouter request timed out."
            ) from None
        raise OpenRouterRequestError("Could not connect to OpenRouter.") from None

    try:
        result = json.loads(response_body)
        content = result["choices"][0]["message"]["content"]
    except (IndexError, KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        raise OpenRouterRequestError(
            "OpenRouter returned an invalid response."
        ) from None

    if not isinstance(content, str) or not content.strip():
        raise OpenRouterRequestError("OpenRouter returned an empty response.")
    return content.strip()


async def complete_chat(
    messages: Sequence[ChatMessage],
    *,
    api_key: str | None = None,
) -> str:
    configured_key = api_key if api_key is not None else os.getenv("OPENROUTER_API_KEY")
    if configured_key is None or not configured_key.strip():
        raise OpenRouterConfigurationError(
            "OPENROUTER_API_KEY is not configured."
        )
    configured_model = os.getenv("OPENROUTER_MODEL") or OPENROUTER_MODEL

    return await asyncio.to_thread(
        _request_completion,
        list(messages),
        configured_key.strip(),
        configured_model.strip(),
    )
