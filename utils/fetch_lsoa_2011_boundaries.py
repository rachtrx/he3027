"""Cache official ONS 2011 LSOA polygons used by the spatial illustration.

Source: ONS Open Geography Portal, 2011 generalised clipped boundaries (V3).
https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA_Dec_2011_Boundaries_Generalised_Clipped_BGC_EW_V3/FeatureServer/0
"""

import gzip
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "06_crime_spatial_outputs"
DEST = ROOT / "project_data" / "boundaries" / "lsoa_2011_boundaries.geojson.gz"
SERVICE = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA_Dec_2011_Boundaries_Generalised_Clipped_BGC_EW_V3/FeatureServer/0/query"


def main() -> None:
    DEST.parent.mkdir(parents=True, exist_ok=True)
    codes = set(pd.read_csv(OUT / "lsoa_representative_coordinates.csv").lsoacode)
    features = {}
    offset = 0
    while True:
        params = {
            "where": "1=1",
            "geometry": "-0.6,51.25,0.35,51.75",
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "LSOA11CD",
            "outSR": 4326,
            "geometryPrecision": 5,
            "resultOffset": offset,
            "resultRecordCount": 2000,
            "f": "geojson",
        }
        with urlopen(SERVICE + "?" + urlencode(params), timeout=60) as response:
            page = json.load(response)
        if "error" in page:
            raise RuntimeError(page["error"])
        batch = page.get("features", [])
        for feature in batch:
            code = feature["properties"]["LSOA11CD"]
            if code in codes:
                features[code] = feature
        offset += len(batch)
        print("Downloaded", offset, "candidate polygons; matched", len(features))
        if len(batch) < 2000:
            break
    missing = codes - features.keys()
    if missing:
        raise ValueError(f"Missing {len(missing)} study LSOA boundaries, e.g. {sorted(missing)[:5]}")
    data = {"type": "FeatureCollection", "features": [features[c] for c in sorted(features)]}
    with gzip.open(DEST, "wt", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print("Saved", DEST, "with", len(features), "polygons")


if __name__ == "__main__":
    main()
