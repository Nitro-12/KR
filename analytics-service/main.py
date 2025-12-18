from __future__ import annotations

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, Dict, Any, List
from datetime import date, timedelta, datetime
import os
import requests
import pandas as pd
import numpy as np

def _env_url(key: str, default: str) -> str:
    v = os.getenv(key, "").strip()
    return v.rstrip("/") if v else default.rstrip("/")

RATES_BASE_URL = _env_url("RATES_BASE_URL", "http://localhost:8000")
PROFILE_BASE_URL = _env_url("PROFILE_BASE_URL", "")  # optional

app = FastAPI(title="analytics-service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _log_event(client_id: str, event: str, payload: Optional[str] = None) -> None:
    if not PROFILE_BASE_URL:
        return
    try:
        requests.post(
            f"{PROFILE_BASE_URL}/history",
            json={"client_id": client_id, "event": event, "payload": payload},
            timeout=5,
        )
    except Exception:
        pass

def _get_history(code: str, date_from: str, date_to: str) -> Dict[str, Any]:
    resp = requests.get(
        f"{RATES_BASE_URL}/cbr/history",
        params={"code": code, "date_from": date_from, "date_to": date_to},
        timeout=20,
    )
    return resp.json()

@app.get("/health")
def health():
    return {"status": "ok", "rates_base_url": RATES_BASE_URL}

@app.get("/analytics/volatility")
def volatility(
    code: str = Query("USD"),
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD"),
    client_id: str = Query("default"),
):
    data = _get_history(code, date_from, date_to)
    if data.get("error"):
        return data

    pts = data.get("points") or []
    if len(pts) < 2:
        return {"error": "Недостаточно точек для расчёта"}

    df = pd.DataFrame(pts)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")
    s = df["rub_per_unit"].astype(float)

    out = {
        "code": data.get("code"),
        "name": data.get("name"),
        "from": data.get("from"),
        "to": data.get("to"),
        "count": int(len(df)),
        "mean": float(s.mean()),
        "std": float(s.std(ddof=1)),
        "min": float(s.min()),
        "max": float(s.max()),
        "pct_change_std": float(s.pct_change().dropna().std(ddof=1)),
    }
    _log_event(client_id, "volatility", f"{code} {date_from}..{date_to}")
    return out

@app.get("/analytics/forecast")
def forecast(
    code: str = Query("USD"),
    days: int = Query(7, ge=1, le=30),
    lookback: int = Query(45, ge=10, le=365),
    client_id: str = Query("default"),
):
    # Use last N days ending today
    end = date.today()
    start = end - timedelta(days=lookback)
    data = _get_history(code, start.isoformat(), end.isoformat())
    if data.get("error"):
        return data

    pts = data.get("points") or []
    if len(pts) < 10:
        return {"error": "Недостаточно исторических данных для прогноза"}

    df = pd.DataFrame(pts)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")

    # simple linear regression on time index
    y = df["rub_per_unit"].astype(float).to_numpy()
    x = np.arange(len(y), dtype=float)

    # fit y = a*x + b
    a, b = np.polyfit(x, y, deg=1)

    last_date = df["date"].iloc[-1].date()
    future: List[Dict[str, Any]] = []
    for i in range(1, days + 1):
        xi = len(y) - 1 + i
        yi = a * xi + b
        d = last_date + timedelta(days=i)
        future.append({"date": d.isoformat(), "rub_per_unit_pred": float(yi)})

    out = {
        "code": data.get("code"),
        "name": data.get("name"),
        "lookback_days": lookback,
        "train_points": int(len(df)),
        "model": {"type": "linear_regression", "a": float(a), "b": float(b)},
        "forecast_days": days,
        "forecast": future,
        "last_observation": {"date": last_date.isoformat(), "rub_per_unit": float(y[-1])},
    }
    _log_event(client_id, "forecast", f"{code} days={days} lookback={lookback}")
    return out

@app.get("/analytics/sma")
def sma(
    code: str = Query("USD"),
    window: int = Query(7, ge=2, le=60),
    lookback: int = Query(120, ge=10, le=365),
    client_id: str = Query("default"),
):
    end = date.today()
    start = end - timedelta(days=lookback)
    data = _get_history(code, start.isoformat(), end.isoformat())
    if data.get("error"):
        return data
    pts = data.get("points") or []
    if len(pts) < window:
        return {"error": "Недостаточно данных для SMA"}

    df = pd.DataFrame(pts)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")
    df["sma"] = df["rub_per_unit"].astype(float).rolling(window=window).mean()
    last = df.dropna().iloc[-1]
    out = {
        "code": data.get("code"),
        "name": data.get("name"),
        "window": window,
        "last": {"date": last["date"].date().isoformat(), "rub_per_unit": float(last["rub_per_unit"]), "sma": float(last["sma"])},
    }
    _log_event(client_id, "sma", f"{code} window={window}")
    return out

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8002"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
