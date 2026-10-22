"""Draw a sparse London network and a boundary-aware eight-neighbour inset."""
import gzip
import json
from pathlib import Path
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Patch
from matplotlib.lines import Line2D
import numpy as np
import pandas as pd

def rings(feature):
    g = feature["geometry"]
    parts = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    return [part[0] for part in parts]

def make_plot(root: Path) -> Path:
    out = Path(root) / "data" / "06_crime_spatial_outputs"
    loc = pd.read_csv(out / "lsoa_representative_coordinates.csv").set_index("lsoacode")
    edges = pd.read_csv(out / "lsoa_neighbour_distances.csv.gz")
    with gzip.open(Path(root) / "project_data" / "boundaries" / "lsoa_2011_boundaries.geojson.gz", "rt") as f:
        features = json.load(f)["features"]
    shapes = {f["properties"]["LSOA11CD"]: f for f in features}
    center = ((loc.lat - 51.50)**2 + (loc.lon + .12)**2).idxmin()
    selected = edges.loc[(edges.lsoacode == center) & (edges.k == 8)].sort_values("distance_km").neighbour.tolist()
    assert len(selected) == 8 and all(c in shapes for c in [center, *selected])
    fig, (wide, zoom) = plt.subplots(1, 2, figsize=(14, 6))
    wide.scatter(loc.lon, loc.lat, s=2, color="#adb8bf", alpha=.65, zorder=1)
    sampled = loc.index[np.random.default_rng(302706).choice(len(loc), 50, replace=False)]
    for e in edges.loc[(edges.k == 8) & edges.lsoacode.isin(sampled)].itertuples(index=False):
        wide.plot([loc.at[e.lsoacode, "lon"], loc.at[e.neighbour, "lon"]],
                  [loc.at[e.lsoacode, "lat"], loc.at[e.neighbour, "lat"]],
                  color="#397dab", alpha=.4, lw=.9, zorder=2)
    wide.scatter(loc.loc[sampled, "lon"], loc.loc[sampled, "lat"], s=12,
                 color="#397dab", edgecolor="white", linewidth=.2, zorder=3)
    wide.scatter(loc.at[center, "lon"], loc.at[center, "lat"], s=80,
                 color="#de7918", edgecolor="white", zorder=3)
    wide.set(xlabel="Longitude", ylabel="Latitude", title="London: 50 example LSOAs and their 8 links")
    wide.grid(alpha=.1)
    lat0, lon0 = loc.loc[center, ["lat", "lon"]]
    def km(r):
        a = np.asarray(r)
        return np.column_stack(((a[:, 0]-lon0)*111.32*np.cos(np.deg2rad(lat0)),
                                (a[:, 1]-lat0)*111.32))
    points = np.concatenate([km(r) for c in [center, *selected] for r in rings(shapes[c])])
    (xmin, ymin), (xmax, ymax) = points.min(axis=0)-.15, points.max(axis=0)+.15
    for c, f in shapes.items():
        for r in rings(f):
            a = km(r)
            if a[:, 0].max()<xmin or a[:, 0].min()>xmax or a[:, 1].max()<ymin or a[:, 1].min()>ymax:
                continue
            zoom.add_patch(Polygon(a, facecolor="#f3f5f6", edgecolor="#b6bec4", lw=.5, zorder=1))
    for c, fill, edge in [(x, "#abd2e6", "#326d94") for x in selected] + [(center, "#f3ab63", "#b65b07")]:
        for r in rings(shapes[c]):
            zoom.add_patch(Polygon(km(r), facecolor=fill, edgecolor=edge, lw=1.3, zorder=2))
    for rank, c in enumerate(selected, 1):
        x = (loc.at[c, "lon"]-lon0)*111.32*np.cos(np.deg2rad(lat0))
        y = (loc.at[c, "lat"]-lat0)*111.32
        zoom.plot([0,x],[0,y], color="#2e719c", lw=1, zorder=3)
        zoom.scatter(x,y,s=110,color="#216995",edgecolor="white",lw=.7,zorder=4)
        zoom.text(x,y,str(rank),ha="center",va="center",color="white",weight="bold",fontsize=8,zorder=5)
    zoom.scatter(0,0,s=165,color="#de7918",edgecolor="white",zorder=6)
    zoom.set(xlim=(xmin,xmax), ylim=(ymin,ymax), xlabel="Kilometres east of example LSOA",
             ylabel="Kilometres north of example LSOA", title=f"2011 boundaries: {center} and its 8 neighbours")
    zoom.set_aspect("equal",adjustable="box")
    zoom.grid(alpha=.1)
    fig.legend(handles=[Patch(facecolor="#f3ab63",edgecolor="#b65b07",label="Example LSOA"),
                        Patch(facecolor="#abd2e6",edgecolor="#326d94",label="Eight nearest LSOAs"),
                        Patch(facecolor="#f3f5f6",edgecolor="#b6bec4",label="Other LSOAs"),
                        Line2D([],[],color="#2e719c",label="Point-to-point link")],
               loc="lower center",bbox_to_anchor=(.5,.07),ncol=4,fontsize=8,frameon=False)
    fig.suptitle("How the 8-neighbour crime measure is constructed",fontsize=15)
    fig.text(.5,.018,"ONS 2011 boundaries; neighbour distances use representative sale-location points, not shared borders.",
             ha="center",color="#4d5964",fontsize=9)
    fig.subplots_adjust(top=.86,bottom=.20,left=.06,right=.98,wspace=.28)
    path = out / "lsoa_neighbour_map.png"
    fig.savefig(path,dpi=180)
    plt.close(fig)
    return path

if __name__ == "__main__":
    print(make_plot(Path(__file__).resolve().parents[1]))
