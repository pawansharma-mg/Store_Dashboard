"""Build a static Store_Pending_PR_Dashboard.html from a saved YY1_Store_Pending_PR.json (offline copy).

For live data straight from SAP use Start_Live_Dashboard.bat instead (serve_dashboard.py).
Usage:  python build_dashboard.py
"""
import json
import os
from datetime import datetime

from pr_data import to_compact

HERE = os.path.dirname(os.path.abspath(__file__))  # dashboard_build/backend
APP = os.path.dirname(HERE)  # dashboard_build
ROOT = os.path.dirname(APP)  # project folder: the saved JSON is read from and the HTML is written to it
SRC = os.path.join(ROOT, 'YY1_Store_Pending_PR.json')
TPL = os.path.join(APP, 'frontend', 'dashboard_template.html')
OUT = os.path.join(ROOT, 'Store_Pending_PR_Dashboard.html')

rows = json.load(open(SRC, encoding='utf-8'))['d']['results']
asof = datetime.fromtimestamp(os.path.getmtime(SRC)).date()
asof_day = (asof - datetime(1970, 1, 1).date()).days

blob = json.dumps(to_compact(rows, asof_day), separators=(',', ':'), ensure_ascii=False).replace('</', '<\\/')
html = open(TPL, encoding='utf-8').read().replace('__DATA__', blob)
open(OUT, 'w', encoding='utf-8').write(html)
print(f'{len(rows)} rows, as of {asof}, wrote {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB)')
