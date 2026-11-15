# Backend

- `pyproject.toml` defines the FastAPI and Uvicorn dependencies, managed by `uv`.
- `app/main.py` creates the FastAPI application, initializes SQLite at startup, exposes `GET /api/health`, and serves static files from `/`.
- `app/database.py` creates the SQLite schema, seeds the demo account and board, stores chat messages and proposals, and provides per-request database connections.
- `app/api.py` exposes authenticated board, column, card, and chat endpoints; ownership is resolved from HTTP Basic credentials. Chat proposals require an explicit apply or reject endpoint.
- `app/assistant.py` sends the full board and persisted conversation history to OpenRouter and validates its structured response.
- `app/openrouter.py` sends chat completions to OpenRouter using `OPENROUTER_API_KEY`; `OPENROUTER_MODEL` can override the default model for testing.
- `app/schemas.py` defines API request, response, and card-operation models.
- `tests/` contains backend API, chat, OpenRouter, and persistence tests; run them with `uv run --extra dev pytest`.
- `static/index.html` is the temporary Hello World page used to validate the Docker scaffold.
- The root `Dockerfile` installs the backend dependencies and runs Uvicorn on port `8000`.