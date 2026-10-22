"""Recreate and verify the Open-Meteo temperature source for notebook 04.

Source: https://open-meteo.com/en/docs/historical-weather-api
Endpoint: https://archive-api.open-meteo.com/v1/archive
Variable: daily maximum 2-metre air temperature (temperature_2m_max, °C).
Period: 2011-01-01 through 2015-12-31, timezone GMT.
Model: Open-Meteo's default Best Match; no model was specified in the request.

LSOA mean sale coordinates were rounded to 0.1 degrees before the request.
The 32 requested points map to 21 distinct returned weather locations.
The IV exposure is a count of days with maximum temperature >=25 °C.
Raw daily data and the monthly analysis input are local to project_data/temperature
and deliberately ignored by Git; this script documents how to reproduce them.
"""

import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
HERE = ROOT / "project_data" / "temperature"
MONTHLY = HERE / "open_meteo_hot_days_25c_monthly.csv.gz"
DAILY = HERE / "open_meteo_daily_max_2011_2015.csv.gz"
ENDPOINT = "https://archive-api.open-meteo.com/v1/archive"


def main() -> None:
    saved = pd.read_csv(MONTHLY)
    cells = saved[["weather_lat", "weather_lon"]].drop_duplicates().sort_values(["weather_lat", "weather_lon"])
    pieces = []
    for start in range(0, len(cells), 10):
        batch = cells.iloc[start:start + 10]
        params = {
            "latitude": ",".join(batch.weather_lat.map(str)),
            "longitude": ",".join(batch.weather_lon.map(str)),
            "start_date": "2011-01-01",
            "end_date": "2015-12-31",
            "daily": "temperature_2m_max",
            "timezone": "GMT",
        }
        for attempt in range(4):
            try:
                with urlopen(ENDPOINT + "?" + urlencode(params), timeout=90) as response:
                    payload = json.load(response)
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        if isinstance(payload, dict):
            payload = [payload]
        if len(payload) != len(batch):
            raise ValueError("Response count does not match requested weather points")
        for (_, cell), item in zip(batch.iterrows(), payload):
            daily = item["daily"]
            pieces.append(pd.DataFrame({
                "weather_lat": cell.weather_lat,
                "weather_lon": cell.weather_lon,
                "date": daily["time"],
                "temperature_2m_max_c": daily["temperature_2m_max"],
                "temp_source_lat": item["latitude"],
                "temp_source_lon": item["longitude"],
            }))
        print(f"Fetched {min(start + 10, len(cells))}/{len(cells)} requested points", flush=True)
    result = pd.concat(pieces, ignore_index=True)
    if result.temperature_2m_max_c.isna().any():
        raise ValueError("Missing daily maximum temperature")
    result["month"] = result.date.str[:7]
    check = result.assign(hot=result.temperature_2m_max_c.ge(25).astype(int)).groupby(
        ["weather_lat", "weather_lon", "month"], as_index=False).agg(
        hot_days_check=("hot", "sum"), days_check=("hot", "size"))
    compare = saved.merge(check, on=["weather_lat", "weather_lon", "month"], validate="one_to_one")
    if len(compare) != len(saved) or not compare.hot_days.eq(compare.hot_days_check).all() or not compare.days.eq(compare.days_check).all():
        raise ValueError("Fresh daily values do not reproduce the saved monthly analysis data")
    result.drop(columns="month").to_csv(DAILY, index=False, compression="gzip")
    print("Verified monthly counts; saved", len(result), "daily rows to", DAILY)


if __name__ == "__main__":
    main()
