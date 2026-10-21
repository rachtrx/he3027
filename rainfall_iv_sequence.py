"""Rainfall IV diagnostics for MPS crime, M2--M7, on one common sample.

The estimates are exploratory. A first-stage relationship does not establish
that rainfall satisfies the exclusion restriction for house prices.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from linearmodels.iv import IV2SLS
from scipy import stats

import rainfall_iv as base

OUT = base.OUT
PROPERTY = ["detached_dum", "semi_d_dum", "terrace_dum", "freehold", "newbuild"]
SPECS = [
    ("M2", PROPERTY, []),
    ("M3", base.CONTROLS, []),
    ("M4", base.CONTROLS, ["oslaua", "year"]),
    ("M5", base.CONTROLS, ["msoa11", "year"]),
    ("M6", base.CONTROLS, ["msoa11", "yearquarter"]),
    ("M7", base.CONTROLS, ["lsoacode", "yearquarter"]),
]


def absorb(matrix: np.ndarray, groups: list[pd.Series]) -> np.ndarray:
    codes = [pd.factorize(g, sort=False)[0] for g in groups]
    if any((c < 0).any() for c in codes):
        raise ValueError("Missing fixed-effect identifier")
    for _ in range(2000):
        before = matrix.copy()
        for code in codes:
            counts = np.bincount(code)
            means = np.stack([
                np.bincount(code, weights=matrix[:, j], minlength=len(counts)) / counts
                for j in range(matrix.shape[1])
            ], axis=1)
            matrix -= means[code]
        if np.max(np.abs(matrix - before)) < 1e-10:
            return matrix
    raise RuntimeError("Fixed-effect absorption did not converge")


def estimate(data: pd.DataFrame, crime: str, exposure: str,
             model: str, controls: list[str], effects: list[str]) -> dict:
    dname = "log1p_" + base.CRIMES[crime] + "_" + exposure
    zname = "rainfall_" + exposure
    # The M2--M7 sequence uses the same complete MPS comparison sample.
    required = ["lnprice", dname, zname, "lsoacode", "msoa11", "oslaua", "year",
                "yearquarter", "source_lat", "source_lon"] + base.CONTROLS
    valid = data[required].notna().all(axis=1)
    valid &= data.analysis_geography_ok & data.mps_geography_ok & data.mps_exposures_available
    sample = data.loc[valid, required].copy()
    if sample.empty:
        raise ValueError(f"No complete observations: {model} {crime} {exposure}")
    sample[zname] /= 100  # instrument per 100 mm
    names = ["lnprice", dname, zname] + controls
    matrix = sample[names].to_numpy(float)
    scales = matrix.std(axis=0)
    scales[scales < 1e-12] = 1
    scales[0] = 1
    matrix /= scales
    if effects:
        matrix = absorb(matrix, [sample[c] for c in effects])
    else:
        matrix -= matrix.mean(axis=0)
    y, d, z = matrix[:, :3].T
    x = matrix[:, 3:]
    keep = []
    for j in range(x.shape[1]):
        residual = x[:, j] if not keep else x[:, j] - x[:, keep] @ np.linalg.lstsq(
            x[:, keep], x[:, j], rcond=None)[0]
        if residual @ residual > 1e-10 * len(sample):
            keep.append(j)
    x = x[:, keep]
    if not effects:
        x = np.column_stack([x, np.ones(len(sample))])
    weather_group = pd.factorize(pd.MultiIndex.from_frame(
        sample[["source_lat", "source_lon"]]), sort=False)[0]
    lsoa_group = pd.factorize(sample.lsoacode, sort=False)[0]
    G = int(weather_group.max() + 1)
    fs_x = np.column_stack([x, z])
    fs = IV2SLS(d, fs_x, None, None).fit(cov_type="clustered", clusters=weather_group, debiased=True)
    fs_lsoa = IV2SLS(d, fs_x, None, None).fit(cov_type="clustered", clusters=lsoa_group, debiased=True)
    rf = IV2SLS(y, fs_x, None, None).fit(cov_type="clustered", clusters=weather_group, debiased=True)
    ols = IV2SLS(y, np.column_stack([x, d]), None, None).fit(
        cov_type="clustered", clusters=weather_group, debiased=True)
    iv = IV2SLS(y, x, d, z).fit(cov_type="clustered", clusters=weather_group, debiased=True)
    crit = stats.t.ppf(.975, G - 1)

    def result(fit, divisor: float) -> tuple[float, float, float, float, float]:
        beta = float(fit.params.iloc[-1]) / divisor
        se = float(fit.std_errors.iloc[-1]) / divisor
        p = float(2 * stats.t.sf(abs(beta / se), G - 1))
        return beta, se, p, beta - crit * se, beta + crit * se

    fs_beta, fs_se, _, _, _ = result(fs, scales[2] / scales[1])
    fs_se_lsoa = float(fs_lsoa.std_errors.iloc[-1]) * scales[1] / scales[2]
    rf_beta, rf_se, rf_p, _, _ = result(rf, scales[2])
    ols_beta, ols_se, ols_p, ols_low, ols_high = result(ols, scales[1])
    iv_beta, iv_se, iv_p, iv_low, iv_high = result(iv, scales[1])
    dz = d - x @ np.linalg.lstsq(x, d, rcond=None)[0]
    zz = z - x @ np.linalg.lstsq(x, z, rcond=None)[0]
    partial_r2 = float(np.corrcoef(dz, zz)[0, 1] ** 2)
    test = iv.wooldridge_regression
    return dict(model=model, crime=crime, exposure=exposure, N=len(sample),
                lsoa_clusters=sample.lsoacode.nunique(), weather_cell_clusters=G,
                fixed_effects="; ".join(effects), controls="; ".join(controls),
                first_stage_beta_per_100mm=fs_beta,
                first_stage_se_weather_cell=fs_se,
                first_stage_F_weather_cell=(fs_beta / fs_se) ** 2,
                first_stage_se_lsoa=fs_se_lsoa,
                first_stage_F_lsoa=(fs_beta / fs_se_lsoa) ** 2,
                partial_R2=partial_r2,
                reduced_form_beta_per_100mm=rf_beta,
                reduced_form_se=rf_se, reduced_form_p=rf_p,
                ols_beta=ols_beta, ols_se=ols_se, ols_p=ols_p,
                ols_ci_low=ols_low, ols_ci_high=ols_high,
                iv_beta=iv_beta, iv_se=iv_se, iv_p=iv_p,
                iv_ci_low=iv_low, iv_ci_high=iv_high,
                wooldridge_exogeneity_chi2=float(test.stat),
                wooldridge_exogeneity_p=float(test.pval))


def export(rows: list[dict]) -> None:
    full = pd.DataFrame(rows)
    full.to_csv(OUT / "rainfall_m2_m7_iv_pilot.csv", index=False)
    tidy = []
    for row in rows:
        for method, prefix in (("OLS", "ols"), ("2SLS", "iv")):
            tidy.append(dict(model=row["model"], crime=row["crime"], exposure=row["exposure"],
                             method=method, data_source="MPS", N=row["N"],
                             clusters=row["weather_cell_clusters"],
                             beta=row[prefix + "_beta"], se=row[prefix + "_se"],
                             p=row[prefix + "_p"], ci_low=row[prefix + "_ci_low"],
                             ci_high=row[prefix + "_ci_high"],
                             first_stage_wald_F=row["first_stage_F_weather_cell"],
                             partial_R2=row["partial_R2"],
                             fixed_effects=row["fixed_effects"]))
    pd.DataFrame(tidy).to_csv(OUT / "rainfall_regressions.csv", index=False)
    tests = full.rename(columns={
        "wooldridge_exogeneity_chi2": "clustered_wooldridge_chi2",
        "wooldridge_exogeneity_p": "clustered_wooldridge_p",
        "weather_cell_clusters": "clusters",
        "first_stage_F_weather_cell": "first_stage_wald_F",
    })
    tests["specification"] = tests.model
    tests["reject_exogeneity_5pct"] = tests.clustered_wooldridge_p.lt(.05)
    tests[["model", "crime", "exposure", "specification", "N", "clusters",
           "clustered_wooldridge_chi2", "clustered_wooldridge_p",
           "reject_exogeneity_5pct", "first_stage_wald_F", "partial_R2"]].to_csv(
               OUT / "rainfall_endogeneity_tests.csv", index=False)


def main() -> None:
    data = base.prepare()
    rows = []
    for exposure in base.EXPOSURES:
        for crime in base.CRIMES:
            for model, controls, effects in SPECS:
                print(f"Fitting {exposure} / {crime} / {model}", flush=True)
                rows.append(estimate(data, crime, exposure, model, controls, effects))
                pd.DataFrame(rows).to_csv(OUT / "rainfall_m2_m7_iv_pilot.csv", index=False)
    export(rows)
    summary = pd.DataFrame(rows)
    print(summary[["model", "crime", "exposure", "N", "first_stage_F_weather_cell",
                   "partial_R2", "wooldridge_exogeneity_p"]].to_string(index=False))


if __name__ == "__main__":
    main()
