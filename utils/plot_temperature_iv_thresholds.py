"""Plot the M7 temperature-threshold IV sensitivity results."""

from __future__ import annotations

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.colors import Normalize

from utils.temperature_iv import OUT

RESULT = OUT / "temperature_m7_threshold_sensitivity.csv"
CRIMES = ("allcrime", "violentcrime", "propertycrime")
EXPOSURES = ("annual", "lagyear", "prior12")


def plot(data: pd.DataFrame) -> tuple[plt.Figure, plt.Figure]:
    """Return a first-stage heatmap and the prior12 violent-crime IV comparison."""
    thresholds = sorted(data.threshold_c.unique())
    expected = pd.MultiIndex.from_product(
        [CRIMES, EXPOSURES, thresholds], names=["crime", "exposure", "threshold_c"])
    indexed = data.set_index(["crime", "exposure", "threshold_c"]).sort_index()
    if len(data) != len(expected) or not indexed.index.is_unique or not indexed.index.difference(expected).empty:
        raise ValueError("Expected one fit for each crime, exposure, and threshold")
    first_stage = indexed.first_stage_F_weather_cell.reindex(expected).to_numpy().reshape(9, len(thresholds))

    fig_f, ax = plt.subplots(figsize=(8.2, 6.3))
    im = ax.imshow(first_stage, aspect="auto", cmap="YlGnBu", norm=Normalize(0, 20))
    for i in range(first_stage.shape[0]):
        for j in range(first_stage.shape[1]):
            value = first_stage[i, j]
            ax.text(j, i, f"{value:.1f}", ha="center", va="center",
                    color="white" if value >= 10 else "#202b35", fontsize=10)
    ax.set_xticks(range(len(thresholds)), [f"{t}°C" for t in thresholds])
    ax.set_yticks(range(9), [f"{c.replace('crime', '').title()} · {e}"
                             for c in CRIMES for e in EXPOSURES])
    ax.set_xlabel("Daily maximum temperature cutoff")
    ax.set_title("M7 first-stage Wald F by cutoff\nWeather-cell-clustered; values above 20 use the darkest shade")
    fig_f.colorbar(im, ax=ax, label="First-stage Wald F", shrink=.84)
    fig_f.text(.12, .015, "F = 10 is a rough screen, not evidence of instrument validity.",
               fontsize=9, color="#555555")
    fig_f.tight_layout(rect=(0, .045, 1, 1))

    focus = indexed.loc[("violentcrime", "prior12")].sort_index()
    fig_iv, ax = plt.subplots(figsize=(8.2, 4.3))
    for i, (threshold, row) in enumerate(focus.iterrows()):
        ax.errorbar(row.iv_beta, i,
                    xerr=[[row.iv_beta - row.iv_ci_low], [row.iv_ci_high - row.iv_beta]],
                    fmt="o", capsize=4, markersize=6, color="#245b8f")
        ax.text(.98, i, f"F = {row.first_stage_F_weather_cell:.1f}",
                transform=ax.get_yaxis_transform(), ha="right", va="center",
                fontsize=9, color="#555555",
                bbox={"facecolor": "white", "edgecolor": "none", "alpha": .8})
    ax.axvline(0, color="#777777", linestyle="--", linewidth=1)
    ax.set_yticks(range(len(focus)), [f"{t}°C" for t in focus.index])
    ax.invert_yaxis()
    ax.set_xlim(min(-1.1, focus.iv_ci_low.min() - .1),
                max(.65, focus.iv_ci_high.max() + .3))
    ax.set_xlabel("2SLS coefficient on ln(1 + violent crime), 95% CI")
    ax.set_title("M7 prior12 violent crime: temperature cutoff sensitivity")
    fig_iv.text(.12, .01, "Same 338,347 sales; weather-cell-clustered intervals (21 clusters).",
                fontsize=9, color="#555555")
    fig_iv.tight_layout(rect=(0, .055, 1, 1))
    return fig_f, fig_iv


def main() -> tuple[plt.Figure, plt.Figure]:
    data = pd.read_csv(RESULT)
    fig_f, fig_iv = plot(data)
    fig_f.savefig(OUT / "temperature_m7_threshold_first_stage.png", dpi=180, bbox_inches="tight")
    fig_iv.savefig(OUT / "temperature_m7_threshold_violent_prior12_iv.png", dpi=180,
                   bbox_inches="tight")
    return fig_f, fig_iv


if __name__ == "__main__":
    first_stage_fig, iv_fig = main()
    plt.close(first_stage_fig)
    plt.close(iv_fig)
