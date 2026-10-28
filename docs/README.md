# Regression comparison dashboard

Each comparison column selects independently using its header dropdown. The options follow report sections 6.1–6.3: MPS prior-12-month M2–M7, MPS M7 timing, original-crime M7 sample windows, violent-crime prior-12-month temperature IV, and violent-crime prior-12-month spatial regressions. The spatial selector includes own crime and 4, 8, or 12 neighbours; its comparison table shows the neighbour coefficient separately. Borough-income interactions, longer exposure windows, crime level and Δ log crime, and quantile regressions appear under “Additional” at the end. Other exported regressions remain available in the output browser. Notebook 04's temperature instrument has an unverified exclusion restriction; the “Requires IV?” diagnostic is conditional on a valid instrument. Notebook 06's SLX uses individual sales and sale-month prior-12-month own and neighbouring crime. Its quarterly Moran diagnostics aggregate transaction-level residuals to LSOA-quarter after fitting models with LSOA and year-quarter fixed effects on the same spatial sample. The IV and quarterly spatial appendix tables have copy buttons that provide a formatted table for Google Docs and tab-separated text for Google Sheets. Each build versions the JavaScript URL to prevent outdated cached scripts from breaking the updated page.

The IV diagnostics panel shows all three prior-12-month crime types at 25°C, followed by violent-crime-only threshold robustness at 20°C, 22°C, 25°C and 27°C. Notebook 10's M7 comparison of 6, 12, 24 and 36 completed months of MPS crime remains in the regression dropdown and output tables; its dedicated section and figure have been removed. All twelve four-window estimates use the same post-April-2013 sales. A separate six-versus-twelve-month table uses the full M7 sample. Notebook 11's recent-level and Δ log crime models are in the regression dropdown; its two-period estimates remain in the output tables. These exploratory results should not be confused with the main M7 sample.

When an interaction regression is selected, the comparison table shows the crime main-effect beta at mean borough income immediately above the crime × income coefficient. The full regression view retains all coefficients and their inference.

## Automatic discovery

Run `python build_dashboard_data.py` locally, or push committed outputs to main and let GitHub Actions build it. The builder scans `data/*outputs/` folders recursively for CSV and PNG/JPEG/WebP/GIF files. Notebook 04 is deliberately limited to its focused violent-crime threshold table and figure on the dashboard; its full research outputs remain in `data/`. Other formats, including compressed inputs, are not published.

CSV schemas determine comparison eligibility: model/crime/beta/N tables join the shared-model comparison; beta/N tables with method, quantile or specification fields get their own comparison family. Every CSV remains accessible with search, sorting, pagination and download even when its schema is unfamiliar. The gallery supports notebook/filename filters, enlargement and two-image comparison.

Generated assets live in `docs/generated/` and are rebuilt on deployment. Notebook execution is separate: rerun notebooks and commit their outputs. The displayed build timestamp is not proof of execution success or a historical run archive.

Positive estimates are green and negative estimates red. Full coefficient exports are available in All tables. Detailed main-model exports require a panel identifier to avoid presenting reduced summary exports as duplicate regressions.

## Rebuild the data

After rerunning the notebooks locally, commit the updated output CSVs and figures under `data/`. GitHub Actions rebuilds the dashboard automatically during deployment, so you do not need to run the builder manually.

Commit updated notebook 03–06 result CSVs too. Non-compressed data outputs are trackable; `.gz` files and the housing manifest are ignored.

## Enable GitHub Pages

The repository includes `.github/workflows/pages.yml`. In GitHub, set **Settings → Pages → Source** to **GitHub Actions**. Each push to `main` then publishes `docs/` automatically.
