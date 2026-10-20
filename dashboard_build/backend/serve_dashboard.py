"""Live Store Pending PR dashboard: serves the dashboard and pulls fresh data from SAP on demand.

Local PC:   Start_Live_Dashboard.bat  (asks for the SAP user and password, keeps them in memory only)
Cloud Run:  detected through the K_SERVICE variable; the SAP login comes from the SAP_USER and
            SAP_PASSWORD environment variables (mapped from Secret Manager), the port from PORT.

Browsers cannot call the SAP API directly (no CORS, and the password would sit in the page), so this
small server makes the call and hands the dashboard compact JSON.
"""
import argparse
import base64
import csv
import getpass
import gzip
import json
import os
import re
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pr_data import (CONSUME_FIELDS, CONSUME_MVTS, FIELDS, ISSUE_DATE_FILTER, ISSUE_FIELDS, ISSUE_FILTER, PO_DATE_FILTER, PO_FIELDS, PO_STATUS_FIELDS, STOCK_FIELDS, STOCK_ORDER,
                     MG_NAMES, PG_NAMES, USER_NAMES,
                     consume_fold, issue_compact, po_compact, stock_compact, to_compact)

HERE = os.path.dirname(os.path.abspath(__file__))  # backend/
FRONTEND = os.path.join(os.path.dirname(HERE), 'frontend')  # the pages and the logo
DATA = os.path.join(HERE, 'data')  # lookup files that are edited by hand (CSV / Excel)
TPL = os.path.join(FRONTEND, 'dashboard_template.html')
ISSUE_TPL = os.path.join(FRONTEND, 'issue_template.html')
PO_TPL = os.path.join(FRONTEND, 'po_template.html')
STOCK_TPL = os.path.join(FRONTEND, 'stock_template.html')
SUMMARY_TPL = os.path.join(FRONTEND, 'summary_template.html')
PO_APPROVAL_TPL = os.path.join(FRONTEND, 'po_approval_template.html')
LOGO = os.path.join(FRONTEND, 'logo.png')
# the look and the small helpers shared by every page (frontend/ui.css, frontend/ui.js)
STATIC = {'/ui.css': (os.path.join(FRONTEND, 'ui.css'), 'text/css; charset=utf-8'),
          '/ui.js': (os.path.join(FRONTEND, 'ui.js'), 'application/javascript; charset=utf-8')}
DEFAULT_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_STORE_PENDING_PR_CDS'
ISSUE_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_STORE_RESERVATION_CDS'
PO_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_PO_ITEM_SUPPLIER_CDS'
PO_STATUS_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_PO_ITEM_STATUS_CDS'
STOCK_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_STORE_STOCK_CDS'
# the view has a parameter (display currency); the result set is read through it
STOCK_ENTITY = "YY1_Store_Stock(P_DisplayCurrency='INR')/Results"
PR_QUERY = {'$select': ','.join(FIELDS), '$orderby': 'PurchaseRequisition,PurchaseRequisitionItem'}
# If SAP refuses the movement-type filter, the date-only query is used (issue_compact filters the movement
# types too). Every variant keeps the sort: unsorted paging skips and repeats rows.
_ORDER = 'MaterialDocumentYear,MaterialDocument,MaterialDocumentItem'
ISSUE_QUERY = [
    {'$select': ','.join(ISSUE_FIELDS), '$filter': ISSUE_FILTER, '$orderby': _ORDER},
    {'$select': ','.join(ISSUE_FIELDS), '$filter': ISSUE_DATE_FILTER, '$orderby': _ORDER},
]
# PO items: the key of the view is the sort, so the pages do not skip or repeat rows.
PO_QUERY = {'$select': ','.join(PO_FIELDS), '$filter': PO_DATE_FILTER, '$orderby': 'PurchaseOrder,PurchaseOrderItem'}
PO_STATUS_QUERY = {'$select': ','.join(PO_STATUS_FIELDS), '$orderby': 'PurchaseOrder,PurchaseOrderItem'}
STOCK_QUERY = {'$select': ','.join(STOCK_FIELDS), '$orderby': STOCK_ORDER}
# goods issues (stock out) since 1 Jan 2026, read together with the stock to find the last use of each material
CONSUME_QUERY = {'$select': ','.join(CONSUME_FIELDS), '$orderby': _ORDER,
                 '$filter': ISSUE_DATE_FILTER + " and DebitCreditCode eq 'H' and (" + ' or '.join(f"GoodsMovementType_1 eq '{m}'" for m in CONSUME_MVTS) + ')'}
DEFAULT_USER = 'POWERBI_USER_PRD'
PAGE = 5000
CLOUD = bool(os.environ.get('K_SERVICE'))
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'self'")


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def env_secret(name):
    # A secret saved from a Windows shell often ends in a newline; the SAP login must not.
    return (os.environ.get(name) or '').rstrip('\r\n')


# Local PC only: the SAP login is kept in Windows Credential Manager (encrypted for this Windows user),
# so it is typed once instead of on every start.
CRED_TARGET = 'MittalDashboard/SAP'
if os.name == 'nt':
    import ctypes
    from ctypes import wintypes as W

    class _Cred(ctypes.Structure):
        _fields_ = [('Flags', W.DWORD), ('Type', W.DWORD), ('TargetName', W.LPWSTR), ('Comment', W.LPWSTR),
                    ('LastWritten', W.FILETIME), ('CredentialBlobSize', W.DWORD),
                    ('CredentialBlob', ctypes.POINTER(ctypes.c_ubyte)), ('Persist', W.DWORD),
                    ('AttributeCount', W.DWORD), ('Attributes', ctypes.c_void_p), ('TargetAlias', W.LPWSTR),
                    ('UserName', W.LPWSTR)]
    _adv = ctypes.WinDLL('advapi32')


def saved_login():
    if os.name != 'nt':
        return None
    p = ctypes.POINTER(_Cred)()
    if not _adv.CredReadW(CRED_TARGET, 1, 0, ctypes.byref(p)):
        return None
    try:
        c = p.contents
        return c.UserName, ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize).decode('utf-16-le')
    finally:
        _adv.CredFree(p)


def save_login(user, password):
    if os.name != 'nt':
        return False
    blob = password.encode('utf-16-le')
    buf = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
    c = _Cred(Type=1, TargetName=CRED_TARGET, CredentialBlobSize=len(blob), Persist=2, UserName=user,
              CredentialBlob=ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    return bool(_adv.CredWriteW(ctypes.byref(c), 0))


def forget_login():
    if os.name == 'nt':
        _adv.CredDeleteW(CRED_TARGET, 1, 0)


class SapError(Exception):
    def __init__(self, msg, status=502):
        super().__init__(msg)
        self.status = status


class Folded:
    """Result of a fetch that was folded page by page: the rows themselves are not kept, only the state the fold built."""

    def __init__(self, state, n):
        self.state, self.n = state, n

    def __len__(self):
        return self.n


class Sap:
    """One CDS view: fetches every page of `query` and serves compact(rows) from a cache."""
    auth_failed = False  # shared by all views: after one 401 nothing calls SAP again, so bad logins cannot lock the user

    def __init__(self, base, entity, query, compact, user, password, ttl, min_refresh, extra=()):
        # query may be a list of variants, simplest last: the first one SAP accepts is kept.
        self.queries = query if isinstance(query, list) else [query]
        self.base, self.entity, self.compact = base.rstrip('/'), entity, compact
        # (base, entity, query[, fold[, optional]]) of views fetched together with this one; their rows are passed to compact after the main rows.
        # An optional one that fails is left out (compact then gets one argument less) instead of failing the whole view.
        self.extra = list(extra)
        token = base64.b64encode(f'{user}:{password}'.encode('utf-8')).decode('ascii')
        self._auth = 'Basic ' + token
        self.ttl, self.min_refresh = ttl, min_refresh
        self.busy = threading.Lock()  # held while an SAP fetch runs, so only one runs at a time
        self.cache = None          # (fetched_at, raw_json_bytes, gzipped_bytes)

    def _get(self, url):
        """One SAP call. A network hiccup (timeout, connection reset) or a 502 / 503 / 504 is tried again up to 3 times; the login and
        authorization errors are never retried (a wrong password must not be sent again and again)."""
        for attempt in range(3):
            try:
                return self._get_once(url)
            except SapError as e:
                if attempt < 2 and getattr(e, 'transient', False):
                    log(f'SAP did not answer ({e}); trying again in {2 * (attempt + 1)} s')
                    time.sleep(2 * (attempt + 1))
                    continue
                raise

    def _get_once(self, url):
        req = urllib.request.Request(url, headers={'Authorization': self._auth, 'Accept': 'application/json',
                                                   'Accept-Encoding': 'gzip'})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = resp.read()
                if resp.headers.get('Content-Encoding') == 'gzip':
                    body = gzip.decompress(body)
                return json.loads(body.decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code == 401:
                Sap.auth_failed = True
                raise SapError('SAP rejected the login (401). Fix the SAP user or password, then restart the dashboard (on Cloud Run: deploy a new revision).', 401)
            if e.code == 403:
                raise SapError('SAP user has no authorization for this view (403).', 403)
            body = e.read()
            if e.headers.get('Content-Encoding') == 'gzip':
                body = gzip.decompress(body)
            detail = re.search(r'"value"\s*:\s*"([^"]+)"', body.decode('utf-8', 'replace'))
            err = SapError(f'SAP returned HTTP {e.code}' + (f': {detail.group(1)}' if detail else '.'), 400 if e.code == 400 else 502)
            err.transient = e.code in (502, 503, 504)
            raise err
        except urllib.error.URLError as e:
            err = SapError(f'Could not reach SAP: {e.reason}')
            err.transient = True
            raise err
        except (TimeoutError, OSError) as e:
            err = SapError(f'Could not reach SAP: {e}')
            err.transient = True
            raise err

    def _fetch_rows(self, base=None, entity=None, queries=None, fold=None):
        # fold(state, rows) -> state, called page by page when given: for views with too many rows to keep in memory
        base, entity = (base or self.base).rstrip('/'), entity or self.entity
        queries = self.queries if queries is None else queries

        def url_of(q):
            return f'{base}/{entity}?' + urllib.parse.urlencode(q, quote_via=urllib.parse.quote, safe='$,')

        while True:
            q = {'$format': 'json', '$inlinecount': 'allpages', **queries[0], '$top': PAGE, '$skip': 0}
            try:
                d = self._get(url_of(q))['d']
                break
            except SapError as e:
                if e.status != 400 or len(queries) == 1:
                    raise
                log(f'{entity}: SAP refused a query ({e}); trying a simpler one')
                queries.pop(0)
        rows = d.get('results', [])
        total = int(d['__count']) if d.get('__count') is not None else None
        step, n = len(rows), len(rows)
        state = fold(None, rows) if fold else None
        if fold:
            rows = []
        if total is not None and step and total > step:
            # Total is known: ask for the remaining pages side by side instead of one after another.
            def page(skip):
                return self._get(url_of({**q, '$top': step, '$skip': skip}))['d'].get('results', [])
            with ThreadPoolExecutor(max_workers=4) as ex:
                for res in ex.map(page, range(step, total, step)):
                    if fold:
                        state, n = fold(state, res), n + len(res)
                    else:
                        rows += res
            return Folded(state, n) if fold else rows
        # Count missing: follow the pages one by one until SAP returns an empty page.
        res, url = d.get('results', []), d.get('__next')
        while url or (total is None and res):
            if not url:
                q['$skip'] = n
                url = url_of(q)
            d = self._get(url)['d']
            res = d.get('results', [])
            if fold:
                state, n = fold(state, res), n + len(res)
            else:
                rows += res
                n = len(rows)
            url = d.get('__next')
        return Folded(state, n) if fold else rows

    def _refresh(self):
        rows = self._fetch_rows()
        extra, used = [], []
        for x in self.extra:
            try:
                extra.append(self._fetch_rows(x[0], x[1], [x[2]], x[3] if len(x) > 3 else None))
                used.append(x)
            except SapError as e:
                if len(x) > 4 and x[4] and e.status not in (401, 403):
                    log(f'{x[1]} could not be read ({e}); {self.entity} is shown without it')
                    continue
                raise
        # Today's date in India: Cloud Run runs on UTC, which is still yesterday until 05:30 IST.
        asof_day = int((time.time() + 5.5 * 3600) // 86400)
        data = self.compact(rows, asof_day, *extra)
        data['fetchedAt'] = int(time.time() * 1000)
        raw = json.dumps(data, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        self.cache = (time.time(), raw, gzip.compress(raw, 6))
        log(f'fetched {len(rows):,} rows from SAP ({self.entity})' + ''.join(f' + {len(x):,} ({e})' for x, (_, e, *_) in zip(extra, used)))
        return self.cache[1], self.cache[2]

    def _refresh_in_background(self):
        try:
            self._refresh()
        except SapError as e:
            log(f'background refresh failed: {e}')
        except Exception as e:
            log(f'background refresh of {self.entity} failed: {e}\n{traceback.format_exc()}')
        finally:
            self.busy.release()

    def payload(self, force=False):
        """Returns (raw_json, gzipped_json).
        Fresh cache: returned as is. Older than the TTL: returned at once while SAP is asked again in the
        background, so nobody waits for SAP. Refresh button (force) or no data yet: waits for SAP."""
        if self.auth_failed:
            raise SapError('SAP login failed earlier. Fix the SAP user or password and restart the dashboard.', 401)
        c = self.cache
        if c and time.time() - c[0] < (self.min_refresh if force else self.ttl):
            return c[1], c[2]
        if c and not force:
            if self.busy.acquire(blocking=False):
                threading.Thread(target=self._refresh_in_background, daemon=True).start()
            return c[1], c[2]
        with self.busy:
            c = self.cache  # another request may have fetched while this one waited
            if c and time.time() - c[0] < self.min_refresh:
                return c[1], c[2]
            return self._refresh()


# Approver of a purchase order that is In Approval. SAP's OData views do not carry it, so it comes from a list that is
# exported from the Manage Purchase Orders app (Status = In Approval, Export to Excel) and saved as po_approvers.xlsx (or .csv)
# in backend/data. It is read again on every request, so a new export shows without a restart. Local PC only: the file is not
# packed into the Cloud Run image.
APPROVER_FILES = [os.path.join(DATA, 'po_approvers.xlsx'), os.path.join(DATA, 'po_approvers.csv')]


def _table_rows(path):
    if path.endswith('.csv'):
        with open(path, newline='', encoding='utf-8-sig') as f:
            return [list(r) for r in csv.reader(f)]
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        return [list(r) for r in wb.worksheets[0].iter_rows(values_only=True)]
    finally:
        wb.close()


def load_approvers():
    """{'file': name, 'savedAt': ms, 'approvers': {PO number: approver name}} from the first approver file found."""
    for path in APPROVER_FILES:
        if not os.path.exists(path):
            continue
        try:
            rows = _table_rows(path)
            head = next((i for i, r in enumerate(rows[:15]) if any('approver' in str(c or '').lower() for c in r)
                         and any(str(c or '').strip().lower().startswith('purchase order') for c in r)), None)
            if head is None:
                log(f'{os.path.basename(path)}: no header row with "Purchase Order" and "Approver"')
                continue
            h = [str(c or '').strip().lower() for c in rows[head]]
            c_po = next(i for i, x in enumerate(h) if x.startswith('purchase order'))
            c_ap = next(i for i, x in enumerate(h) if 'approver' in x)
            c_st = next((i for i, x in enumerate(h) if x in ('status', 'approval status')), None)
            out = {}
            for r in rows[head + 1:]:
                m = re.search(r'(?<!\d)(\d{10})(?!\d)', str(r[c_po] if c_po < len(r) else ''))
                ap = str(r[c_ap] if c_ap < len(r) and r[c_ap] is not None else '').strip()
                st = str(r[c_st] if c_st is not None and c_st < len(r) and r[c_st] is not None else '').lower()
                if m and ap and (not st or 'approval' in st):
                    out[m.group(1)] = ap
            return {'file': os.path.basename(path), 'savedAt': int(os.path.getmtime(path) * 1000), 'approvers': out}
        except Exception as e:  # a bad export must not break the page
            log(f'{os.path.basename(path)}: could not be read ({e})')
    return {'file': '', 'savedAt': 0, 'approvers': {}}


# Likely approver by purchasing organisation + purchasing group, optionally a net value band (po_approver_rules.csv: Purchasing org,
# Purchasing group, Min value (INR), Max value (INR), Approver, Basis). The approval is decided by SAP's workflow, which the dashboard cannot read; this is a pattern seen on
# POs whose approver is known, shown on the page as "likely", never as confirmed.
RULES_FILE = os.path.join(DATA, 'po_approver_rules.csv')


def load_rules():
    """Rules from po_approver_rules.csv as a list: org, group, min / max net value in INR (None = no limit), approver, basis."""
    out = []

    def num(x):
        x = (x or '').strip().replace(',', '')
        return float(x) if x else None
    try:
        with open(RULES_FILE, newline='', encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                org, pg, ap = (r.get('Purchasing org') or '').strip(), (r.get('Purchasing group') or '').strip(), (r.get('Approver') or '').strip()
                if org and pg and ap:
                    out.append({'org': org, 'pg': pg, 'min': num(r.get('Min value (INR)')), 'max': num(r.get('Max value (INR)')), 'approver': ap,
                                'basis': (r.get('Basis') or '').strip()})
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f'po_approver_rules.csv could not be read ({e})')
    return out


# The storage locations the Store Stock page covers: stock_locations.csv (Plant, Storage location, Name, Type). Stock in any other location is left out.
# Type is "Internal Plant material" for the in-process (I/P) stores and "Store" for the others (a blank type counts as Store).
# The file is read again at every refresh from SAP, so a location added to it shows up at the next refresh (the Refresh button reads SAP at once).
STOCK_LOCATIONS_FILE = os.path.join(DATA, 'stock_locations.csv')


def load_stock_locations():
    """{(plant, storage location): (type, name)} from stock_locations.csv, or None (= every location) when the file is missing or has no rows."""
    out = {}
    try:
        with open(STOCK_LOCATIONS_FILE, newline='', encoding='utf-8-sig') as f:
            for r in csv.reader(f):
                if len(r) >= 2 and r[0].strip() and r[1].strip() and r[0].strip().lower() != 'plant':
                    out[(r[0].strip(), r[1].strip())] = ((r[3].strip() if len(r) > 3 else '') or 'Store', r[2].strip() if len(r) > 2 else '')
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f'stock_locations.csv could not be read ({e})')
    return out or None


def stock_view(rows, asof_day, *extra):
    return stock_compact(rows, asof_day, load_stock_locations(), extra[0].state if extra else None)


PAGES = {'/': TPL, '/index.html': TPL, '/issue': ISSUE_TPL, '/po': PO_TPL, '/po-approval': PO_APPROVAL_TPL, '/stock': STOCK_TPL, '/summary': SUMMARY_TPL}
# User ID -> full name, put into the page like the data (no '<' in names, so it is safe inside a script tag).
USERS_JSON = json.dumps(USER_NAMES, ensure_ascii=False, separators=(',', ':'))
PGS_JSON = json.dumps(PG_NAMES, ensure_ascii=False, separators=(',', ':'))
MGS_JSON = json.dumps(MG_NAMES, ensure_ascii=False, separators=(',', ':'))


def make_handler(apis):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype, gz=None, cache='no-store'):
            wants_gz = 'gzip' in self.headers.get('Accept-Encoding', '')
            if wants_gz and gz is None and len(body) > 1024:
                gz = gzip.compress(body, 6)
            if wants_gz and gz is not None:
                body = gz
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            if wants_gz and gz is not None:
                self.send_header('Content-Encoding', 'gzip')
            self.send_header('Vary', 'Accept-Encoding')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', cache)
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            # the pages are self-contained (inline script and style, the logo, calls to this server only)
            self.send_header('Content-Security-Policy', CSP)
            self.send_header('X-Frame-Options', 'SAMEORIGIN')
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            if u.path == '/healthz':
                return self._send(200, b'ok', 'text/plain')
            if u.path in PAGES:
                html = open(PAGES[u.path], encoding='utf-8').read().replace('__DATA__', 'null').replace('__USERS__', USERS_JSON).replace('__PGS__', PGS_JSON).replace('__MGS__', MGS_JSON)
                return self._send(200, html.encode('utf-8'), 'text/html; charset=utf-8')
            if u.path in STATIC:
                path, ctype = STATIC[u.path]
                with open(path, 'rb') as f:
                    return self._send(200, f.read(), ctype, cache='no-cache')
            if u.path == '/logo.png':
                with open(LOGO, 'rb') as f:
                    return self._send(200, f.read(), 'image/png', cache='public, max-age=86400')
            if u.path == '/api/po-approvers':
                return self._send(200, json.dumps({**load_approvers(), 'rules': load_rules()}, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')
            if u.path in apis:
                force = 'refresh' in urllib.parse.parse_qs(u.query)
                try:
                    raw, gz = apis[u.path].payload(force)
                    return self._send(200, raw, 'application/json; charset=utf-8', gz)
                except SapError as e:
                    log(str(e))
                    body = json.dumps({'error': str(e)}).encode('utf-8')
                    return self._send(e.status, body, 'application/json; charset=utf-8')
                except Exception as e:  # a bug in a compact function must come back as a message, not as a dropped connection
                    log(f'{u.path} failed: {e}\n{traceback.format_exc()}')
                    body = json.dumps({'error': f'The server could not prepare this data ({type(e).__name__}). See its window for details.'}).encode('utf-8')
                    return self._send(500, body, 'application/json; charset=utf-8')
            self._send(404, b'Not found', 'text/plain')
    return H


class _Srv6(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=int(os.environ.get('PORT', 8765)))
    ap.add_argument('--lan', action='store_true', help='local PC only: let other PCs on the network open the dashboard (no login)')
    ap.add_argument('--base-url', default=os.environ.get('SAP_BASE_URL', DEFAULT_BASE))
    ap.add_argument('--ttl', type=int, default=int(os.environ.get('CACHE_TTL', 300)), help='seconds to reuse fetched data before asking SAP again (default 300)')
    ap.add_argument('--no-browser', action='store_true')
    args = ap.parse_args()

    user, password = env_secret('SAP_USER'), env_secret('SAP_PASSWORD')
    if CLOUD:
        if not user or not password:
            log('SAP_USER and SAP_PASSWORD are not set. Map the Secret Manager secrets to these variables (see GCP_DEPLOY.md).')
            sys.exit(1)
    saved = None
    if not CLOUD and not (user and password):
        saved = saved_login()
        if saved:
            user, password = saved
            print(f'Using the saved SAP login for {user}.')
    if not CLOUD and not (user and password):
        # Enter alone takes the usual user, so a typo in the name cannot cost a failed login.
        user = user or input(f'SAP user (press Enter for {DEFAULT_USER}): ').strip() or DEFAULT_USER
        # A pasted password often carries a stray space or newline.
        password = password or getpass.getpass('SAP password (typing is hidden): ').strip()
    typed = (user, password) if not CLOUD and not saved else None
    sap = Sap(args.base_url, 'YY1_Store_Pending_PR', PR_QUERY, to_compact, user, password, args.ttl, min_refresh=30)
    # Issue data is ~10x bigger and changes slowly, so it is refreshed every 30 minutes at most.
    issue = Sap(ISSUE_BASE, 'YY1_Store_Reservation', ISSUE_QUERY, issue_compact, user, password,
                max(args.ttl, 1800), min_refresh=300)
    # PO items: about 66,000 lines since 1 Jan 2026, so the same 30 minute refresh as the issue data.
    po = Sap(PO_BASE, 'YY1_PO_ITEM_SUPPLIER', PO_QUERY, po_compact, user, password, max(args.ttl, 1800), min_refresh=300,
             extra=[(PO_STATUS_BASE, 'YY1_PO_ITEM_STATUS', PO_STATUS_QUERY)])
    # Store stock: about 27,000 rows from SAP of which about 5,000 hold stock; same 30 minute refresh as the other big views.
    stock = Sap(STOCK_BASE, STOCK_ENTITY, STOCK_QUERY, stock_view, user, password, max(args.ttl, 1800), min_refresh=300,
                extra=[(ISSUE_BASE, 'YY1_Store_Reservation', CONSUME_QUERY, consume_fold, True)])
    apis = {'/api/pr': sap, '/api/issue': issue, '/api/po': po, '/api/stock': stock}
    del password

    if CLOUD:
        # Listen right away so Cloud Run sees a healthy container; the first dashboard visit loads the data.
        host = '0.0.0.0'
    else:
        print('Checking SAP login and loading data ...')
        try:
            sap.payload()
        except SapError as e:
            print('\nStopped:', e)
            if saved and e.status == 401:
                forget_login()  # never retry a rejected password on its own; the next start asks again
                print('The saved password was removed. Start the dashboard again and type the current password.')
            sys.exit(1)
        if typed and not os.environ.get('SAP_PASSWORD') and save_login(*typed):
            print('Login saved in Windows Credential Manager. Next time the dashboard starts without asking.')
        typed = None
        # Warm the big issue and PO data in the background (one after the other) so those pages open quickly.
        def warm():
            for view in (issue, po, stock):
                try:
                    view.payload()
                except SapError as e:
                    log(f'{view.entity} data not loaded: {e}')
        threading.Thread(target=warm, daemon=True).start()
        host = '0.0.0.0' if args.lan else '127.0.0.1'

    # On Windows, address reuse lets a second copy bind the same port while the old one keeps answering.
    ThreadingHTTPServer.allow_reuse_address = os.name != 'nt'
    srv = ThreadingHTTPServer((host, args.port), make_handler(apis))
    if not CLOUD:
        # "localhost" tries the IPv6 address ::1 first; if nothing listens there Windows waits about 2 seconds before it uses IPv4, on every new connection
        try:
            srv6 = _Srv6(('::1', args.port), make_handler(apis))
            threading.Thread(target=srv6.serve_forever, daemon=True).start()
        except OSError as e:
            log(f'IPv6 loopback not available ({e}); use http://127.0.0.1:{args.port}/ if localhost is slow')
    if CLOUD:
        log(f'Dashboard listening on port {args.port}')
    else:
        url = f'http://localhost:{args.port}/'
        print(f'\nLive dashboard running at {url}')
        if args.lan:
            print('LAN mode: other PCs can open http://<this-pc-ip>:%d/ and will see the data without a login.' % args.port)
        print('Close this window (or press Ctrl+C) to stop.')
        if not args.no_browser:
            webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
