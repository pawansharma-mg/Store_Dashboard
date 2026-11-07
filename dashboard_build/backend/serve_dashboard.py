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
import datetime as _dt
import gzip
import hashlib
import json
import os
import pickle
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

from pr_data import (EXCLUDE_LOCATIONS, EXCLUDE_PLANTS, po_split, po_rm_suppliers, row_is_rm, rm_material, AGEING_FIELDS, AGEING_FILTER, APPROVAL_FIELDS, ASSET_FIELDS, ASSET_FILTER, CONSUME_FIELDS, CONSUME_MVTS, FIELDS, INVOICE_FIELDS, INVOICE_FILTER, ISSUE_DATE_FILTER, ISSUE_FIELDS, ISSUE_FILTER, PURCHASE_FIELDS, PURCHASE_FILTER, PO_DATE_FILTER, PO_FIELDS, PO_STATUS_FIELDS, STOCK_FIELDS, STOCK_ORDER,
                     MG_NAMES, PG_NAMES, USER_NAMES,
                     ageing_compact, approval_compact, asset_compact, consume_fold, move_fold, moves_compact, MOVE_FIELDS, MOVE_FROM, invoice_compact, issue_compact, po_compact, purchase_compact, stock_compact, to_compact)

HERE = os.path.dirname(os.path.abspath(__file__))  # backend/
FRONTEND = os.path.join(os.path.dirname(HERE), 'frontend')  # the pages and the logo
DATA = os.path.join(HERE, 'data')  # lookup files that are edited by hand (CSV / Excel)
TPL = os.path.join(FRONTEND, 'dashboard_template.html')
ISSUE_TPL = os.path.join(FRONTEND, 'issue_template.html')
PO_TPL = os.path.join(FRONTEND, 'po_template.html')
STOCK_TPL = os.path.join(FRONTEND, 'stock_template.html')
SUMMARY_TPL = os.path.join(FRONTEND, 'summary_template.html')
PURCHASE_TPL = os.path.join(FRONTEND, 'purchase_template.html')
INVOICE_TPL = os.path.join(FRONTEND, 'invoice_template.html')
AGEING_TPL = os.path.join(FRONTEND, 'ageing_template.html')
ASSET_TPL = os.path.join(FRONTEND, 'asset_template.html')
PRICE_TPL = os.path.join(FRONTEND, 'price_template.html')
VENDOR_TPL = os.path.join(FRONTEND, 'vendor_template.html')
PO_APPROVAL_TPL = os.path.join(FRONTEND, 'po_approval_template.html')
LOGO = os.path.join(FRONTEND, 'logo.png')
# the look and the small helpers shared by every page (frontend/ui.css, frontend/ui.js)
STATIC = {'/ui.css': (os.path.join(FRONTEND, 'ui.css'), 'text/css; charset=utf-8'),
          '/ui.js': (os.path.join(FRONTEND, 'ui.js'), 'application/javascript; charset=utf-8'),
          '/live.js': (os.path.join(FRONTEND, 'live.js'), 'application/javascript; charset=utf-8'),
          '/pricevar.js': (os.path.join(FRONTEND, 'pricevar.js'), 'application/javascript; charset=utf-8')}
DEFAULT_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_STORE_PENDING_PR_CDS'
ISSUE_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_STORE_RESERVATION_CDS'
PO_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_PO_ITEM_SUPPLIER_CDS'
PO_STATUS_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_PO_ITEM_STATUS_CDS'
STOCK_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_STORE_STOCK_CDS'
INVOICE_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_STORE_INVOICE_VL06_CDS'
AGEING_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_STORE_VENDOR_AGEING_CDS'
ASSET_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_STORE_ASSET_TR_CDS'
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
# pending invoice entries: the key of the delivery items is the sort; if SAP refuses the status filter, all rows are read and invoice_compact keeps the pending ones
_INV_ORDER = 'InboundDelivery,InboundDeliveryItem'
INVOICE_QUERY = [{'$select': ','.join(INVOICE_FIELDS), '$filter': INVOICE_FILTER, '$orderby': _INV_ORDER},
                 {'$select': ','.join(INVOICE_FIELDS), '$orderby': _INV_ORDER}]
# payment ageing: the open vendor items (about 25,000 of 82,000 rows); if SAP refuses the filter all rows are read and ageing_compact drops the cleared ones
_AGE_ORDER = 'CompanyCode,AccountingDocument,FiscalYear,AccountingDocumentItem'
AGEING_QUERY = [{'$select': ','.join(AGEING_FIELDS), '$filter': AGEING_FILTER, '$orderby': _AGE_ORDER},
                {'$select': ','.join(AGEING_FIELDS), '$orderby': _AGE_ORDER}]
# asset transactions: about 3,000 lines since June 2024 (the key of the lines is the sort, so the pages do not skip or repeat rows); if SAP refuses the filter all rows are read
# (about 46,000, mostly depreciation) and asset_compact keeps the transactions
_AST_ORDER = 'CompanyCode,FiscalYear,AccountingDocument,LedgerGLLineItem'
ASSET_QUERY = [{'$select': ','.join(ASSET_FIELDS), '$filter': ASSET_FILTER, '$orderby': _AST_ORDER},
               {'$select': ','.join(ASSET_FIELDS), '$orderby': _AST_ORDER}]
# goods issues (stock out) since 1 Jan 2026, read together with the stock to find the last use of each material
CONSUME_QUERY = {'$select': ','.join(CONSUME_FIELDS), '$orderby': _ORDER,
                 '$filter': ISSUE_DATE_FILTER + " and DebitCreditCode eq 'H' and (" + ' or '.join(f"GoodsMovementType_1 eq '{m}'" for m in CONSUME_MVTS) + ')'}
# the open approval tasks of the purchase orders (about 60 rows): who a PO waits for
APPROVAL_BASE = 'https://my413077-api.s4hana.cloud.sap/sap/opu/odata/sap/YY1_PO_PENDING_APPROVAL_CDS'
APPROVAL_QUERY = [{'$select': ','.join(APPROVAL_FIELDS), '$orderby': 'WorkflowTaskInternalID'}]


MOVES_FULL_EVERY = 21600  # the whole movement history (about 1.2 million lines, 2-3 minutes) is read again every 6 hours; in between only the last MOVES_RECENT_DAYS days
MOVES_RECENT_DAYS = 10
MOVES_KEEP_DAYS = 8  # a saved movement history is used when its last full read is at most this old: the recent days (MOVES_RECENT_DAYS) fill the gap
MOVE_QUERY = {'$select': ','.join(MOVE_FIELDS), '$orderby': _ORDER, '$filter': f"PostingDate ge datetime'{MOVE_FROM}T00:00:00'"}


def move_recent_query(days=MOVES_RECENT_DAYS):
    since = (_dt.datetime.utcfromtimestamp(time.time() + 5.5 * 3600) - _dt.timedelta(days=days)).date().isoformat()
    return {**MOVE_QUERY, '$filter': f"PostingDate ge datetime'{since}T00:00:00'"}


def consume_recent_query(days=7):
    """The same query for the last `days` days only (about 1 call instead of 60): the frequent refreshes read this and add it to the state of
    the last full read; a full read still happens every FULL_EVERY seconds."""
    since = (_dt.datetime.utcfromtimestamp(time.time() + 5.5 * 3600) - _dt.timedelta(days=days)).date().isoformat()
    return {**CONSUME_QUERY, '$filter': CONSUME_QUERY['$filter'].replace(ISSUE_DATE_FILTER, f"PostingDate ge datetime'{since}T00:00:00'")}


FULL_EVERY = 1800  # seconds between two full reads of an incremental extra (the 30-second refreshes read only the recent days)
MIN_REFRESH = 10   # the Refresh button reads SAP again at once, but not more often than this many seconds
WAIT_FRESH = 2     # a request that finds old data waits this long for the new data (small views are ready by then), else it answers with the old data at once; the page asks again after 30 s
DEFAULT_USER = 'POWERBI_USER_PRD'
PAGE = 5000
# The data of every view is also kept on disk (backend/cache, local PC only) after each read from SAP. A start of the dashboard on the same day shows the data of the last
# run at once and reads SAP again in the background, so the pages do not wait a minute or more for the first load. The files are dropped when they are from another day
# (the pages take today's date from the data) or when the program files changed (the data layout may have changed).
CACHE_DIR = os.path.join(HERE, 'cache')
IST = 5.5 * 3600


def _source_version():
    h = hashlib.sha1()
    for name in ('serve_dashboard.py', 'pr_data.py'):
        try:
            with open(os.path.join(HERE, name), 'rb') as f:
                h.update(f.read())
        except OSError:
            pass
    return h.hexdigest()[:16]


SOURCE_VERSION = _source_version()
# A saved view is used when it has the same data layout (user, 4-Nov-2026: the pages must open at once after a restart, not wait for SAP): CACHE_LAYOUT changes when the compact data of a view changes
# (a new field, a left-out plant or storage location). It is no longer the hash of the program files, so an edit that does not change the data keeps the saved views.
CACHE_LAYOUT = 'L10|' + ','.join(EXCLUDE_PLANTS) + '|' + ','.join(EXCLUDE_LOCATIONS)
CACHE_OK = (CACHE_LAYOUT, SOURCE_VERSION, 'cd6fffa04b5fcd6f')  # the last one: the files written on 4-Nov-2026 by the program version before this change (same layout)
CLOUD = bool(os.environ.get('K_SERVICE'))
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'self'")


LOG_FILE = os.path.join(HERE, 'server.log')  # the same lines as in the window, kept for the last runs (local PC only)
try:  # the file stays small: when it is over 500 KB at the start only its last 300 lines are kept
    if os.path.getsize(LOG_FILE) > 500_000:
        with open(LOG_FILE, encoding='utf-8', errors='replace') as _f:
            _tail = _f.readlines()[-300:]
        with open(LOG_FILE, 'w', encoding='utf-8') as _f:
            _f.writelines(_tail)
except OSError:
    pass


def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line, flush=True)
    if not CLOUD:
        try:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(f'{time.strftime("%Y-%m-%d")} {line}\n')
        except OSError:
            pass


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
        self.pre_view = None       # a function that sees all rows before the RM rows are dropped (set for the PO view in main())
        self.row_skip = None       # a view's own rule for rows that are not taken, set in main() (the Pending PR view: purchasing group 020)
        token = base64.b64encode(f'{user}:{password}'.encode('utf-8')).decode('ascii')
        self._auth = 'Basic ' + token
        self.ttl, self.min_refresh = ttl, min_refresh
        self.busy = threading.Lock()  # held while an SAP fetch runs, so only one runs at a time
        self.cache = None          # (fetched_at, raw_json_bytes, gzipped_bytes, digest of the data, fetched_at in ms)
        self._done = None          # set when the running background refresh has finished
        self._xstate = {}          # extra index -> (state of the last read, time of the last full read), for the incremental extras
        self.key = None            # name of the disk cache file (set for the local PC)
        self.drop_plants = True    # rows of EXCLUDE_PLANTS are dropped after the read (the asset view does it in asset_compact: only one of its lines carries the plant)
        self._saved = (None, 0)    # digest and time of the last write to the disk

    def _path(self):
        return os.path.join(CACHE_DIR, self.key + '.cache')

    def save_disk(self):
        """Writes the data of the last read (and the state of the incremental reads) to backend/cache, when it changed or every 5 minutes."""
        c = self.cache
        if not self.key or CLOUD or not c:
            return
        if self._saved[0] == c[3] and time.time() - self._saved[1] < 300:
            return
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            tmp = self._path() + '.tmp'
            with open(tmp, 'wb') as f:
                pickle.dump({'v': CACHE_LAYOUT, 'mv': 1, 'fetched_at': c[0], 'gz': c[2], 'digest': c[3], 'stamp': c[4], 'xstate': self._xstate}, f, protocol=4)
            os.replace(tmp, self._path())
            self._saved = (c[3], time.time())
        except Exception as e:  # a disk problem must never stop the dashboard
            log(f'{self.key}: could not save the data to the disk ({e})')

    def load_disk(self):
        """Takes the data of the last run from backend/cache when it is from today and was made by the same program files. True when it was used."""
        if not self.key or CLOUD:
            return False
        try:
            with open(self._path(), 'rb') as f:
                d = pickle.load(f)
            if d.get('v') not in CACHE_OK:
                return False
            if int((d['fetched_at'] + IST) // 86400) != int((time.time() + IST) // 86400):
                return False
            gz = d['gz']
            raw = gzip.decompress(gz)
            self.cache = (d['fetched_at'], raw, gz, d['digest'], d['stamp'])
            self._xstate = d.get('xstate') or {}
            self._saved = (d['digest'], time.time())
            return True
        except FileNotFoundError:
            return False
        except Exception as e:
            log(f'{self.key}: the saved data could not be read ({e}); it is read from SAP')
            return False

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

    def _fetch_rows(self, base=None, entity=None, queries=None, fold=None, init=None):
        # fold(state, rows) -> state, called page by page when given: for views with too many rows to keep in memory
        # (init is the state to start from: the incremental reads add the recent rows to the state of the last full read)
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
        state = fold(init, rows) if fold else None
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
        t0 = time.time()
        rows = self._fetch_rows()
        n_all = len(rows)
        if self.drop_plants and EXCLUDE_PLANTS:
            rows = [r for r in rows if (r.get('Plant') or '') not in EXCLUDE_PLANTS]
        if EXCLUDE_LOCATIONS:  # a row of an excluded storage location (the views without a storage location have none)
            rows = [r for r in rows if (r.get('StorageLocation') or '') not in EXCLUDE_LOCATIONS]
        if self.pre_view:
            self.pre_view(rows)  # sees every row, also the RM ones that are dropped next (the PO view notes which POs and suppliers are RM)
        rows = [r for r in rows if not row_is_rm(r) and not (self.row_skip and self.row_skip(r))]  # RM is not taken (user, 5-Nov-2026)
        extra, used = [], []
        for i, x in enumerate(self.extra):
            try:
                recent = x[5] if len(x) > 5 else None  # builds the query of the recent days; with it the extra is read incrementally
                prev = self._xstate.get(i)
                if recent and prev and time.time() - prev[1] < FULL_EVERY:
                    res = self._fetch_rows(x[0], x[1], [recent()], x[3], init=dict(prev[0]))
                    full_at = prev[1]
                else:
                    res = self._fetch_rows(x[0], x[1], [x[2]], x[3] if len(x) > 3 else None)
                    full_at = time.time()
                if recent:
                    self._xstate[i] = (res.state, full_at)
                extra.append(res)
                used.append(x)
            except SapError as e:
                if len(x) > 4 and x[4] and e.status not in (401, 403):
                    log(f'{x[1]} could not be read ({e}); {self.entity} is shown without it')
                    continue
                raise
        # Today's date in India: Cloud Run runs on UTC, which is still yesterday until 05:30 IST.
        asof_day = int((time.time() + 5.5 * 3600) // 86400)
        data = self.compact(rows, asof_day, *extra)
        body = json.dumps(data, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        # the digest says whether the data changed (the time of the read is not part of it): an unchanged view is answered with 304 and not redrawn
        digest = hashlib.sha1(body).hexdigest()[:20]
        stamp = int(time.time() * 1000)
        raw = body[:-1] + b',"fetchedAt":' + str(stamp).encode('ascii') + b'}'
        self.cache = (time.time(), raw, gzip.compress(raw, 6), digest, stamp)
        log(f'fetched {n_all:,} rows from SAP ({self.entity})' + (f' (plants {", ".join(EXCLUDE_PLANTS)} and storage locations {", ".join(EXCLUDE_LOCATIONS)} left out: {n_all - len(rows):,})' if n_all != len(rows) else '') + ''.join(f' + {len(x):,} ({e})' for x, (_, e, *_) in zip(extra, used)) + f' in {time.time() - t0:.1f} s')
        self.save_disk()
        return self.cache[1:]

    def _refresh_in_background(self, done):
        try:
            self._refresh()
        except SapError as e:
            log(f'background refresh failed: {e}')
        except Exception as e:
            log(f'background refresh of {self.entity} failed: {e}\n{traceback.format_exc()}')
        finally:
            self.busy.release()
            done.set()

    def payload(self, force=False):
        """Returns (raw_json, gzipped_json, digest, fetched_at_ms).
        Fresh cache: returned as is. Older than the TTL: SAP is asked again in the background and the request waits a few seconds for the
        new data (a small view is ready by then); if SAP is slower the old data is returned at once, so nobody waits for SAP.
        Refresh button (force) or no data yet: waits for SAP."""
        if self.auth_failed:
            raise SapError('SAP login failed earlier. Fix the SAP user or password and restart the dashboard.', 401)
        c = self.cache
        if c and time.time() - c[0] < (self.min_refresh if force else self.ttl):
            return c[1:]
        if c and not force:
            if self.busy.acquire(blocking=False):
                done = self._done = threading.Event()
                threading.Thread(target=self._refresh_in_background, args=(done,), daemon=True).start()
            else:
                done = self._done  # a refresh is already running
            if done is not None:
                done.wait(WAIT_FRESH)
            return self.cache[1:]
        with self.busy:
            c = self.cache  # another request may have fetched while this one waited
            if c and time.time() - c[0] < self.min_refresh:
                return c[1:]
            return self._refresh()


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
                if len(r) >= 2 and r[0].strip() and r[1].strip() and r[0].strip().lower() != 'plant' and r[0].strip() not in EXCLUDE_PLANTS and r[1].strip() not in EXCLUDE_LOCATIONS:
                    out[(r[0].strip(), r[1].strip())] = ((r[3].strip() if len(r) > 3 else '') or 'Store', r[2].strip() if len(r) > 2 else '')
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f'stock_locations.csv could not be read ({e})')
    return out or None


# Payment Ageing: the type of a party (Store, RM, Employees, Group companies, Others) is worked out by the page from the account group, the name and the POs of the
# party; this optional file sets it by hand for the parties that come out wrong: columns Supplier (the number) and Type (Store, RM, Employees, Group or Others).
# It is read again at every refresh from SAP.
PARTY_TYPES_FILE = os.path.join(DATA, 'party_types.csv')
PARTY_TYPE_NAMES = {'store': 'Store', 'rm': 'RM', 'raw material': 'RM', 'employee': 'Employees', 'employees': 'Employees', 'group': 'Group',
                    'group company': 'Group', 'group companies': 'Group', 'other': 'Others', 'others': 'Others'}


def load_party_types():
    out = {}
    try:
        with open(PARTY_TYPES_FILE, newline='', encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                sid = (r.get('Supplier') or '').strip().lstrip('0')
                ty = PARTY_TYPE_NAMES.get((r.get('Type') or '').strip().lower())
                if sid and ty:
                    out[sid] = ty
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f'party_types.csv could not be read ({e})')
    return out


def ageing_view(rows, asof_day):
    data = ageing_compact(rows, asof_day)
    data['partyTypes'] = load_party_types()
    return data


# what po_pre() saw in the rows of the last PO read, before the RM rows were dropped: the RM suppliers and the purchase orders that are left out as a whole
PO_PRE = {'rmSuppliers': {}, 'gone': set()}


def po_pre(rows):
    kept, gone = po_split(rows)
    kept_pos = {r.get('PurchaseOrder') for r in kept}
    # a PO with no item left (all its items are RM or internal stock transfer) is left out as a whole
    PO_PRE['gone'] = gone | {r.get('PurchaseOrder') for r in rows if r.get('PurchaseOrder') not in kept_pos}
    PO_PRE['rmSuppliers'] = po_rm_suppliers(rows)


def po_view(rows, asof_day, *extra):
    rows, gone = po_split(rows)
    data = po_compact(rows, asof_day, *extra)
    data['rmSuppliers'] = dict(PO_PRE['rmSuppliers'])  # supplier number -> RM items left out: Payment Ageing finds its RM parties with it
    data['removedPos'] = sorted(gone | PO_PRE['gone'])  # purchase orders left out as a whole: their receipts and pending invoices are left out on the pages
    # the store locations of stock_locations.csv as [plant, location, category]: the Price Variance page counts as Store only the PO lines delivered to them
    locs = load_stock_locations()
    data['storeLocs'] = sorted([p, c, v[0]] for (p, c), v in locs.items()) if locs else None
    return data


def purchase_view(rows, asof_day):
    return purchase_compact(rows, asof_day, load_stock_locations())


def stock_view(rows, asof_day, *extra):
    return stock_compact(rows, asof_day, load_stock_locations(), extra[0].state if extra else None)


class MoveSap(Sap):
    """The goods movement history of the listed store locations (for the stock of a past date). The first read takes the whole history, later reads only the last days; the state is
    kept per document line, so nothing is counted twice."""

    def _build(self, state, fetched_at=None):
        """The page data (month, day wise) of the movement state: the listed store locations of today (a location taken out of the list drops out at once), the stock of today's date."""
        listed = load_stock_locations()
        asof_day = int((time.time() + 5.5 * 3600) // 86400)
        data = moves_compact(state, asof_day, listed)
        body = json.dumps(data, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        digest = hashlib.sha1(body).hexdigest()[:20]
        stamp = int(time.time() * 1000)
        raw = body[:-1] + b',"fetchedAt":' + str(stamp).encode('ascii') + b'}'
        self.cache = (fetched_at if fetched_at is not None else time.time(), raw, gzip.compress(raw, 6), digest, stamp)

    def load_disk(self):
        """The movement history is not tied to a day or to the program files (it is the history since 1 Dec 2025): a saved one whose last full read is at most MOVES_KEEP_DAYS days old is
        shown at once, the recent days are read again at once and the whole history again 10 minutes later."""
        if not self.key or CLOUD:
            return False
        try:
            with open(self._path(), 'rb') as f:
                d = pickle.load(f)
            st = (d.get('xstate') or {}).get(0)
            if d.get('mv', 1) != 1 or not st or time.time() - st[1] > MOVES_KEEP_DAYS * 86400:
                return False
            self._xstate = {0: (st[0], max(st[1], time.time() - MOVES_FULL_EVERY + 600))}
            self._build(st[0], fetched_at=d.get('fetched_at') or 0)
            self._saved = (self.cache[3], time.time())
            return True
        except FileNotFoundError:
            return False
        except Exception as e:
            log(f'{self.key}: the saved movements could not be read ({e}); they are read from SAP')
            return False

    def _refresh(self):
        t0 = time.time()
        listed = load_stock_locations()
        listed_set = set(listed) if listed else None
        prev = self._xstate.get(0)
        full = not prev or time.time() - prev[1] >= MOVES_FULL_EVERY
        q = MOVE_QUERY if full else move_recent_query()
        res = self._fetch_rows(self.base, self.entity, [q], lambda st, rows: move_fold(st, rows, listed_set), init=None if full else dict(prev[0]))
        self._xstate[0] = (res.state, time.time() if full else prev[1])
        self._build(res.state)
        log(f'goods movements of the store locations: read {res.n:,} lines ({"whole history" if full else "last days"}), {len(res.state["lines"]):,} kept, in {time.time() - t0:.1f} s')
        self.save_disk()
        return self.cache[1:]


class OldPoSap(Sap):
    """The PO items of the pending invoices whose purchase order is older than the PO data (which starts at 1 Jan 2026): the invoice view has no price, so these items had no value on
    the Pending Invoice Entry page (user, 4-Nov-2026: "inki value kyu nahi aa rhi hai"). Same layout as /api/po, only for those purchase orders; they are asked from SAP by PO number
    (a few at a time) once, and again after 6 hours or when a new old PO appears."""
    sources = None  # (invoice view, PO view), set in main()

    def _needed(self):
        inv, po = self.sources
        if not (inv.cache and po.cache):
            return None
        have = {a[2] for a in json.loads(po.cache[1])['rows']}
        return sorted({a[4] for a in json.loads(inv.cache[1])['rows'] if a[4] and a[4] not in have})

    def _refresh(self):
        t0 = time.time()
        need = self._needed()
        if need is None:  # the invoice or PO view is not there yet: nothing to price now, try again at the next request
            raise SapError('The pending invoices and the PO data are not loaded yet.', 503)
        prev = self._xstate.get(0)
        bank, bank_at = (dict(prev[0]), prev[1]) if prev and time.time() - prev[1] < 21600 else ({}, time.time())
        new = [x for x in need if x not in bank]
        for i in range(0, len(new), 12):
            chunk = new[i:i + 12]
            flt = ' or '.join(f"PurchaseOrder eq '{x}'" for x in chunk)
            got = self._fetch_rows(self.base, self.entity, [{'$select': ','.join(PO_FIELDS), '$filter': flt}])
            for x in chunk:
                bank[x] = []
            for r in got:
                if (r.get('Plant') or '') in EXCLUDE_PLANTS or (r.get('StorageLocation') or '') in EXCLUDE_LOCATIONS:
                    continue
                bank.setdefault(r.get('PurchaseOrder') or '', []).append(r)
        self._xstate[0] = (bank, bank_at)
        rows = [r for x in need for r in bank.get(x, [])]
        asof_day = int((time.time() + 5.5 * 3600) // 86400)
        rows, gone = po_split(rows)
        data = po_compact(rows, asof_day)
        data['removedPos'] = sorted(gone)
        body = json.dumps(data, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        digest = hashlib.sha1(body).hexdigest()[:20]
        stamp = int(time.time() * 1000)
        raw = body[:-1] + b',"fetchedAt":' + str(stamp).encode('ascii') + b'}'
        self.cache = (time.time(), raw, gzip.compress(raw, 6), digest, stamp)
        if new:
            log(f'old purchase orders of the pending invoices: {len(new)} asked from SAP, {len(rows)} items in {time.time() - t0:.1f} s')
        self.save_disk()
        return self.cache[1:]


class ApprovalSap(Sap):
    """The purchase orders that wait for approval: the open tasks of SAP's release workflow (YY1_PO_PENDING_APPROVAL_CDS) and the items of exactly those POs, ALL of them: raw material
    and internal stock transfers too (user, 5-Nov-2026: "PO Pending Approval me sabhi PO dikhne chahiye ... RM se leke sab" - this is the one page that shows RM). The items are asked from
    SAP by PO number (12 at a time), kept for 10 minutes, and a PO that is new in the task list is asked at once. Result: the tasks (approval_compact) and `po` = the items in the
    layout of /api/po (po_compact), without any RM / plant / location rule."""
    po_base = None  # the PO item view, set in main()

    def _refresh(self):
        t0 = time.time()
        asof_day = int((time.time() + 5.5 * 3600) // 86400)
        data = approval_compact(self._fetch_rows(), asof_day)
        need = sorted({r[0] for r in data['rows']})
        keep = set(need)
        bank = {po: v for po, v in (self._xstate.get(0) or {}).items() if po in keep}  # a PO that is not pending any more is forgotten
        now = time.time()
        todo = [po for po in need if po not in bank or now - bank[po][1] > 600]
        for i in range(0, len(todo), 12):
            chunk = todo[i:i + 12]
            flt = ' or '.join(f"PurchaseOrder eq '{x}'" for x in chunk)
            got = self._fetch_rows(self.po_base, 'YY1_PO_ITEM_SUPPLIER', [{'$select': ','.join(PO_FIELDS), '$filter': flt, '$orderby': 'PurchaseOrder,PurchaseOrderItem'}])
            by = {x: [] for x in chunk}
            for r in got:
                by.setdefault(r.get('PurchaseOrder') or '', []).append(r)
            for x in chunk:
                bank[x] = (by.get(x, []), now)
        self._xstate[0] = bank
        items = [r for po in need for r in bank[po][0]]
        data['po'] = po_compact(items, asof_day)
        body = json.dumps(data, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        digest = hashlib.sha1(body).hexdigest()[:20]
        stamp = int(time.time() * 1000)
        raw = body[:-1] + b',"fetchedAt":' + str(stamp).encode('ascii') + b'}'
        self.cache = (time.time(), raw, gzip.compress(raw, 6), digest, stamp)
        if todo:
            log(f'purchase orders waiting for approval: {len(need)} tasks, items of {len(todo)} POs asked from SAP, {len(items)} item rows in {time.time() - t0:.1f} s')
        self.save_disk()
        return self.cache[1:]


PAGES = {'/': TPL, '/index.html': TPL, '/issue': ISSUE_TPL, '/po': PO_TPL, '/po-approval': PO_APPROVAL_TPL, '/stock': STOCK_TPL, '/summary': SUMMARY_TPL, '/purchase': PURCHASE_TPL, '/invoice': INVOICE_TPL, '/price': PRICE_TPL, '/ageing': AGEING_TPL, '/asset': ASSET_TPL, '/vendor': VENDOR_TPL}
# User ID -> full name, put into the page like the data (no '<' in names, so it is safe inside a script tag).
USERS_JSON = json.dumps(USER_NAMES, ensure_ascii=False, separators=(',', ':'))
PGS_JSON = json.dumps(PG_NAMES, ensure_ascii=False, separators=(',', ':'))
MGS_JSON = json.dumps(MG_NAMES, ensure_ascii=False, separators=(',', ':'))


def make_handler(apis):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype, gz=None, cache='no-store', extra=()):
            wants_gz = 'gzip' in self.headers.get('Accept-Encoding', '')
            if wants_gz and gz is None and len(body) > 1024:
                gz = gzip.compress(body, 6)
            if wants_gz and gz is not None:
                body = gz
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            if wants_gz and gz is not None:
                self.send_header('Content-Encoding', 'gzip')
            for k, v in extra:
                self.send_header(k, v)
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
                html = open(PAGES[u.path], encoding='utf-8').read().replace('__USERS__', USERS_JSON).replace('__PGS__', PGS_JSON).replace('__MGS__', MGS_JSON)
                return self._send(200, html.encode('utf-8'), 'text/html; charset=utf-8')
            if u.path in STATIC:
                path, ctype = STATIC[u.path]
                with open(path, 'rb') as f:
                    return self._send(200, f.read(), ctype, cache='no-cache')
            if u.path == '/logo.png':
                with open(LOGO, 'rb') as f:
                    return self._send(200, f.read(), 'image/png', cache='public, max-age=86400')
            if u.path in apis:
                force = 'refresh' in urllib.parse.parse_qs(u.query)
                try:
                    raw, gz, digest, stamp = apis[u.path].payload(force)
                    tag = f'"{digest}"'
                    # the page asks again every 30 seconds with the tag of the data it has: nothing changed = 304, no body, no redraw
                    hdr = (('ETag', tag), ('X-Fetched-At', str(stamp)))
                    if not force and self.headers.get('If-None-Match') == tag:
                        return self._send(304, b'', 'application/json; charset=utf-8', extra=hdr)
                    return self._send(200, raw, 'application/json; charset=utf-8', gz, extra=hdr)
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
    ap.add_argument('--ttl', type=int, default=int(os.environ.get('CACHE_TTL', 25)), help='seconds to reuse fetched data before asking SAP again (default 25, a little under the 30 seconds the pages ask again, so every check gets fresh data)')
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
    sap = Sap(args.base_url, 'YY1_Store_Pending_PR', PR_QUERY, to_compact, user, password, args.ttl, min_refresh=MIN_REFRESH)
    sap.row_skip = lambda r: (r.get('PurchasingGroup') or '') == '020'  # the RM purchase (VP Purchase) is not taken
    # Every view is read again 25 seconds after its last read (a little under the 30 seconds the pages ask again), but only while a page is open; a read of the
    # biggest views takes 10-25 seconds, so they are nearly always being read while a page is open.
    issue = Sap(ISSUE_BASE, 'YY1_Store_Reservation', ISSUE_QUERY, issue_compact, user, password,
                args.ttl, min_refresh=MIN_REFRESH)
    # PO items: about 72,000 lines since 1 Jan 2026.
    po = Sap(PO_BASE, 'YY1_PO_ITEM_SUPPLIER', PO_QUERY, po_view, user, password, args.ttl, min_refresh=MIN_REFRESH,
             extra=[(PO_STATUS_BASE, 'YY1_PO_ITEM_STATUS', PO_STATUS_QUERY)])
    po.pre_view = po_pre
    # Store stock: about 27,000 rows from SAP of which about 5,000 hold stock. The goods issues read with it (about 300,000 rows, 60 calls) are read in full
    # every 30 minutes; the refreshes in between read only the last 7 days (consume_recent_query) and add them to that state.
    stock = Sap(STOCK_BASE, STOCK_ENTITY, STOCK_QUERY, stock_view, user, password, args.ttl, min_refresh=MIN_REFRESH,
                extra=[(ISSUE_BASE, 'YY1_Store_Reservation', CONSUME_QUERY, consume_fold, True, consume_recent_query)])
    # Purchases (movement types 101 / 102) from the same view as the Store Issue. SAP is asked for the lines that have a purchase order first; if it
    # refuses that filter the simpler query is used and the lines without a PO are read too (much more data).
    pq = {'$select': ','.join(PURCHASE_FIELDS), '$orderby': _ORDER}
    purchase = Sap(ISSUE_BASE, 'YY1_Store_Reservation', [{**pq, '$filter': PURCHASE_FILTER + " and PurchaseOrder ne ''"}, {**pq, '$filter': PURCHASE_FILTER}],
                   purchase_view, user, password, args.ttl, min_refresh=MIN_REFRESH)
    # Pending invoice entries (inbound deliveries without a goods receipt): a few hundred rows that change during the day.
    invoice = Sap(INVOICE_BASE, 'YY1_STORE_INVOICE_VL06', INVOICE_QUERY, invoice_compact, user, password, args.ttl, min_refresh=MIN_REFRESH)
    # Payment ageing: about 25,000 open vendor items.
    ageing = Sap(AGEING_BASE, 'YY1_STORE_VENDOR_AGEING', AGEING_QUERY, ageing_view, user, password, args.ttl, min_refresh=MIN_REFRESH)
    # Purchase orders waiting for approval: the open tasks of the release workflow (about 60 rows) and the items of exactly those POs, raw material included.
    approval = ApprovalSap(APPROVAL_BASE, 'YY1_PO_PENDING_APPROVAL', APPROVAL_QUERY, approval_compact, user, password, args.ttl, min_refresh=MIN_REFRESH)
    approval.po_base = PO_BASE
    # Asset transactions (acquisitions, retirements, transfers): about 3,000 lines that change a few times a day.
    asset = Sap(ASSET_BASE, 'YY1_STORE_ASSET_TR', ASSET_QUERY, asset_compact, user, password, args.ttl, min_refresh=MIN_REFRESH)
    asset.drop_plants = False
    # The goods movements of the listed store locations: with them the stock of an earlier day is rebuilt from the stock of today (day wise / month wise stock).
    stockmoves = MoveSap(ISSUE_BASE, 'YY1_Store_Reservation', MOVE_QUERY, None, user, password, args.ttl, min_refresh=MIN_REFRESH)
    old_po = OldPoSap(PO_BASE, 'YY1_PO_ITEM_SUPPLIER', PO_QUERY, None, user, password, args.ttl, min_refresh=MIN_REFRESH)
    old_po.sources = (invoice, po)
    apis = {'/api/po-old': old_po, '/api/pr': sap, '/api/issue': issue, '/api/po': po, '/api/stock': stock, '/api/purchase': purchase, '/api/invoice': invoice, '/api/ageing': ageing, '/api/po-approval': approval, '/api/asset': asset, '/api/stockmoves': stockmoves}
    del password
    restored = []
    for path, view in apis.items():
        view.key = path.rsplit('/', 1)[-1]
        if view.load_disk():
            restored.append(view.key)

    if CLOUD:
        # Listen right away so Cloud Run sees a healthy container; the first dashboard visit loads the data.
        host = '0.0.0.0'
    else:
        if sap.cache is None:
            print('Checking SAP login and loading data ...')
            try:
                sap.payload()
            except SapError as e:
                print('\nStopped:', e)
                if saved and e.status == 401:
                    forget_login()  # never retry a rejected password on its own; the next start asks again
                    print('The saved password was removed. Start the dashboard again and type the current password.')
                sys.exit(1)
        else:
            print('Showing the data of the last run at once (' + ', '.join(restored) + '); SAP is read again in the background ...')
        if typed and not os.environ.get('SAP_PASSWORD') and save_login(*typed):
            print('Login saved in Windows Credential Manager. Next time the dashboard starts without asking.')
        typed = None
        # Read every view in the background, three at a time (the biggest first), so the pages do not wait for their first load; the data of the last run
        # (restored from the disk) is shown meanwhile.
        def warm():
            def one(view):
                try:
                    view.payload()
                except SapError as e:
                    log(f'{view.entity} data not loaded: {e}')
                if Sap.auth_failed and saved:
                    forget_login()
                    log('SAP rejected the saved password; it was removed. Close this window, start the dashboard again and type the current password.')
            with ThreadPoolExecutor(max_workers=3) as ex:
                list(ex.map(one, (stock, po, issue, ageing, purchase, sap, invoice, asset, approval, stockmoves)))
            one(old_po)  # after the invoice and PO views: it needs their data
            log('every view is ready (a view that was restored from the disk is being read from SAP again in the background)')
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
