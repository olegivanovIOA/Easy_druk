#!/usr/bin/env python3
"""
capacity_common.py — Easy 3D Print Dashboard v1.0
Спільні хелпери для fetch_capacity.py та backfill_capacity_history.py.
"""

import re


def location_key(name):
    """'Локація 5' -> '5'"""
    m = re.search(r"\d+", name or "")
    return m.group(0) if m else (name or "?")


def compute_metrics(loc):
    """util%, defect%, total/free (машино-еквіваленти) з одного об'єкта locations[] відповіді API."""
    machines = loc.get("machines", {}) or {}
    batches = loc.get("batches", {}) or {}
    util = machines.get("utilizationPercent")
    total = machines.get("total")
    free = machines.get("free")
    parts = batches.get("parts") or 0
    defect_parts = batches.get("defectParts") or 0
    defect_pct = round(defect_parts / parts * 100, 2) if parts else None
    return {"util": util, "defectPct": defect_pct, "total": total, "free": free}


def upsert_day(history, date_str, locations_payload):
    """
    history: {"days": [{"date": "...", "locations": {key: {"name","util","defectPct"}}}]}
    Оновлює (або додає) запис за date_str на основі locations_payload (список
    об'єктів як у полі 'locations' відповіді API).
    """
    if not date_str:
        return history
    day_locs = {}
    for loc in locations_payload or []:
        key = location_key(loc.get("location"))
        day_locs[key] = {"name": loc.get("location"), **compute_metrics(loc)}

    days = history.setdefault("days", [])
    for d in days:
        if d.get("date") == date_str:
            d["locations"] = day_locs
            return history
    days.append({"date": date_str, "locations": day_locs})
    return history
