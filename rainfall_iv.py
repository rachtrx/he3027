"""Exploratory rainfall IV for the MPS M7 models.

Run with the project's EDA Python environment. The public weather source is
Open-Meteo historical reanalysis, not the 1 km HadUK-Grid archive. Results
are a feasibility check and do not establish the exclusion restriction.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
import pandas as pd
from linearmodels.iv import IV2SLS, AbsorbingLS
from scipy import stats

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = DATA / "04_crime_iv_outputs"
OUT.mkdir(exist_ok=True)
WEATHER = OUT / "open_meteo_rainfall_monthly.csv.gz"
LOCATION = OUT / "lsoa_weather_locations.csv"
START, END = "2011-01-01", "2015-12-31"
CRIMES = {"allcrime": "mps_all", "violentcrime": "mps_violence", "propertycrime": "mps_property"}
EXPOSURES = ("annual", "lagyear", "prior12")
CONTROLS = [
    "detached_dum", "semi_d_dum", "terrace_dum", "freehold", "newbuild",
    "tube_distnear_km", "bus_distnear_km", "thamesriv_dist_km", "dist_to_cbd",
    "Nearest_Park_dist_km", "grossannualpay_k", "hoursworked", "unemployment",
]


def locations(merged: pd.DataFrame) -> pd.DataFrame:
    # Mean coordinates of observed sales proxy the LSOA location, as in notebook 06.
    loc = merged.groupby("lsoacode", as_index=False)[["lat", "lon"]].mean()
    loc["weather_lat"] = np.round(loc.lat * 10) / 10
    loc["weather_lon"] = np.round(loc.lon * 10) / 10
    loc.to_csv(LOCATION, index=False)
    return loc


def fetch_weather(loc: pd.DataFrame) -> pd.DataFrame:
    cells = loc[["weather_lat", "weather_lon"]].drop_duplicates().sort_values(
        ["weather_lat", "weather_lon"]
    ).reset_index(drop=True)
    if WEATHER.exists():
        rain = pd.read_csv(WEATHER)
        actual = rain[["weather_lat", "weather_lon"]].drop_duplicates()
        if not cells.equals(actual.sort_values(["weather_lat", "weather_lon"]).reset_index(drop=True)):
            raise ValueError("Saved rainfall grid does not match current LSOA locations")
        return rain
    parts = []
    for offset in range(0, len(cells), 10):
        batch = cells.iloc[offset:offset + 10]
        params = {
            "latitude": ",".join(batch.weather_lat.map(str)),
            "longitude": ",".join(batch.weather_lon.map(str)),
            "start_date": START, "end_date": END,
            "daily": "precipitation_sum", "timezone": "GMT",
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
            raise ValueError("Weather response location count differs from request")
        for (_, cell), item in zip(batch.iterrows(), payload):
            daily = item["daily"]
            piece = pd.DataFrame({
                "weather_lat": cell.weather_lat,
                "weather_lon": cell.weather_lon,
                "date": daily["time"],
                "rain_mm": daily["precipitation_sum"],
                "source_lat": item["latitude"],
                "source_lon": item["longitude"],
            })
            if piece.rain_mm.isna().any():
                raise ValueError("Weather API returned missing rainfall")
            parts.append(piece)
        print(f"Fetched {min(offset + 10, len(cells))}/{len(cells)} weather locations", flush=True)
    daily = pd.concat(parts, ignore_index=True)
    daily["month"] = pd.to_datetime(daily.date).dt.to_period("M").astype(str)
    rain = daily.groupby(["weather_lat", "weather_lon", "month"], as_index=False).agg(
        rain_mm=("rain_mm", "sum"), source_lat=("source_lat", "first"),
        source_lon=("source_lon", "first"), days=("rain_mm", "size"),
    )
    rain.to_csv(WEATHER, index=False, compression="gzip")
    return rain


def exposure_rainfall(merged: pd.DataFrame, loc: pd.DataFrame, rain: pd.DataFrame) -> pd.DataFrame:
    base = merged[["transaction_id", "lsoacode", "year", "month"]].merge(
        loc[["lsoacode", "weather_lat", "weather_lon"]], on="lsoacode", validate="many_to_one"
    )
    panel = loc[["lsoacode", "weather_lat", "weather_lon"]].merge(
        rain[["weather_lat", "weather_lon", "month", "rain_mm"]],
        on=["weather_lat", "weather_lon"], validate="many_to_many"
    )
    panel["period"] = pd.PeriodIndex(panel.month, freq="M")
    panel["year"] = panel.period.dt.year
    annual = panel.groupby(["lsoacode", "year"], as_index=False).agg(
        rainfall_annual=("rain_mm", "sum"), months=("rain_mm", "size")
    )
    annual.loc[annual.months.ne(12), "rainfall_annual"] = np.nan
    previous = annual[["lsoacode", "year", "rainfall_annual"]].rename(
        columns={"rainfall_annual": "rainfall_lagyear"}
    )
    previous["year"] += 1
    panel = panel.sort_values(["lsoacode", "period"])
    panel["rainfall_prior12"] = panel.groupby("lsoacode").rain_mm.transform(
        lambda s: s.shift(1).rolling(12, min_periods=12).sum()
    )
    base = base.merge(annual[["lsoacode", "year", "rainfall_annual"]],
                      on=["lsoacode", "year"], how="left", validate="many_to_one")
    base = base.merge(previous, on=["lsoacode", "year"], how="left", validate="many_to_one")
    base["sale_month"] = pd.to_datetime(dict(year=base.year, month=base.month, day=1)).dt.to_period("M").astype(str)
    base = base.merge(panel[["lsoacode", "month", "rainfall_prior12"]],
                      left_on=["lsoacode", "sale_month"], right_on=["lsoacode", "month"],
                      how="left", validate="many_to_one", suffixes=("", "_weather"))
    assert len(base) == len(merged)
    return base[["transaction_id"] + ["rainfall_" + e for e in EXPOSURES]]


def prepare() -> pd.DataFrame:
    cols = ["transaction_id", "price", "age", "grossannualpay", "Nearest_Park_dist",
            "tube_distnear", "bus_distnear", "thamesriv_dist", "lsoacode", "msoa11",
            "oslaua", "yearquarter",
            "year", "month", "lat", "lon", "analysis_geography_ok", "mps_geography_ok",
            "mps_exposures_available"]
    cols += [c for c in CONTROLS if c in ("detached_dum", "semi_d_dum", "terrace_dum", "freehold", "dist_to_cbd", "hoursworked", "unemployment")]
    cols += [v + "_" + e for v in CRIMES.values() for e in EXPOSURES]
    merged = pd.read_csv(DATA / "crime_housing_merged.csv.gz", usecols=cols, low_memory=False)
    loc = locations(merged)
    rain = fetch_weather(loc)
    sources = rain[["weather_lat", "weather_lon", "source_lat", "source_lon"]].drop_duplicates()
    loc = loc.merge(sources, on=["weather_lat", "weather_lon"], validate="many_to_one")
    loc.to_csv(LOCATION, index=False)
    rain_exposures = exposure_rainfall(merged, loc, rain)
    merged = merged.merge(rain_exposures, on="transaction_id", validate="one_to_one")
    merged = merged.merge(loc[["lsoacode", "weather_lat", "weather_lon", "source_lat", "source_lon"]],
                          on="lsoacode", validate="many_to_one")
    merged["lnprice"] = np.log(merged.price.where(merged.price.gt(0)))
    merged["newbuild"] = merged.age.eq("Y").astype(float)
    merged["grossannualpay_k"] = merged.grossannualpay / 1000
    for name in ("Nearest_Park_dist", "tube_distnear", "bus_distnear", "thamesriv_dist"):
        merged[name + "_km"] = merged[name] / 1000
    for name in CRIMES.values():
        for exposure in EXPOSURES:
            c = name + "_" + exposure
            merged["log1p_" + c] = np.log1p(merged[c].where(merged[c].ge(0)))
    return merged


def estimate(data: pd.DataFrame, crime: str, exposure: str) -> dict:
    dname = "log1p_" + CRIMES[crime] + "_" + exposure
    zname = "rainfall_" + exposure
    required = ["lnprice", dname, zname, "lsoacode", "yearquarter",
                "source_lat", "source_lon"] + CONTROLS
    valid = data[required].notna().all(axis=1)
    valid &= data.analysis_geography_ok & data.mps_geography_ok & data.mps_exposures_available
    sample = data.loc[valid, required].copy()
    if sample.empty:
        raise ValueError(f"No complete observations for {crime} {exposure}")
    # Scale rainfall per 100 mm, leaving the crime coefficient in its usual units.
    sample[zname] /= 100
    absorbed = pd.DataFrame({
        "lsoacode": pd.Categorical(sample.lsoacode),
        "yearquarter": pd.Categorical(sample.yearquarter),
    }, index=sample.index)
    cluster = sample.lsoacode
    weather_cluster = pd.factorize(pd.MultiIndex.from_frame(
        sample[["source_lat", "source_lon"]]), sort=False)[0]
    fs = AbsorbingLS(sample[dname], sample[[zname] + CONTROLS], absorb=absorbed,
                     drop_absorbed=True).fit(cov_type="clustered", clusters=cluster, debiased=True)
    fs_weather = AbsorbingLS(sample[dname], sample[[zname] + CONTROLS], absorb=absorbed,
                             drop_absorbed=True).fit(cov_type="clustered",
                                                     clusters=weather_cluster, debiased=True)
    if zname not in fs.params:
        raise ValueError("Rainfall was absorbed by M7 fixed effects")
    z_beta = float(fs.params[zname]); z_se = float(fs.std_errors[zname])
    z_se_weather = float(fs_weather.std_errors[zname])
    # Numerical two-way demeaning lets IV2SLS use precisely the same FE sample.
    names = ["lnprice", dname, zname] + CONTROLS
    mat = sample[names].to_numpy(float)
    scales = mat.std(axis=0); scales[scales < 1e-12] = 1; scales[0] = 1
    mat /= scales
    codes = [pd.factorize(sample[c], sort=False)[0] for c in ("lsoacode", "yearquarter")]
    for iteration in range(2000):
        before = mat.copy()
        for code in codes:
            counts = np.bincount(code)
            sums = np.stack([np.bincount(code, weights=mat[:, j], minlength=len(counts))
                             for j in range(mat.shape[1])], axis=1)
            mat -= (sums / counts[:, None])[code]
        if np.max(np.abs(mat - before)) < 1e-10:
            break
    else:
        raise RuntimeError("Fixed effects did not converge")
    # Drop absorbed/collinear controls before fitting the exact identified model.
    x = mat[:, 3:]
    keep = []
    for j in range(x.shape[1]):
        residual = x[:, j] if not keep else x[:, j] - x[:, keep] @ np.linalg.lstsq(x[:, keep], x[:, j], rcond=None)[0]
        if residual @ residual > 1e-10 * len(x):
            keep.append(j)
    x = x[:, keep]
    group = weather_cluster
    ols = IV2SLS(mat[:, 0], np.column_stack([x, mat[:, 1]]), None, None).fit(
        cov_type="clustered", clusters=group, debiased=True)
    iv = IV2SLS(mat[:, 0], x, mat[:, 1], mat[:, 2]).fit(
        cov_type="clustered", clusters=group, debiased=True)
    reduced = IV2SLS(mat[:, 0], np.column_stack([x, mat[:, 2]]), None, None).fit(
        cov_type="clustered", clusters=group, debiased=True)
    dz = mat[:, 1] - x @ np.linalg.lstsq(x, mat[:, 1], rcond=None)[0]
    zz = mat[:, 2] - x @ np.linalg.lstsq(x, mat[:, 2], rcond=None)[0]
    partial_r2 = float(np.corrcoef(dz, zz)[0, 1] ** 2)
    G = len(np.unique(group))
    crit = stats.t.ppf(.975, G - 1)
    def result(fit, divisor):
        beta = float(fit.params.iloc[-1]) / divisor
        se = float(fit.std_errors.iloc[-1]) / divisor
        return beta, se, 2 * stats.t.sf(abs(beta / se), G - 1), beta - crit * se, beta + crit * se
    ols_b, ols_se, ols_p, ols_low, ols_high = result(ols, scales[1])
    iv_b, iv_se, iv_p, iv_low, iv_high = result(iv, scales[1])
    rf_b, rf_se, rf_p, _, _ = result(reduced, scales[2])
    try:
        endog_test = iv.wooldridge_regression
        endog_p = float(endog_test.pval)
        endog_stat = float(endog_test.stat)
    except Exception:
        endog_p = np.nan
        endog_stat = np.nan
    return dict(crime=crime, exposure=exposure, N=len(sample),
                lsoa_clusters=sample.lsoacode.nunique(), weather_cell_clusters=G,
                first_stage_beta_per_100mm=z_beta, first_stage_se=z_se,
                first_stage_F=(z_beta / z_se) ** 2, partial_R2=partial_r2,
                first_stage_se_weather_cell=z_se_weather,
                first_stage_F_weather_cell=(z_beta / z_se_weather) ** 2,
                reduced_form_beta_per_100mm=rf_b, reduced_form_se=rf_se,
                reduced_form_p=rf_p, m7_ols_beta=ols_b, m7_ols_se=ols_se,
                m7_ols_p=ols_p, m7_ols_ci_low=ols_low, m7_ols_ci_high=ols_high,
                iv_beta=iv_b, iv_se=iv_se, iv_p=iv_p,
                iv_ci_low=iv_low, iv_ci_high=iv_high,
                wooldridge_exogeneity_chi2=endog_stat,
                wooldridge_exogeneity_p=endog_p,
                interpretation="illustrative only: exclusion restriction unverified")


def export_results(rows: list[dict]) -> None:
    tidy = []
    for row in rows:
        for method, prefix in (("OLS", "m7_ols"), ("2SLS", "iv")):
            tidy.append(dict(crime=row["crime"], exposure=row["exposure"],
                             specification="LSOA + quarter", model="M7", method=method,
                             data_source="MPS", N=row["N"],
                             clusters=row["weather_cell_clusters"],
                             beta=row[prefix + "_beta"], se=row[prefix + "_se"],
                             p=row[prefix + "_p"],
                             ci_low=row.get(prefix + "_ci_low", np.nan),
                             ci_high=row.get(prefix + "_ci_high", np.nan),
                             first_stage_wald_F=row["first_stage_F_weather_cell"],
                             partial_R2=row["partial_R2"],
                             fixed_effects="lsoacode; yearquarter"))
    pd.DataFrame(tidy).to_csv(OUT / "rainfall_regressions.csv", index=False)
    tests = pd.DataFrame(rows).rename(columns={
        "wooldridge_exogeneity_chi2": "clustered_wooldridge_chi2",
        "wooldridge_exogeneity_p": "clustered_wooldridge_p",
        "weather_cell_clusters": "clusters",
        "first_stage_F_weather_cell": "first_stage_wald_F",
    })
    tests["specification"] = "LSOA + quarter"
    tests["reject_exogeneity_5pct"] = tests.clustered_wooldridge_p.lt(.05)
    tests[["crime", "exposure", "specification", "N", "clusters",
           "clustered_wooldridge_chi2", "clustered_wooldridge_p",
           "reject_exogeneity_5pct", "first_stage_wald_F", "partial_R2"]].to_csv(
               OUT / "rainfall_endogeneity_tests.csv", index=False)
    print(pd.DataFrame(rows)[["crime", "exposure", "N", "first_stage_F", "partial_R2", "m7_ols_beta", "iv_beta"]].to_string(index=False))


def main() -> None:
    data = prepare()
    print(f"Prepared {len(data):,} sales and rainfall exposures", flush=True)
    rows = []
    for exposure in EXPOSURES:
        for crime in CRIMES:
            print(f"Fitting {crime} / {exposure}", flush=True)
            rows.append(estimate(data, crime, exposure))
            pd.DataFrame(rows).to_csv(OUT / "rainfall_m7_iv_pilot.csv", index=False)
    export_results(rows)


if __name__ == "__main__":
    main()
