"""Screen hot days as one M7 instrument candidate for prior-12-month violent crime.

This fits only the first stage. It does not establish an exclusion restriction
or estimate a causal effect of crime on house prices.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
import pandas as pd
from linearmodels.iv import IV2SLS
from scipy import stats

import rainfall_iv as base
from rainfall_iv_sequence import absorb

OUT = base.OUT
CACHE = OUT / "open_meteo_hot_days_25c_monthly.csv.gz"
RESULT = OUT / "temperature_hot_days_m7_first_stage.csv"
THRESHOLD_C = 25.0


def monthly_hot_days() -> pd.DataFrame:
    cells = pd.read_csv(base.LOCATION)[["weather_lat", "weather_lon"]].drop_duplicates().sort_values(
        ["weather_lat", "weather_lon"]
    ).reset_index(drop=True)
    if CACHE.exists():
        saved = pd.read_csv(CACHE)
        found = saved[["weather_lat", "weather_lon"]].drop_duplicates().sort_values(
            ["weather_lat", "weather_lon"]
        ).reset_index(drop=True)
        if not cells.equals(found):
            raise ValueError("Temperature cache locations differ from the current weather grid")
        return saved
    parts = []
    for offset in range(0, len(cells), 10):
        batch = cells.iloc[offset:offset + 10]
        params = {
            "latitude": ",".join(batch.weather_lat.map(str)),
            "longitude": ",".join(batch.weather_lon.map(str)),
            "start_date": base.START,
            "end_date": base.END,
            "daily": "temperature_2m_max",
            "timezone": "GMT",
        }
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
            raise ValueError("Temperature response location count differs from request")
        for (_, cell), item in zip(batch.iterrows(), payload):
            daily = item["daily"]
            piece = pd.DataFrame({
                "weather_lat": cell.weather_lat,
                "weather_lon": cell.weather_lon,
                "date": daily["time"],
                "temperature_max_c": daily["temperature_2m_max"],
                "temp_source_lat": item["latitude"],
                "temp_source_lon": item["longitude"],
            })
            if piece.temperature_max_c.isna().any():
                raise ValueError("Temperature API returned missing daily values")
            parts.append(piece)
        print(f"Fetched temperature for {min(offset + 10, len(cells))}/{len(cells)} locations", flush=True)
    daily = pd.concat(parts, ignore_index=True)
    daily["month"] = pd.to_datetime(daily.date).dt.to_period("M").astype(str)
    daily["hot_day"] = daily.temperature_max_c.ge(THRESHOLD_C).astype(int)
    monthly = daily.groupby(["weather_lat", "weather_lon", "month"], as_index=False).agg(
        hot_days=("hot_day", "sum"), days=("hot_day", "size"),
        temp_source_lat=("temp_source_lat", "first"),
        temp_source_lon=("temp_source_lon", "first"),
    )
    month_days = pd.PeriodIndex(monthly.month, freq="M").days_in_month
    if not np.array_equal(monthly.days.to_numpy(), month_days):
        raise ValueError("A temperature month is incomplete")
    monthly.to_csv(CACHE, index=False, compression="gzip")
    return monthly


def add_hot_days(data: pd.DataFrame, monthly: pd.DataFrame) -> pd.DataFrame:
    monthly = monthly.sort_values(["weather_lat", "weather_lon", "month"]).copy()
    keys = ["weather_lat", "weather_lon"]
    monthly["hot_days_prior12"] = monthly.groupby(keys).hot_days.transform(
        lambda s: s.shift(1).rolling(12, min_periods=12).sum()
    )
    data = data.copy()
    data["sale_month"] = pd.to_datetime(
        dict(year=data.year, month=data.month, day=1)
    ).dt.to_period("M").astype(str)
    data = data.merge(
        monthly[keys + ["month", "hot_days_prior12", "temp_source_lat", "temp_source_lon"]],
        left_on=keys + ["sale_month"], right_on=keys + ["month"],
        how="left", validate="many_to_one",
    )
    return data


def first_stage(data: pd.DataFrame, time_effect: str) -> dict:
    dname = "log1p_mps_violence_prior12"
    zname = "hot_days_prior12"
    required = list(dict.fromkeys([dname, zname, "rainfall_prior12", "lsoacode",
                                   time_effect, "sale_month", "temp_source_lat",
                                   "temp_source_lon"] + base.CONTROLS))
    valid = data[required].notna().all(axis=1)
    valid &= data.analysis_geography_ok & data.mps_geography_ok & data.mps_exposures_available
    sample = data.loc[valid, required].copy()
    matrix = sample[[dname, zname] + base.CONTROLS].to_numpy(float)
    scales = matrix.std(axis=0)
    if np.any(scales < 1e-12):
        raise ValueError("A first-stage variable has no variation")
    matrix /= scales
    matrix = absorb(matrix, [sample.lsoacode, sample[time_effect]])
    d, z = matrix[:, :2].T
    x = matrix[:, 2:]
    keep = []
    for j in range(x.shape[1]):
        residual = x[:, j] if not keep else x[:, j] - x[:, keep] @ np.linalg.lstsq(
            x[:, keep], x[:, j], rcond=None
        )[0]
        if residual @ residual > 1e-10 * len(sample):
            keep.append(j)
    x = x[:, keep]
    weather_group = pd.factorize(pd.MultiIndex.from_frame(
        sample[["temp_source_lat", "temp_source_lon"]]
    ), sort=False)[0]
    groups = int(weather_group.max() + 1)
    fit = IV2SLS(d, np.column_stack([x, z]), None, None).fit(
        cov_type="clustered", clusters=weather_group, debiased=True
    )
    beta = float(fit.params.iloc[-1]) * scales[0] / scales[1]
    se = float(fit.std_errors.iloc[-1]) * scales[0] / scales[1]
    z_resid = z - x @ np.linalg.lstsq(x, z, rcond=None)[0]
    d_resid = d - x @ np.linalg.lstsq(x, d, rcond=None)[0]
    partial_r2 = float(np.corrcoef(d_resid, z_resid)[0, 1] ** 2)
    rainfall = pd.read_csv(OUT / "rainfall_m2_m7_iv_pilot.csv").query(
        "model == 'M7' and crime == 'violentcrime' and exposure == 'prior12'"
    ).iloc[0]
    across_cells = sample.groupby("sale_month")[zname].std().mean()
    return dict(model="M7" if time_effect == "yearquarter" else "M7 plus sale-month effects",
                time_fixed_effect=time_effect, crime="violentcrime", exposure="prior12",
                instrument="days with maximum temperature >= 25 C in prior 12 complete months",
                N=len(sample), lsoa_clusters=sample.lsoacode.nunique(),
                weather_cell_clusters=groups,
                temperature_mean_hot_days=float(sample[zname].mean()),
                temperature_sd_hot_days=float(sample[zname].std()),
                average_across_cell_sd_within_sale_month=float(across_cells),
                temperature_sd_after_fixed_effects=float(z.std() * scales[1]),
                temperature_sd_after_controls_and_fixed_effects=float(z_resid.std() * scales[1]),
                first_stage_beta_per_hot_day=beta,
                first_stage_se_weather_cell=se,
                first_stage_p_weather_cell=float(2 * stats.t.sf(abs(beta / se), groups - 1)),
                first_stage_F_weather_cell=(beta / se) ** 2,
                partial_R2=partial_r2,
                rainfall_first_stage_F_same_model=float(rainfall.first_stage_F_weather_cell) if time_effect == "yearquarter" else np.nan,
                rainfall_partial_R2_same_model=float(rainfall.partial_R2) if time_effect == "yearquarter" else np.nan,
                same_N_as_rainfall=bool(len(sample) == rainfall.N))


def main() -> None:
    monthly = monthly_hot_days()
    data = add_hot_days(base.prepare(), monthly)
    results = [first_stage(data, effect) for effect in ("yearquarter", "sale_month")]
    pd.DataFrame(results).to_csv(RESULT, index=False)
    print(pd.DataFrame(results).to_string(index=False))
    print(f"Saved {RESULT}")


if __name__ == "__main__":
    main()
