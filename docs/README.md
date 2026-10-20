# Regression comparison dashboard

## Automatic discovery

Run `python build_dashboard_data.py` locally, or push committed outputs to main and let GitHub Actions build it. The builder scans every `data/*outputs/` folder recursively for CSV and PNG/JPEG/WebP/GIF files. No filename registration is required. New folders, tables and figures appear automatically. Other formats, including compressed inputs, are not published.

CSV schemas determine comparison eligibility: model/crime/beta/N tables join the shared-model comparison; beta/N tables with method, quantile or specification fields get their own comparison family. Every CSV remains accessible with search, sorting, pagination and download even when its schema is unfamiliar. The gallery supports notebook/filename filters, enlargement and two-image comparison.

Generated assets live in `docs/generated/` and are rebuilt on deployment. Notebook execution is separate: rerun notebooks and commit their outputs. The displayed build timestamp is not proof of execution success or a historical run archive.

Positive estimates are green and negative estimates red. Full coefficient exports are available in All tables. Detailed main-model exports require a panel identifier to avoid presenting reduced summary exports as duplicate regressions.

## Rebuild the data

After rerunning the notebooks locally, commit the updated output CSVs and figures under `data/`. GitHub Actions rebuilds the dashboard automatically during deployment, so you do not need to run the builder manually.

Commit updated notebook 04–06 result CSVs too. Non-compressed data outputs are trackable; `.gz` files and the housing manifest are ignored.

## Enable GitHub Pages

The repository includes `.github/workflows/pages.yml`. In GitHub, set **Settings → Pages → Source** to **GitHub Actions**. Each push to `main` then publishes `docs/` automatically.
