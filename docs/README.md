# Regression comparison dashboard

Each comparison column selects independently using its header dropdown. Options include main regressions, notebook 08 original-crime robustness on common 2012–2014 or 2012–2013 sale samples, M7 interactions, exploratory M7 IV and matched OLS, quantiles, and spatial regressions. Notebook 03's interaction uses prior-12-month MPS crime under M7. Notebook 04 uses days reaching 25°C as a candidate instrument for MPS crime under M7; its exclusion restriction is unverified. The “Requires IV?” diagnostic is conditional on a valid instrument. Notebook 06's SLX uses individual sales and sale-month prior-12-month own and neighbouring crime. Its quarterly Moran diagnostics aggregate transaction-level residuals to LSOA-quarter after fitting models with LSOA and year-quarter fixed effects on the same spatial sample. The IV and quarterly spatial appendix tables have copy buttons that provide a formatted table for Google Docs and tab-separated text for Google Sheets. Each build versions the JavaScript URL to prevent outdated cached scripts from breaking the updated page.

When an interaction regression is selected, the comparison table shows the crime main-effect beta at mean borough income immediately above the crime × income coefficient. The full regression view retains all coefficients and their inference.

## Automatic discovery

Run `python build_dashboard_data.py` locally, or push committed outputs to main and let GitHub Actions build it. The builder scans every `data/*outputs/` folder recursively for CSV and PNG/JPEG/WebP/GIF files. No filename registration is required. New folders, tables and figures appear automatically. Other formats, including compressed inputs, are not published.

CSV schemas determine comparison eligibility: model/crime/beta/N tables join the shared-model comparison; beta/N tables with method, quantile or specification fields get their own comparison family. Every CSV remains accessible with search, sorting, pagination and download even when its schema is unfamiliar. The gallery supports notebook/filename filters, enlargement and two-image comparison.

Generated assets live in `docs/generated/` and are rebuilt on deployment. Notebook execution is separate: rerun notebooks and commit their outputs. The displayed build timestamp is not proof of execution success or a historical run archive.

Positive estimates are green and negative estimates red. Full coefficient exports are available in All tables. Detailed main-model exports require a panel identifier to avoid presenting reduced summary exports as duplicate regressions.

## Rebuild the data

After rerunning the notebooks locally, commit the updated output CSVs and figures under `data/`. GitHub Actions rebuilds the dashboard automatically during deployment, so you do not need to run the builder manually.

Commit updated notebook 03–06 result CSVs too. Non-compressed data outputs are trackable; `.gz` files and the housing manifest are ignored.

## Enable GitHub Pages

The repository includes `.github/workflows/pages.yml`. In GitHub, set **Settings → Pages → Source** to **GitHub Actions**. Each push to `main` then publishes `docs/` automatically.
