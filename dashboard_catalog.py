"""Discover published notebook outputs; no per-file registration required."""
import csv
import hashlib
import json
import math
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEST = ROOT / 'docs' / 'generated'


def title(value):
    text = re.sub(r'^\d+[_ -]*', '', value).replace('_', ' ').replace('-', ' ').strip().capitalize()
    for acronym in ['iv', 'mps', 'ols', 'twfe', 'lsoa', 'msoa', 'csv']:
        text = re.sub(r'\b'+acronym+r'\b', acronym.upper(), text, flags=re.I)
    return text


def value(text):
    if text is None or text.strip() in ('', 'NaN', 'nan', 'NA'):
        return None
    if text.strip().lower() in ('true', 'false'):
        return text.strip().lower() == 'true'
    try:
        n = float(text)
        return n if math.isfinite(n) else None
    except ValueError:
        return text


def build():
    DEST.mkdir(parents=True, exist_ok=True)
    files, groups, families, diagnostics, coefficient_tables = [], [], [], [], []
    main = []
    # Only folders designated as notebook outputs are published.
    for folder in sorted((ROOT / 'data').glob('*outputs')):
        if not folder.is_dir():
            continue
        label = ('08 · Original Stata crime · restricted sale years' if folder.name == '08_crime_original_robustness_outputs'
                 else title(folder.name.removesuffix('_outputs')))
        group = {'id': folder.name, 'label': label, 'files': 0}
        groups.append(group)
        for path in sorted(folder.rglob('*')):
            if not path.is_file() or path.is_symlink() or path.suffix.lower() not in ('.csv', '.png', '.jpg', '.jpeg', '.webp', '.gif'):
                continue
            if folder.name == '04_crime_iv_outputs' and path.name not in {
                'temperature_m7_violent_prior12_thresholds.csv',
                'temperature_m7_threshold_violent_prior12_iv.png',
            }:
                continue
            relative = path.relative_to(ROOT / 'data')
            target = DEST / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            url = 'generated/' + relative.as_posix()
            item = dict(id=relative.as_posix(), group=folder.name, title=title(path.stem), url=url,
                        kind='table' if path.suffix.lower()=='.csv' else 'figure', size=path.stat().st_size)
            if item['kind'] == 'table':
                with path.open(encoding='utf-8-sig', newline='') as handle:
                    reader = csv.DictReader(handle)
                    columns = [c for c in (reader.fieldnames or []) if c and not c.startswith('Unnamed:')]
                    rows = [{c: value(r.get(c)) for c in columns} for r in reader]
                if path.stem == 'interaction_regressions':
                    aliases = {'beta': 'interaction_beta', 'se': 'interaction_se'}
                    for row in rows:
                        row.update({k: row.get(v) for k, v in aliases.items()})
                        row.setdefault('method', 'Crime × borough income')
                        row.setdefault('data_source', 'MPS')
                        row.setdefault('exposure', 'prior12')
                    columns = list(dict.fromkeys(columns + list(aliases) + ['method', 'data_source', 'exposure']))
                json_target = target.with_suffix('.json')
                json_target.write_text(json.dumps(dict(columns=columns, rows=rows), allow_nan=False), encoding='utf-8')
                item.update(columns=columns, rows=len(rows), json=url[:-4]+'.json')
                if {'variable', 'beta'} <= set(columns) and path.name != 'm7_crime_change_regressions.csv':
                    coefficient_tables.append(dict(group=folder.name, columns=columns, rows=rows, title=item['title']))
                # Identify statistical summaries by schema, not filename.
                robustness_summary = folder.name != '08_crime_original_robustness_outputs' or path.stem in {'combined_primary_models', 'combined_2012_2013_models'}
                if {'model','crime','beta','N','panel'} <= set(columns) and 'variable' not in columns and robustness_summary:
                    for row in rows:
                        key = json.dumps([folder.name,row],sort_keys=True)
                        main.append(dict(row, id=hashlib.sha256(key.encode()).hexdigest()[:20], source=group['label'], output=item['title'], _group=folder.name))
                elif folder.name == '04_crime_iv_outputs' and path.stem == 'temperature_m7_violent_prior12_thresholds':
                    focused = [dict(r, beta=r['iv_beta'], se=r['iv_se'], p=r['iv_p'],
                                    ci_low=r['iv_ci_low'], ci_high=r['iv_ci_high'],
                                    clusters=r['weather_cell_clusters'],
                                    first_stage_wald_F=r['first_stage_F_weather_cell'],
                                    method='2SLS', data_source='MPS') for r in rows]
                    families.append(dict(id=item['id'], label='M7 violent crime · prior 12 months · temperature IV',
                                         columns=list(dict.fromkeys(columns + ['beta', 'se', 'p', 'ci_low', 'ci_high',
                                                                              'clusters', 'first_stage_wald_F',
                                                                              'method', 'data_source'])),
                                         rows=[dict(r, id=str(i)) for i, r in enumerate(focused)]))
                    diagnostics.append(dict(title='Violent crime · prior 12 months · temperature IV',
                                            columns=columns, rows=focused))
                elif folder.name == '10_crime_mps_exposure_windows_outputs' and path.stem == 'm7_prior6_prior12_prior24_prior36_common_sample':
                    families.append(dict(id=item['id'], label='M7 MPS crime windows · common April 2013–2015 sales',
                                         columns=columns, rows=[dict(r,id=str(i)) for i,r in enumerate(rows)]))
                elif folder.name == '11_crime_mps_change_outputs' and path.stem == 'm7_crime_change_regressions':
                    selected = [dict(r, method='OLS', data_source='MPS',
                                     exposure_label=('Prior 12 months' if r['specification'] == 'recent_level'
                                                     else 'Year-on-year change'))
                                for r in rows if r['specification'] in {'recent_level', 'year_on_year_change'}]
                    families.append(dict(id=item['id'], label='M7 MPS crime level versus change · common sales',
                                         columns=list(dict.fromkeys(columns + ['method', 'data_source', 'exposure_label'])),
                                         rows=[dict(r, id=str(i)) for i, r in enumerate(selected)]))
                elif {'beta','N'} <= set(columns) and 'variable' not in columns and any(c in columns for c in ['method','quantile','specification']):
                    families.append(dict(id=item['id'], label=group['label']+' · '+item['title'], columns=columns,
                                         rows=[dict(r,id=str(i)) for i,r in enumerate(rows)]))
            files.append(item)
            group['files'] += 1
    # Some notebooks export both individual and combined summaries. Deduplicate these.
    unique = {r['id']: r for r in main}
    keys = ['panel', 'model', 'crime', 'exposure', 'specification', 'method', 'quantile', 'k']
    def attach_coefficients(regression, folder):
        matches = []
        for table_data in coefficient_tables:
            if table_data['group'] != folder:
                continue
            shared = [k for k in keys if k in regression and k in table_data['columns']]
            selected_rows = [row for row in table_data['rows'] if shared and all(row.get(k) == regression.get(k) for k in shared)]
            if selected_rows:
                matches.append((len(selected_rows), table_data, selected_rows))
        if matches:
            _, source_table, selected_rows = max(matches, key=lambda x: len(x[2]))
            regression['coefficients'] = selected_rows
            regression['coefficient_columns'] = source_table['columns']
            regression['coefficient_source'] = source_table['title']
    for family in families:
        folder = family['id'].split('/')[0]
        for regression in family['rows']:
            attach_coefficients(regression, folder)
    if unique:
        for regression in unique.values():
            attach_coefficients(regression, regression['_group'])
        families.insert(0,dict(id='main',label='Main regressions · shared model',rows=list(unique.values()),
                               columns=list(dict.fromkeys(k for r in unique.values() for k in r if k!='id'))))
    catalog = dict(built_at=datetime.now(timezone.utc).isoformat(),groups=groups,files=files,families=families,diagnostics=diagnostics)
    (DEST/'catalog.json').write_text(json.dumps(catalog,allow_nan=False),encoding='utf-8')
    script = ROOT / 'docs' / 'explorer.js'
    page = ROOT / 'docs' / 'index.html'
    if script.exists() and page.exists():
        version = hashlib.sha256(script.read_bytes()).hexdigest()[:16]
        html, count = re.subn(r'src="explorer\.js(?:\?[^\"]*)?"',
                              f'src="explorer.js?v={version}"', page.read_text(encoding='utf-8'))
        if count != 1:
            raise ValueError('Expected one explorer.js script reference')
        page.write_text(html, encoding='utf-8')
    print(f'Discovered {len(files)} outputs across {len(groups)} folders; {len(families)} comparison families.')


if __name__ == '__main__':
    build()
