import asyncio
import io
import json
import urllib.error
import urllib.request

import pytest

from app.openrouter import (
    OPENROUTER_MODEL,
    OPENROUTER_URL,
    OpenRouterConfigurationError,
    OpenRouterRequestError,
    complete_chat,
)


@pytest.mark.parametrize(
    ("model_override", "expected_model"),
    [
        (None, OPENROUTER_MODEL),
        ("liquid/lfm-3-1.7b:free", "liquid/lfm-3-1.7b:free"),
    ],
)
def test_sends_configured_model_and_returns_completion(
    monkeypatch: pytest.MonkeyPatch,
    model_override: str | None,
    expected_model: str,
) -> None:
    api_key = "unit-test-key"
    messages = [{"role": "user", "content": "What is 2 + 2?"}]
    if model_override is None:
        monkeypatch.delenv("OPENROUTER_MODEL", raising=False)
    else:
        monkeypatch.setenv("OPENROUTER_MODEL", model_override)
    response_body = json.dumps(
        {"choices": [{"message": {"content": "4"}}]}
    ).encode()

    class Response:
        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *_args: object) -> None:
            pass

        def read(self) -> bytes:
            return response_body

    def fake_urlopen(request: urllib.request.Request, timeout: int) -> Response:
        assert request.full_url == OPENROUTER_URL
        assert request.method == "POST"
        assert request.get_header("Authorization") == f"Bearer {api_key}"
        assert timeout == 30
        payload = json.loads(request.data)
        assert payload["model"] == expected_model
        assert payload["messages"] == messages
        return Response()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    result = asyncio.run(complete_chat(messages, api_key=api_key))

    assert result == "4"
    assert api_key not in result


def test_missing_api_key_is_reported_without_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    def unexpected_request(*_args: object, **_kwargs: object) -> None:
        pytest.fail("No network request should be made without an API key.")

    monkeypatch.setattr(urllib.request, "urlopen", unexpected_request)

    with pytest.raises(
        OpenRouterConfigurationError, match="OPENROUTER_API_KEY is not configured"
    ):
        asyncio.run(complete_chat([{"role": "user", "content": "2 + 2"}]))


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (
            urllib.error.HTTPError(
                OPENROUTER_URL,
                401,
                "Unauthorized",
                None,
                io.BytesIO(b"unit-test-key"),
            ),
            "HTTP 401",
        ),
        (
            urllib.error.HTTPError(
                OPENROUTER_URL,
                402,
                "Payment Required",
                None,
                io.BytesIO(
                    b'{"error":{"message":"Insufficient credits for this request."}}'
                ),
            ),
            "Insufficient credits",
        ),
        (
            urllib.error.HTTPError(
                OPENROUTER_URL,
                400,
                "Bad Request",
                None,
                io.BytesIO(
                    b'{"error":{"message":"Invalid key: unit-test-key"}}'
                ),
            ),
            "Invalid key",
        ),
        (
            urllib.error.URLError("connection failed"),
            "Could not connect",
        ),
    ],
)
def test_openrouter_errors_are_clear_and_do_not_expose_credentials(
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    message: str,
) -> None:
    api_key = "unit-test-key"

    def fail_request(
        request: urllib.request.Request,
        **kwargs: float,
    ) -> None:
        assert request.full_url == OPENROUTER_URL
        assert kwargs["timeout"] == 30
        raise failure

    monkeypatch.setattr(urllib.request, "urlopen", fail_request)

    with pytest.raises(OpenRouterRequestError, match=message) as error:
        asyncio.run(
            complete_chat(
                [{"role": "user", "content": "2 + 2"}],
                api_key=api_key,
            )
        )

    assert api_key not in str(error.value)
