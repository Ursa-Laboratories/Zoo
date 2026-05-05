"""FastAPI app factory."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from zoo.routers import deck, gantry, protocol, raw, settings

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Shutdown: disconnect the gantry so the serial port is released cleanly
    if gantry._gantry is not None:
        logger.info("Shutting down — disconnecting gantry")
        try:
            gantry._gantry.disconnect()
        except Exception as e:
            logger.warning("Error disconnecting gantry on shutdown: %s", e)
        gantry._gantry = None


def create_app() -> FastAPI:
    app = FastAPI(title="Zoo — CubOS Visualizer", lifespan=lifespan)
    app.include_router(deck.router)
    app.include_router(gantry.router)
    app.include_router(protocol.router)
    app.include_router(raw.router)
    app.include_router(settings.router)

    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

    return app
