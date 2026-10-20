# Final HE3027 notebook workflow

Run these notebooks in order, using **Run all** in each:

1. [crime_housing_project_analysis.ipynb](crime_housing_project_analysis.ipynb): original-data exploration, monthly-source audit, geographical checks, annual/previous-year/prior12 construction, and export to `data/crime_housing_merged.csv.gz`.
2. [01_crime_current_year.ipynb](01_crime_current_year.ipynb): original current-calendar-year crime in every crime model.
3. [02_crime_previous_year.ipynb](02_crime_previous_year.ipynb): original previous-calendar-year crime in every crime model, including M6 and M7.
4. [03_crime_mps.ipynb](03_crime_mps.ipynb): reconstructed MPS current-year, previous-year, and prior12 panels, each with the full M1-M7 sequence.
5. Optional IV extension: [04_crime_iv_exploratory.ipynb](04_crime_iv_exploratory.ipynb) uses business/community burglary as an exploratory instrument for residential burglary. It reads the audit export and original monthly source, displays 60 first-stage/reduced-form/OLS-or-TWFE/2SLS regressions, includes weak-IV diagnostics, and saves outputs in `data/04_crime_iv_outputs/`. Instrument validity is not established; read its exclusion-restriction discussion before interpreting results as causal.
6. [05_crime_quantile.ipynb](05_crime_quantile.ipynb): exploratory conditional quantiles using a reproducible 6,000-sale MPS prior12 sample, directly included borough/quarter indicators, clustered bootstrap intervals and a matched OLS benchmark. Increase `MAX_SALES` and `BOOTSTRAP_REPS` for final inference. Ordinary TWFE demeaning is not used for quantile regression.
7. [06_crime_spatial_autocorrelation.ipynb](06_crime_spatial_autocorrelation.ipynb): representative LSOA sale-location coordinates, great-circle distances, 4/8/12-neighbour weights, Moran diagnostics and area-year SLX regressions. Coordinates are not official centroids. Spatial dependence and crime endogeneity remain substantive limitations.

Notebooks 05 and 06 can each run directly after the audit; they do not require the other regression notebooks to execute. Their outputs are saved in the corresponding `data/05_crime_quantile_outputs/` and `data/06_crime_spatial_outputs/` folders. They adapt ideas from the cited paper rather than claiming exact replication or guaranteed causal identification.

In Colab, the project folder is `/content/drive/MyDrive/HE3027 Project`; put both original input files directly in its `data/` folder. Locally, the audit also accepts inputs in `project_data/` or the project root. All merged files, charts and result tables go in `data/`. Analysis notebooks need only the audit's merged file and manifest, not the raw sources.

Each notebook is self-contained. Analysis helpers are included rather than requiring a separate Python module to upload. Existing versions were retained in `notebook_backups/`.

## Final model numbering

M1: property only. M2: add crime. M3: add location and economic controls. M4: add local-authority and year effects. M5: replace local-authority with MSOA effects. M6: replace year with year-quarter effects. M7: replace MSOA with LSOA effects. This numbering supersedes earlier reconciled models and separates the addition of controls from the addition of fixed effects.

The primary panels omit job density to retain 2015 and include pay, hours and unemployment. Set `RUN_STRICT = True` in an analysis notebook to add a separately reported panel with job density. Current-year and previous-year original panels share the same sales; all three MPS exposures share the same sales. Original and MPS panels have different coverage and should not be compared as a pure timing experiment.

Recorded zero is retained. Missing is not converted to zero. Original violence is all zero in 2014-2015 and endpoint all-crime counts are anomalously low; original-source results require caution. MPS categories are not assumed identical to the original definitions.

Every estimated specification is saved, with LSOA-clustered confidence intervals, individual control coefficients and coefficient-path figures. Estimating a negative association is not a criterion for selecting a model.
