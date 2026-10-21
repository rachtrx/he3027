"""Adapt notebook 04 to the M2-M7 temperature IV sequence."""

from pathlib import Path
import nbformat as nb

ROOT = Path(__file__).resolve().parent
path = ROOT / "04_crime_iv_exploratory.ipynb"
n = nb.v4.new_notebook()
md = nb.v4.new_markdown_cell
code = nb.v4.new_code_cell
n.cells = [
    md("""# 04. Temperature IV diagnostics across M2–M7

This exploratory analysis repeats each MPS crime type (all, violent, property) and exposure (current year, previous year, prior 12 months) under M2–M7. Each of the 54 models uses the same complete MPS sale sample. The estimates include a first stage, reduced form, matched OLS, 2SLS, and a Wooldridge residual-inclusion test.

**Temperature is not a validated instrument.** The pilot uses [Open-Meteo historical reanalysis](https://open-meteo.com/en/docs/historical-weather-api) assigned to LSOAs using mean sale coordinates. Only 21 distinct returned weather locations cover the sample. Finer [HadUK-Grid data](https://catalogue.ceda.ac.uk/uuid/789b3065d74a4c948ab05d33556c86d0/) would require separate access. Heat can directly affect housing demand, comfort, energy costs, and sale timing. Current-year temperature includes months after some sales, which adds a timing problem."""),
    code("""from pathlib import Path
import sys
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from IPython.display import display
try:
    from google.colab import drive
except ImportError:
    ROOT = Path.cwd()
else:
    drive.mount('/content/drive')
    ROOT = Path('/content/drive/MyDrive/HE3027 Project')
sys.path.insert(0, str(ROOT))
OUT = ROOT/'data'/'04_crime_iv_outputs'
RESULT = OUT/'temperature_m2_m7_iv_pilot.csv'
REESTIMATE = False
if REESTIMATE or not RESULT.exists():
    import temperature_iv_sequence
    temperature_iv_sequence.main()
results = pd.read_csv(RESULT)
models = [f'M{i}' for i in range(2,8)]
crimes = ['allcrime','violentcrime','propertycrime']
timings = ['annual','lagyear','prior12']
timing_labels = {'annual':'Current year','lagyear':'Previous year','prior12':'Prior 12 months'}
crime_labels = {'allcrime':'All crime','violentcrime':'Violent crime','propertycrime':'Property crime'}
assert len(results)==54 and results[['model','crime','exposure']].drop_duplicates().shape[0]==54
display(results.groupby('model',sort=False).agg(rows=('crime','size'),N_min=('N','min'),N_max=('N','max'),weather_cells=('weather_cell_clusters','min')))"""),
    md("""## Model sequence and data

M2 has property controls; M3 adds transport, distance, and economic controls. M4 adds local-authority and year fixed effects; M5 uses MSOA and year; M6 uses MSOA and year-quarter; M7 uses LSOA and year-quarter. Job density is excluded to retain 2015. All models use complete observations for the full control set, so changes across models are not caused by changing N.

The instrument is the number of days reaching 25°C in each exposure window. Standard errors are clustered by the 21 returned weather cells. These cells can themselves share shocks; inference is approximate with so few weather clusters. The exported LSOA-clustered first-stage F provides a comparison, though LSOA clustering alone ignores common temperature within cells."""),
    code("""display(results.groupby('model',sort=False).first()[['controls','fixed_effects','N','lsoa_clusters','weather_cell_clusters']])
display(results[['model','crime','exposure','first_stage_beta_per_hot_day','first_stage_se_weather_cell','first_stage_F_weather_cell','first_stage_F_lsoa','partial_R2','reduced_form_beta_per_hot_day','reduced_form_p']].round(5))"""),
    md("""## First-stage relevance

The heatmap shows the squared weather-cell-clustered t statistic on temperature in each first stage. F ≥ 10 is only a rough relevance screen, not a claim of IV validity. Inspect the coefficient direction and partial R² as well. A first stage that fades after adding local and quarterly fixed effects has little usable variation for the preferred M7 specification."""),
    code("""fig,axes=plt.subplots(1,3,figsize=(16,4),sharey=True)
vmax=max(10,np.nanquantile(results.first_stage_F_weather_cell,.95))
for ax,t in zip(axes,timings):
    p=results.query('exposure==@t').pivot(index='crime',columns='model',values='first_stage_F_weather_cell').reindex(index=crimes,columns=models)
    im=ax.imshow(p.to_numpy(),cmap='YlOrRd',vmin=0,vmax=vmax,aspect='auto')
    for i in range(3):
        for j in range(6):
            v=p.iloc[i,j]
            ax.text(j,i,f'{v:.1f}',ha='center',va='center',fontsize=9,color='white' if v>vmax*.6 else 'black')
    ax.set_xticks(range(6),models); ax.set_yticks(range(3),[crime_labels[c] for c in crimes]); ax.set_title(timing_labels[t])
fig.suptitle('Temperature first stage, M2–M7')
fig.subplots_adjust(top=.82,bottom=.12,left=.09,right=.88,wspace=.12)
fig.colorbar(im,cax=fig.add_axes([.90,.18,.014,.60]),label='Weather-cell clustered Wald F')
fig.savefig(OUT/'temperature_first_stage_m2_m7.png',dpi=170,bbox_inches='tight'); plt.show()
display(results.pivot_table(index=['crime','exposure'],columns='model',values='partial_R2').round(5))"""),
    md("""## Matched OLS, 2SLS, and exogeneity

The Wooldridge residual-inclusion test's null is that crime is exogenous **conditional on a valid instrument**. A p value below .05 rejects that null within the assumed IV model. Non-rejection does not prove exogeneity. A weak first stage makes the 2SLS and endogeneity results unreliable. Neither a test rejection nor a strong first stage proves temperature's exclusion restriction.

The full CSV gives first-stage and reduced-form estimates, matched OLS and 2SLS coefficients with standard errors and approximate confidence intervals, and endogeneity statistics for every row."""),
    code("""display(results[['model','crime','exposure','N','first_stage_F_weather_cell','ols_beta','ols_se','ols_p','iv_beta','iv_se','iv_ci_low','iv_ci_high','iv_p','wooldridge_exogeneity_chi2','wooldridge_exogeneity_p']].round(5))
fig,axes=plt.subplots(1,3,figsize=(16,4),sharey=True)
for ax,t in zip(axes,timings):
    p=results.query('exposure==@t').pivot(index='crime',columns='model',values='wooldridge_exogeneity_p').reindex(index=crimes,columns=models)
    im=ax.imshow(p.to_numpy(),cmap='PuBu',vmin=0,vmax=1,aspect='auto')
    for i in range(3):
        for j in range(6):
            v=p.iloc[i,j]
            ax.text(j,i,f'{v:.3f}'+('*' if v<.05 else ''),ha='center',va='center',fontsize=8,color='white' if v>.65 else 'black')
    ax.set_xticks(range(6),models); ax.set_yticks(range(3),[crime_labels[c] for c in crimes]); ax.set_title(timing_labels[t])
fig.suptitle('Exogeneity tests (* p < .05; conditional on valid IV)')
fig.subplots_adjust(top=.82,bottom=.12,left=.09,right=.88,wspace=.12)
fig.colorbar(im,cax=fig.add_axes([.90,.18,.014,.60]),label='Wooldridge p value')
fig.savefig(OUT/'temperature_endogeneity_m2_m7.png',dpi=170,bbox_inches='tight'); plt.show()"""),
    md("""## Relevance screen and decision

The next table flags first stages with F ≥ 10. The “requires IV?” column reports whether the Wooldridge test rejects exogeneity at 5%, **conditional on a valid instrument**. It is not a recommendation to use temperature as an IV. The preferred main analysis remains M7; direct housing channels and shared spatial weather shocks still need investigation."""),
    code("""screen=results[['model','crime','exposure','N','first_stage_beta_per_hot_day','first_stage_F_weather_cell','partial_R2','wooldridge_exogeneity_p']].copy()
screen['F_at_least_10']=screen.first_stage_F_weather_cell.ge(10)
screen['requires_IV_if_valid_instrument']=np.where(screen.wooldridge_exogeneity_p.lt(.05),'Yes','No')
display(screen.round(5))
display(screen.groupby('model',sort=False).agg(F_at_least_10=('F_at_least_10','sum'),minimum_F=('first_stage_F_weather_cell','min'),maximum_F=('first_stage_F_weather_cell','max')).round(3))
print('Full results:',RESULT)
print('OLS and 2SLS:',OUT/'temperature_regressions.csv')
print('Endogeneity tests:',OUT/'temperature_endogeneity_tests.csv')"""),
]
n.metadata['kernelspec']={'display_name':'Python 3','language':'python','name':'python3'}
nb.write(n,path)
