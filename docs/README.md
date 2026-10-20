# Regression comparison dashboard

The dashboard is a static GitHub Pages site. It compares any two regressions at the same model number and displays the crime coefficient, clustered uncertainty, sample metadata, and aligned coefficient tables.

## Rebuild the data

After rerunning the notebooks locally, commit the ten small `primary_*` CSV summaries under `data/`. GitHub Actions rebuilds the dashboard automatically during deployment, so you do not need to run the builder manually.

The rest of `data/` remains ignored because it contains large analysis artifacts and raw inputs.

## Enable GitHub Pages

The repository includes `.github/workflows/pages.yml`. In GitHub, set **Settings → Pages → Source** to **GitHub Actions**. Each push to `main` then publishes `docs/` automatically.
