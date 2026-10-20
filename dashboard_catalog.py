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
    files, groups, families, diagnostics = [], [], [], []
    main = []
    # Only folders designated as notebook outputs are published.
    for folder in sorted((ROOT / 'data').glob('*outputs')):
        if not folder.is_dir():
            continue
        group = {'id': folder.name, 'label': title(folder.name.removesuffix('_outputs')), 'files': 0}
        groups.append(group)
        for path in sorted(folder.rglob('*')):
            if not path.is_file() or path.is_symlink() or path.suffix.lower() not in ('.csv', '.png', '.jpg', '.jpeg', '.webp', '.gif'):
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
                json_target = target.with_suffix('.json')
                json_target.write_text(json.dumps(dict(columns=columns, rows=rows), allow_nan=False), encoding='utf-8')
                item.update(columns=columns, rows=len(rows), json=url[:-4]+'.json')
                if {'clustered_wooldridge_chi2', 'clustered_wooldridge_p', 'classical_wu_hausman_p'} <= set(columns):
                    diagnostics.append(dict(title=group['label'] + ' · Endogeneity tests', columns=columns, rows=rows))
                # Identify statistical summaries by schema, not filename.
                if {'model','crime','beta','N','panel'} <= set(columns) and 'variable' not in columns:
                    for row in rows:
                        key = json.dumps([folder.name,row],sort_keys=True)
                        main.append(dict(row, id=hashlib.sha256(key.encode()).hexdigest()[:20], source=group['label'], output=item['title']))
                elif {'beta','N'} <= set(columns) and 'variable' not in columns and any(c in columns for c in ['method','quantile','specification']):
                    families.append(dict(id=item['id'], label=group['label']+' · '+item['title'], columns=columns,
                                         rows=[dict(r,id=str(i)) for i,r in enumerate(rows)]))
            files.append(item)
            group['files'] += 1
    # Some notebooks export both individual and combined summaries. Deduplicate these.
    unique = {r['id']: r for r in main}
    if unique:
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
