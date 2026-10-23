from fastapi import FastAPI, Path
from fastapi.middleware.cors import CORSMiddleware
from typing import Annotated
from database import client
from name import name
from pending_operation import pending_operation
from playlist import playlist
from auth import router as auth_router
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(name.router)
app.include_router(pending_operation.router)
app.include_router(playlist.router)
app.include_router(auth_router)

@app.get("/ping")
async def root():
    return {"message": "pong"}

@app.get("/explode", tags=["Miku"])
async def miku():
    return "explosion"