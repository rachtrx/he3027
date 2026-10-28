"""M7 temperature IV sensitivity to daily maximum temperature cutoffs.

Uses the same sales, controls, fixed effects, and weather-cell clustering as
the 25 C analysis. Run from the project root with
``python -m utils.temperature_iv_thresholds``.
"""

from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from utils import temperature_iv as base
from utils import temperature_iv_m7

DAILY = base.SOURCE / "open_meteo_daily_max_2011_2015.csv.gz"
RESULT = base.OUT / "temperature_m7_threshold_sensitivity.csv"
THRESHOLDS = (20, 22, 25, 27)
KEYS = ["weather_lat", "weather_lon"]


def attach_exposures(data: pd.DataFrame, daily: pd.DataFrame, threshold: int) -> pd.DataFrame:
    """Replace the three 25 C instruments with counts at one cutoff."""
    weather = daily[KEYS + ["date", "temperature_2m_max_c"]].copy()
    weather["period"] = pd.PeriodIndex(weather.date, freq="D").asfreq("M")
    weather["hot"] = weather.temperature_2m_max_c.ge(threshold).astype(int)
    monthly = weather.groupby(KEYS + ["period"], sort=True).agg(
        hot_days=("hot", "sum"), days=("hot", "size"))
    if not np.array_equal(monthly.days.to_numpy(),
                          monthly.index.get_level_values("period").days_in_month.to_numpy()):
        raise ValueError("Incomplete weather month")
    monthly = monthly.reset_index()
    monthly["year"] = monthly.period.dt.year
    annual = monthly.groupby(KEYS + ["year"], sort=True).agg(
        hot_days=("hot_days", "sum"), months=("hot_days", "size"))
    if annual.months.ne(12).any():
        raise ValueError("Incomplete weather year")
    lag = annual.hot_days.reset_index()
    lag["year"] += 1
    lag = lag.set_index(KEYS + ["year"]).hot_days
    monthly["prior12"] = monthly.groupby(KEYS).hot_days.transform(
        lambda s: s.shift(1).rolling(12, min_periods=12).sum())
    prior12 = monthly.set_index(KEYS + ["period"]).prior12

    out = data.copy(deep=False)
    out["hot_days_annual"] = annual.hot_days.reindex(
        pd.MultiIndex.from_frame(data[KEYS + ["year"]])).to_numpy()
    out["hot_days_lagyear"] = lag.reindex(
        pd.MultiIndex.from_frame(data[KEYS + ["year"]])).to_numpy()
    sale_period = pd.PeriodIndex(data.sale_month, freq="M")
    idx = pd.MultiIndex.from_arrays(
        [data.weather_lat, data.weather_lon, sale_period], names=KEYS + ["period"])
    out["hot_days_prior12"] = prior12.reindex(idx).to_numpy()
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--thresholds", nargs="+", type=int, default=THRESHOLDS)
    args = parser.parse_args()
    thresholds = tuple(dict.fromkeys(args.thresholds))
    daily = pd.read_csv(DAILY)
    if daily.temperature_2m_max_c.isna().any():
        raise ValueError("Missing daily maximum temperature")
    data = base.prepare()
    baseline = data[["hot_days_annual", "hot_days_lagyear", "hot_days_prior12"]].copy()
    rows = []
    if RESULT.exists() and set(thresholds) != set(THRESHOLDS):
        previous = pd.read_csv(RESULT)
        rows = previous.loc[~previous.threshold_c.isin(thresholds)].to_dict("records")
    for threshold in thresholds:
        sample = attach_exposures(data, daily, threshold)
        if threshold == 25 and not sample[baseline.columns].equals(baseline):
            raise AssertionError("Reconstructed 25 C exposures differ from the original")
        for exposure in base.EXPOSURES:
            for crime in base.CRIMES:
                print(f"Fitting {threshold} C / {exposure} / {crime} / M7", flush=True)
                row = temperature_iv_m7.estimate(
                    sample, crime, exposure, "M7", base.CONTROLS,
                    ["lsoacode", "yearquarter"])
                row["threshold_c"] = threshold
                rows.append(row)
                pd.DataFrame(rows).to_csv(RESULT, index=False)
    summary = pd.DataFrame(rows).sort_values(["threshold_c", "crime", "exposure"])
    summary.to_csv(RESULT, index=False)
    print(summary[["threshold_c", "crime", "exposure", "N",
                   "first_stage_F_weather_cell", "partial_R2", "iv_beta",
                   "iv_ci_low", "iv_ci_high"]].to_string(index=False))
    print(f"Saved {RESULT}")


if __name__ == "__main__":
    main()
