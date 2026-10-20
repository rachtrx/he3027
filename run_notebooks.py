"""Run project notebooks with fresh kernels; save errors and stop on failure."""
import os
import sys
from pathlib import Path
import nbformat
from nbclient import NotebookClient
from jupyter_client import KernelManager
from jupyter_client.kernelspec import KernelSpec

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
os.environ.setdefault('MPLBACKEND', 'Agg')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')
FILES = ['crime_housing_project_analysis.ipynb', '01_crime_current_year.ipynb',
         '02_crime_previous_year.ipynb', '03_crime_mps.ipynb',
         '04_crime_iv_exploratory.ipynb', '05_crime_quantile.ipynb',
         '06_crime_spatial_autocorrelation.ipynb']
for filename in sys.argv[1:] or FILES:
    path = ROOT / filename
    nb = nbformat.read(path, as_version=4)
    for cell in nb.cells:
        if cell.cell_type == 'code':
            cell.outputs = []
            cell.execution_count = None
    nbformat.write(nb, path)
    km = KernelManager()
    km._kernel_spec = KernelSpec(argv=[sys.executable, '-m', 'ipykernel_launcher', '-f', '{connection_file}'], display_name='eda', language='python')
    def progress(cell, cell_index, **kwargs):
        if cell.cell_type == 'code':
            print(f'{filename}: cell {cell_index + 1}', flush=True)
    client = NotebookClient(nb, km=km, timeout=None, allow_errors=False,
                            resources={'metadata': {'path': str(ROOT)}},
                            on_cell_start=progress)
    print('START', filename, flush=True)
    try:
        client.execute()
        assert not any(o.output_type == 'error' for c in nb.cells if c.cell_type == 'code' for o in c.outputs)
    except BaseException:
        print('FAILED', filename, flush=True)
        raise
    finally:
        nbformat.write(nb, path)
        if km.has_kernel:
            km.shutdown_kernel(now=True)
    print('PASS', filename, flush=True)
