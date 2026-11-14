# Backend

- `pyproject.toml` defines the FastAPI and Uvicorn dependencies, managed by `uv`.
- `app/main.py` creates the FastAPI application, initializes SQLite at startup, exposes `GET /api/health`, and serves static files from `/`.
- `app/database.py` creates the SQLite schema, seeds the demo account and board, and provides per-request database connections.
- `app/api.py` exposes authenticated board, column, and card endpoints; ownership is resolved from HTTP Basic credentials.
- `app/openrouter.py` sends chat completions to OpenRouter using `OPENROUTER_API_KEY`; `OPENROUTER_MODEL` can override the default model for testing.
- `app/schemas.py` defines API request and response models.
- `tests/` contains backend API and persistence tests; run them with `uv run --extra dev pytest`.
- `static/index.html` is the temporary Hello World page used to validate the Docker scaffold.
- The root `Dockerfile` installs the backend dependencies and runs Uvicorn on port `8000`.