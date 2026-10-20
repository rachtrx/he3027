#!/usr/bin/env python3
"""Build the compact, browser-friendly regression data for GitHub Pages."""

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "docs" / "data" / "regressions.json"

SOURCES = [
    ("stata_current", "Original Stata crime", "current-year", "01_crime_current_year_outputs", "annual"),
    ("stata_previous", "Original Stata crime", "previous-year", "02_crime_previous_year_outputs", "lagyear"),
    ("mps_annual", "MPS crime", "annual", "03_crime_mps_outputs", "annual"),
    ("mps_lagyear", "MPS crime", "previous-year", "03_crime_mps_outputs", "lagyear"),
    ("mps_prior12", "MPS crime", "prior 12 months", "03_crime_mps_outputs", "prior12"),
]


def read_csv(path):
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def number(value):
    if value in (None, "", "NA", "NaN"):
        return None
    try:
        return float(value)
    except ValueError:
        return value


def display_crime(source_id, crime, exposure):
    if crime == "no crime":
        return f"{source_id} · M1 benchmark"
    if source_id.startswith("stata"):
        names = {"allcrime": "all crime", "violent_crime": "violent crime", "propertycrime": "property crime"}
        return f"Stata {names.get(crime, crime)} · {exposure}"
    names = {"mps_all": "MPS all crime", "mps_violence": "MPS violence", "mps_property": "MPS property crime"}
    return f"{names.get(crime, crime)} · {exposure}"


def main():
    records = []
    for source_id, source_label, timing_label, folder, exposure in SOURCES:
        model_path = DATA / folder / ("primary_" + exposure + "_models.csv")
        coefficient_path = DATA / folder / ("primary_" + exposure + "_all_coefficients.csv")
        models = read_csv(model_path)
        coefficients = read_csv(coefficient_path)
        grouped = {}
        for row in coefficients:
            key = (row["model"], row["crime"])
            grouped.setdefault(key, []).append({
                "variable": row["variable"],
                "beta": number(row["beta"]),
                "se": number(row["se"]),
                "p": number(row.get("p")),
                "t": number(row.get("t")),
                "ci_low": number(row.get("ci_low")),
                "ci_high": number(row.get("ci_high")),
            })
        for row in models:
            model = row["model"]
            crime = row["crime"]
            key = f"{source_id}::{exposure}::{model}::{crime}"
            records.append({
                "id": key,
                "source_id": source_id,
                "source": source_label,
                "timing": timing_label,
                "exposure": exposure,
                "model": model,
                "crime": crime,
                "label": display_crime(source_id, crime, timing_label),
                "N": number(row.get("N")),
                "clusters": number(row.get("clusters")),
                "beta": number(row.get("beta")),
                "se": number(row.get("se")),
                "p": number(row.get("p")),
                "ci_low": number(row.get("ci_low")),
                "ci_high": number(row.get("ci_high")),
                "r2": number(row.get("r2")),
                "r2_type": row.get("r2_type", ""),
                "fixed_effects": row.get("fixed_effects", ""),
                "absorbed_or_collinear": row.get("absorbed_or_collinear", ""),
                "coefficients": grouped.get((model, crime), []),
            })
    records.sort(key=lambda r: (r["model"], r["source_id"], r["crime"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    extensions = []
    for title, folder, filename, columns, note in [
        ('04 · Instrumental variables', '04_crime_iv_outputs', 'all_iv_regressions.csv', [], 'Residential burglary instrumented with business/community burglary. A strong first stage does not establish instrument validity. No causal conclusion is justified by the sign alone.'),
        ('05 · Price quantiles', '05_crime_quantile_outputs', 'quantile_results.csv', ['crime', 'quantile', 'beta', 'ci_low', 'ci_high', 'N', 'bootstrap_success'], 'All-crime estimates range from negative at the 5th conditional price percentile to positive at the 95th in the current export. This pilot uses 6,000 observations and 39 successful bootstrap draws per estimate. Conditional quantiles are not fixed groups of homes.'),
        ('06 · Neighbourhood effects', '06_crime_spatial_outputs', 'spatial_regressions.csv', ['specification', 'k', 'crime', 'beta', 'se', 'ci_low', 'ci_high', 'N'], 'The reported beta is own-area crime, even when neighbour controls are added. k is the number of neighbours. These are area-year regressions with LSOA and year effects, not transaction-level M1–M7 estimates.'),
        ('06 · Spatial clustering', '06_crime_spatial_outputs', 'moran_diagnostics.csv', ['k', 'year', 'variable', 'moran_I', 'permutation_p', 'permutations'], "Positive Moran’s I indicates similar values in nearby areas. Residual clustering can remain after regression controls; this diagnostic is not a causal effect."),
    ]:
        path = DATA / folder / filename
        rows = [{k: number(v) for k, v in row.items() if k and k != 'Unnamed: 0'} for row in read_csv(path)] if path.exists() else []
        extensions.append(dict(title=title, columns=columns or (list(rows[0]) if rows else []), note=note, rows=rows))
    OUT.write_text(json.dumps({"version": 2, "records": records, "extensions": extensions}, indent=2), encoding="utf-8")
    print(f"Wrote {len(records)} regression records to {OUT}")


if __name__ == "__main__":
    from dashboard_catalog import build
    build()
