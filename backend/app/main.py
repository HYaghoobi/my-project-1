from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .api import router
from .database import DEFAULT_DATABASE_PATH, initialize_database


def create_app(
    database_path: Path = DEFAULT_DATABASE_PATH,
    static_directory: Path | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
        initialize_database(database_path)
        yield

    app = FastAPI(lifespan=lifespan)
    app.state.database_path = database_path
    app.include_router(router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    resolved_static_directory = static_directory or (
        Path(__file__).resolve().parent.parent / "static"
    )
    if resolved_static_directory.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=resolved_static_directory, html=True),
            name="static",
        )

    return app


app = create_app()
