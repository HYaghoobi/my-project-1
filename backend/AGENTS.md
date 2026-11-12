# Backend

- `pyproject.toml` defines the FastAPI and Uvicorn dependencies, managed by `uv`.
- `app/main.py` creates the FastAPI application, exposes `GET /api/health`, and serves static files from `/`.
- `static/index.html` is the temporary Hello World page used to validate the Docker scaffold.
- The root `Dockerfile` installs the backend dependencies and runs Uvicorn on port `8000`.