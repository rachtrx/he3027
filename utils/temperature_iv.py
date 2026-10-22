"""Prepare 25°C hot-day exposures for exploratory MPS IV models."""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = DATA / "04_crime_iv_outputs"
OUT.mkdir(exist_ok=True)
SOURCE = ROOT / "project_data" / "temperature"
SOURCE.mkdir(parents=True, exist_ok=True)
CACHE = SOURCE / "open_meteo_hot_days_25c_monthly.csv.gz"
LOCATION = SOURCE / "lsoa_weather_locations.csv"
START, END = "2011-01-01", "2015-12-31"
CRIMES = {"allcrime": "mps_all", "violentcrime": "mps_violence",
          "propertycrime": "mps_property"}
EXPOSURES = ("annual", "lagyear", "prior12")
CONTROLS = [
    "detached_dum", "semi_d_dum", "terrace_dum", "freehold", "newbuild",
    "tube_distnear_km", "bus_distnear_km", "thamesriv_dist_km", "dist_to_cbd",
    "Nearest_Park_dist_km", "grossannualpay_k", "hoursworked", "unemployment",
]


def fetch_hot_days(cells: pd.DataFrame) -> pd.DataFrame:
    cells = cells[["weather_lat", "weather_lon"]].drop_duplicates().sort_values(
        ["weather_lat", "weather_lon"]).reset_index(drop=True)
    if CACHE.exists():
        saved = pd.read_csv(CACHE)
        saved = saved.rename(columns={"temp_source_lat": "source_lat",
                                      "temp_source_lon": "source_lon"})
        found = saved[["weather_lat", "weather_lon"]].drop_duplicates().sort_values(
            ["weather_lat", "weather_lon"]).reset_index(drop=True)
        if not cells.equals(found):
            raise ValueError("Cached temperature points differ from current LSOA locations")
        return saved
    parts = []
    for offset in range(0, len(cells), 10):
        batch = cells.iloc[offset:offset + 10]
        params = {"latitude": ",".join(batch.weather_lat.map(str)),
                  "longitude": ",".join(batch.weather_lon.map(str)),
                  "start_date": START, "end_date": END,
                  "daily": "temperature_2m_max", "timezone": "GMT"}
        url = "https://archive-api.open-meteo.com/v1/archive?" + urlencode(params)
        for attempt in range(4):
            try:
                with urlopen(url, timeout=90) as response:
                    payload = json.load(response)
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        if isinstance(payload, dict):
            payload = [payload]
        if len(payload) != len(batch):
            raise ValueError("Weather response count differs from request")
        for (_, cell), item in zip(batch.iterrows(), payload):
            daily = item["daily"]
            part = pd.DataFrame({
                "weather_lat": cell.weather_lat, "weather_lon": cell.weather_lon,
                "date": daily["time"], "max_c": daily["temperature_2m_max"],
                "source_lat": item["latitude"], "source_lon": item["longitude"]})
            if part.max_c.isna().any():
                raise ValueError("Missing daily temperature")
            parts.append(part)
        print(f"Fetched {min(offset + 10, len(cells))}/{len(cells)} weather points", flush=True)
    daily = pd.concat(parts, ignore_index=True)
    daily["month"] = pd.to_datetime(daily.date).dt.to_period("M").astype(str)
    daily["hot"] = daily.max_c.ge(25).astype(int)
    monthly = daily.groupby(["weather_lat", "weather_lon", "month"], as_index=False).agg(
        hot_days=("hot", "sum"), days=("hot", "size"),
        source_lat=("source_lat", "first"), source_lon=("source_lon", "first"))
    if not np.array_equal(monthly.days.to_numpy(),
                          pd.PeriodIndex(monthly.month, freq="M").days_in_month):
        raise ValueError("Incomplete temperature month")
    monthly.to_csv(CACHE, index=False, compression="gzip")
    return monthly


def prepare() -> pd.DataFrame:
    cols = ["transaction_id", "price", "age", "grossannualpay", "Nearest_Park_dist",
            "tube_distnear", "bus_distnear", "thamesriv_dist", "lsoacode", "msoa11",
            "oslaua", "yearquarter", "year", "month", "lat", "lon",
            "analysis_geography_ok", "mps_geography_ok", "mps_exposures_available"]
    cols += [c for c in CONTROLS if c in (
        "detached_dum", "semi_d_dum", "terrace_dum", "freehold", "dist_to_cbd",
        "hoursworked", "unemployment")]
    cols += [v + "_" + e for v in CRIMES.values() for e in EXPOSURES]
    data = pd.read_csv(DATA / "crime_housing_merged.csv.gz", usecols=cols, low_memory=False)
    loc = data.groupby("lsoacode", as_index=False)[["lat", "lon"]].mean()
    loc["weather_lat"] = np.round(loc.lat * 10) / 10
    loc["weather_lon"] = np.round(loc.lon * 10) / 10
    monthly = fetch_hot_days(loc)
    keys = ["weather_lat", "weather_lon"]
    source = monthly[keys + ["source_lat", "source_lon"]].drop_duplicates()
    loc = loc.merge(source, on=keys, validate="many_to_one")
    loc.to_csv(LOCATION, index=False)
    monthly["period"] = pd.PeriodIndex(monthly.month, freq="M")
    monthly["year"] = monthly.period.dt.year
    annual = monthly.groupby(keys + ["year"], as_index=False).agg(
        hot_days_annual=("hot_days", "sum"), months=("hot_days", "size"))
    annual.loc[annual.months.ne(12), "hot_days_annual"] = np.nan
    lag = annual[keys + ["year", "hot_days_annual"]].rename(
        columns={"hot_days_annual": "hot_days_lagyear"}).copy()
    lag["year"] += 1
    monthly = monthly.sort_values(keys + ["period"])
    monthly["hot_days_prior12"] = monthly.groupby(keys).hot_days.transform(
        lambda s: s.shift(1).rolling(12, min_periods=12).sum())
    data = data.merge(loc[["lsoacode"] + keys + ["source_lat", "source_lon"]],
                      on="lsoacode", validate="many_to_one")
    data = data.merge(annual[keys + ["year", "hot_days_annual"]],
                      on=keys + ["year"], how="left", validate="many_to_one")
    data = data.merge(lag, on=keys + ["year"], how="left", validate="many_to_one")
    data["sale_month"] = pd.to_datetime(
        dict(year=data.year, month=data.month, day=1)).dt.to_period("M").astype(str)
    data = data.merge(monthly[keys + ["month", "hot_days_prior12"]],
                      left_on=keys + ["sale_month"], right_on=keys + ["month"],
                      how="left", validate="many_to_one", suffixes=("", "_weather"))
    data["lnprice"] = np.log(data.price.where(data.price.gt(0)))
    data["newbuild"] = data.age.eq("Y").astype(float)
    data["grossannualpay_k"] = data.grossannualpay / 1000
    for col in ("Nearest_Park_dist", "tube_distnear", "bus_distnear", "thamesriv_dist"):
        data[col + "_km"] = data[col] / 1000
    for crime in CRIMES.values():
        for exposure in EXPOSURES:
            col = crime + "_" + exposure
            data["log1p_" + col] = np.log1p(data[col].where(data[col].ge(0)))
    return data
