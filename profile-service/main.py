from __future__ import annotations

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel, Field, Session, create_engine, select
from typing import Optional, List
from datetime import datetime
import os

def _db_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        # local dev
        return "sqlite:///./profile.db"
    # Render Postgres often gives postgres://...; SQLAlchemy wants postgresql+psycopg2://...
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url

engine = create_engine(_db_url(), echo=False, pool_pre_ping=True)

class Favorite(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    client_id: str = Field(index=True, default="default")
    code: str = Field(index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)

class HistoryEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    client_id: str = Field(index=True, default="default")
    event: str
    payload: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)

def init_db():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session

app = FastAPI(title="profile-service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/favorites", response_model=List[Favorite])
def list_favorites(
    client_id: str = Query("default"),
    session: Session = Depends(get_session),
):
    st = select(Favorite).where(Favorite.client_id == client_id).order_by(Favorite.created_at.desc())
    return session.exec(st).all()

@app.post("/favorites", response_model=Favorite)
def add_favorite(
    fav: Favorite,
    session: Session = Depends(get_session),
):
    fav.code = fav.code.upper().strip()
    if not fav.code:
        raise HTTPException(status_code=400, detail="code is required")
    # prevent duplicates
    st = select(Favorite).where(Favorite.client_id == fav.client_id, Favorite.code == fav.code)
    if session.exec(st).first():
        raise HTTPException(status_code=409, detail="already in favorites")
    session.add(fav)
    session.commit()
    session.refresh(fav)
    return fav

@app.delete("/favorites/{fav_id}")
def delete_favorite(fav_id: int, session: Session = Depends(get_session)):
    fav = session.get(Favorite, fav_id)
    if not fav:
        raise HTTPException(status_code=404, detail="not found")
    session.delete(fav)
    session.commit()
    return {"deleted": fav_id}

@app.get("/history", response_model=List[HistoryEvent])
def list_history(
    client_id: str = Query("default"),
    limit: int = Query(100, ge=1, le=500),
    session: Session = Depends(get_session),
):
    st = (
        select(HistoryEvent)
        .where(HistoryEvent.client_id == client_id)
        .order_by(HistoryEvent.created_at.desc())
        .limit(limit)
    )
    return session.exec(st).all()

@app.post("/history", response_model=HistoryEvent)
def add_history(ev: HistoryEvent, session: Session = Depends(get_session)):
    if not ev.event.strip():
        raise HTTPException(status_code=400, detail="event is required")
    session.add(ev)
    session.commit()
    session.refresh(ev)
    return ev

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
