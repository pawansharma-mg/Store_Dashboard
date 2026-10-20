"""Data and server checks for a running dashboard: what is still missing in the lookup tables, and does everything answer.

Run it while the dashboard is running (Start_Live_Dashboard.bat):   python check_data.py [--url http://127.0.0.1:8765]
It reads the same /api/* data as the pages and prints what needs attention (names that are not in pr_data.py, POs without an approver,
issue lines without a department, stock locations that SAP does not know ...). Exit code 1 when a page or an API fails.
"""
import argparse
import collections
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pr_data import MG_NAMES, PG_NAMES, USER_NAMES, ISSUE_USER_DEPT  # noqa: E402

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('--url', default='http://127.0.0.1:8765')
args = ap.parse_args()
BASE = args.url.rstrip('/')
fails, notes = [], []


def get(path, want_json=True):
    req = urllib.request.Request(BASE + path, headers={'Accept-Encoding': 'gzip'})
    t = time.time()
    with urllib.request.urlopen(req, timeout=300) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
        return (json.loads(raw) if want_json else raw.decode('utf-8')), time.time() - t, r.headers


def show(title, items, limit=12):
    print(f'\n{title}: {len(items)}')
    for x in list(items)[:limit]:
        print('   ', x)
    if len(items) > limit:
        print(f'    ... and {len(items) - limit} more')


print(f'Checking {BASE}')
# ---- pages and APIs answer, placeholders are filled
for p in ('/', '/summary', '/issue', '/po', '/po-approval', '/stock'):
    try:
        html, dt, h = get(p, False)
        left = [x for x in ('__USERS__', '__PGS__', '__MGS__', '__DATA__') if x in html and x != '__DATA__']
        status = 'ok' if not left else f'placeholders left: {left}'
        if left:
            fails.append(p)
        print(f'page {p:14} {status}  ({dt * 1000:.0f} ms)')
    except Exception as e:
        fails.append(p)
        print(f'page {p:14} FAILED: {e}')
D = {}
for k, p in (('pr', '/api/pr'), ('issue', '/api/issue'), ('po', '/api/po'), ('stock', '/api/stock'), ('ap', '/api/po-approvers')):
    try:
        D[k], dt, h = get(p)
        print(f'api  {p:18} ok  ({dt:.1f} s)' + (f'  rows {len(D[k]["rows"]):,}' if 'rows' in D[k] else ''))
    except Exception as e:
        fails.append(p)
        print(f'api  {p:18} FAILED: {e}')

# ---- names that are not in the lookup tables
if 'pr' in D and 'po' in D:
    codes = collections.Counter()
    for a in D['pr']['rows']:
        codes[D['pr']['pgs'][a[4]]] += 1
    for a in D['po']['rows']:
        codes[D['po']['pgs'][a[19]]] += 1
    show('purchasing groups without a name (PG_NAMES)', [f'{c} ({n} lines)' for c, n in codes.most_common() if c and c not in PG_NAMES and c != '(blank)'])
    blank = codes.get('(blank)', 0) + codes.get('', 0)
    if blank:
        notes.append(f'{blank:,} PR/PO lines have no purchasing group in SAP')
if 'po' in D or 'stock' in D:
    mg = collections.Counter()
    if 'po' in D:
        for a in D['po']['rows']:
            mg[D['po']['groups'][a[10]]] += 1
    if 'stock' in D:
        for a in D['stock']['rows']:
            mg[D['stock']['groups'][a[3]]] += 1
    show('material groups without a name (MG_NAMES)', [f'{c} ({n} lines)' for c, n in mg.most_common() if c and c != '(blank)' and c not in MG_NAMES])
users = collections.Counter()
if 'pr' in D:
    for a in D['pr']['rows']:
        users[D['pr']['users'][a[16]]] += 1
if 'issue' in D:
    for a in D['issue']['rows']:
        users[D['issue']['users'][a[9]]] += 1
        if len(a) > 12 and a[12] is not None:
            users[D['issue']['users'][a[12]]] += 1
if 'po' in D:
    for a in D['po']['rows']:
        users[D['po']['users'][a[12]]] += 1
show('user IDs without a name (USER_NAMES)', [f'{u!r} ({n} lines)' for u, n in users.most_common() if u and u not in USER_NAMES])

# ---- Store Issue
if 'issue' in D:
    d = D['issue']
    un = sum(1 for a in d['rows'] if d['depts'][a[13]] == 'Unassigned')
    res = collections.Counter(d['users'][a[12]] for a in d['rows'] if len(a) > 12 and a[12] is not None and d['users'][a[12]])
    show('reservation creators without a department in ISSUE_USER_DEPT', [f'{USER_NAMES.get(u, [u])[0]} {u} ({n} lines)' for u, n in res.most_common() if u not in ISSUE_USER_DEPT])
    print(f'\nStore Issue lines with department Unassigned: {un:,} of {len(d["rows"]):,}')
    if un:
        notes.append(f'{un:,} Store Issue lines have no department')

# ---- PO approval
if 'po' in D and 'ap' in D:
    AP, RULES = D['ap']['approvers'], D['ap']['rules']
    d = D['po']
    pos = {}
    for a in d['rows']:
        if not (a[18] & 1) and a[2] not in AP:
            continue
        p = pos.setdefault(a[2], {'org': d['orgs'][a[20]], 'pg': d['pgs'][a[19]], 'proc': d['procs'][a[21]], 'amt': 0.0, 'fx': False})
        if d['curs'][a[14]] == 'INR':
            p['amt'] += a[17]
        else:
            p['fx'] = True
    pend = {n: p for n, p in pos.items() if p['proc'] == '03' or n in AP}

    def rule(p):
        for r in RULES:
            if r['org'] != p['org'] or r['pg'] != p['pg']:
                continue
            if (r['min'] is not None or r['max'] is not None) and p['fx']:
                continue
            if r['min'] is not None and not p['amt'] >= r['min']:
                continue
            if r['max'] is not None and not p['amt'] < r['max']:
                continue
            return r
        return None
    nobody = [f'PO {n}  org {p["org"]} / group {p["pg"]} ({PG_NAMES.get(p["pg"], "?")})  Rs {p["amt"]:,.0f}' for n, p in pend.items() if n not in AP and not rule(p)]
    show(f'POs In Approval ({len(pend)}) without a confirmed or likely approver', nobody)
    print(f'   confirmed {sum(1 for n in pend if n in AP)}, likely (rule) {sum(1 for n, p in pend.items() if n not in AP and rule(p))}')

# ---- Store Stock
if 'stock' in D:
    d = D['stock']
    rows = d['rows']
    seen = {(d['plants'][a[1]], d['slocs'][a[2]][0]) for a in rows}
    listed = d.get('listed') or []
    missing = [f'{p} {c} {n}' for p, c, n, k in listed if (p, c) not in seen]
    print(f'\nStock: {len(rows):,} lines, {len(seen)} locations with stock of {len(listed)} listed ({len(missing)} listed locations hold no stock)')
    noval = sum(1 for a in rows if a[8] > 0 and a[9] == 0)
    neg = sum(1 for a in rows if a[8] < 0 or a[9] < 0)
    print(f'   lines with quantity but no value: {noval}; lines with negative quantity or value: {neg}')
    age = (time.time() * 1000 - d.get('fetchedAt', 0)) / 60000
    print(f'   data age: {age:.0f} minutes; goods issues read: {d.get("issuesRead")}')

print('\nNotes:')
for n in notes or ['none']:
    print('   -', n)
print('\nResult:', 'FAILED: ' + ', '.join(fails) if fails else 'every page and API answers')
sys.exit(1 if fails else 0)
