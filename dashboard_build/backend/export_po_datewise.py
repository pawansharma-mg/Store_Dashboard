"""Date wise list of PO items with the three values, from the live SAP data of the dashboard (/api/po).
Needs the dashboard to be running (it reads http://127.0.0.1:8765/api/po, the live SAP data). Needs openpyxl.
usage: python export_po_datewise.py OUT.xlsx 2026-10-01 2026-10-31   (purchase orders created from .. to .., all items)"""
import datetime
import json
import sys
import urllib.request
from collections import OrderedDict

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

out_path, d_from, d_to = sys.argv[1], sys.argv[2], sys.argv[3]
EPOCH = datetime.date(1970, 1, 1)
day = lambda s: (datetime.date.fromisoformat(s) - EPOCH).days
dd = lambda n: EPOCH + datetime.timedelta(days=n)
j = json.loads(urllib.request.urlopen('http://127.0.0.1:8765/api/po', timeout=300).read().decode('utf-8'))
fetched = datetime.datetime.fromtimestamp(j['fetchedAt'] / 1000)
a0, a1 = day(d_from), day(d_to)

NOGR = 'No GR (not in SAP list)'
REL = lambda p: 'In Approval' if p == '03' else 'Rejected' if p == '08' else 'Released'
rows = []
for a in j['rows']:
    if a[0] is None or not (a0 <= a[0] <= a1):
        continue
    cur = j['curs'][a[14]]
    rate = 1.0 if cur == 'INR' else (a[24] if a[24] and a[24] > 0 else 0.0)
    qty, gr, still, amt = a[15], a[22], a[23], a[17]
    typ = j['types'][a[4]]
    total = amt * rate
    delivered = amt * gr / qty * rate if (gr is not None and qty > 0) else 0.0
    pending = amt * min(still, qty) / qty * rate if (still and still > 0 and qty > 0) else 0.0
    st = 'No status data' if gr is None else ('Not delivered' if gr == 0 else 'Partly delivered') if (still and still > 0) else ('Delivered' if gr != 0 else NOGR)
    sup = j['suppliers'][a[5]]
    rows.append(dict(
        created=dd(a[0]), podate=dd(a[1]) if a[1] is not None else None, po=a[2], item=a[3], mat=j['mats'][a[8]], text=j['texts'][a[9]],
        sup=(sup[1] or sup[0]) + ' (' + sup[0] + ')', typ=typ, plant=j['plants'][a[6]], unit=j['units'][a[13]], qty=qty, gr=gr, still=still,
        cur=cur, rate=rate, price=a[16], amt=amt, total=total, delivered=delivered, pending=pending, st=st, rel=REL(j['procs'][a[21]]),
        note='Asset PO: counted as pending here; SAP lists it under Value to be Invoiced' if typ == 'ZAST' and pending else ''))
rows.sort(key=lambda r: (r['created'], r['po'], r['item']))

T = lambda f: sum(r[f] for r in rows)
print('data of', fetched.strftime('%d-%b-%Y %H:%M'), '| items', len(rows), '| POs', len({r['po'] for r in rows}))
print('Total order value Rs %.2f (%.2f Cr) | Delivered Rs %.2f (%.2f Cr) | Pending Rs %.2f (%.2f Cr)' % (T('total'), T('total') / 1e7, T('delivered'), T('delivered') / 1e7, T('pending'), T('pending') / 1e7))
print('difference Total - Delivered - Pending = Rs %.2f' % (T('total') - T('delivered') - T('pending')))
pend_items = [r for r in rows if r['still'] and r['still'] > 0]
print('items still pending (Delivery = Pending delivery):', len(pend_items), '| Total %.2f Cr | Delivered %.2f Cr | Pending %.2f Cr' % (sum(r['total'] for r in pend_items) / 1e7, sum(r['delivered'] for r in pend_items) / 1e7, sum(r['pending'] for r in pend_items) / 1e7))

wb = Workbook()
HEAD_FILL = PatternFill('solid', fgColor='1CADE4')
HEAD_FONT = Font(bold=True, color='FFFFFF')
BOLD = Font(bold=True)
THIN = Side(style='thin', color='BBBBBB')
MONEY = '#,##,##0.00;[Red]-#,##,##0.00'
QTY = '#,##0.###'

# ------------------------------------------------------------ sheet 2: the items, date wise
wi = wb.active
wi.title = 'Items'
cols = [('Created on', 12, 'created'), ('PO date', 12, 'podate'), ('PO', 12, 'po'), ('Item', 6, 'item'), ('Material', 12, 'mat'), ('Description', 44, 'text'),
        ('Supplier', 34, 'sup'), ('PO type', 8, 'typ'), ('Plant', 7, 'plant'), ('Unit', 6, 'unit'), ('Order quantity', 14, 'qty'), ('Delivered quantity', 14, 'gr'),
        ('Quantity to be delivered', 14, 'still'), ('Currency', 9, 'cur'), ('Exchange rate to INR', 11, 'rate'), ('Price (document currency)', 14, 'price'),
        ('Net value (document currency)', 16, 'amt'), ('Total order value (INR)', 18, 'total'), ('Delivered value (INR)', 18, 'delivered'), ('Pending value (INR)', 18, 'pending'),
        ('Delivery', 16, 'st'), ('Release', 12, 'rel'), ('Note', 40, 'note')]
wi.append([c[0] for c in cols])
for c in range(1, len(cols) + 1):
    cell = wi.cell(1, c)
    cell.fill, cell.font = HEAD_FILL, HEAD_FONT
    cell.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
    wi.column_dimensions[get_column_letter(c)].width = cols[c - 1][1]
wi.row_dimensions[1].height = 42
for r in rows:
    wi.append([r[c[2]] for c in cols])
n = len(rows)
last = n + 1
colidx = {c[2]: i + 1 for i, c in enumerate(cols)}
for ri in range(2, last + 1):
    for k in ('created', 'podate'):
        wi.cell(ri, colidx[k]).number_format = 'DD-MMM-YYYY'
    for k in ('qty', 'gr', 'still'):
        wi.cell(ri, colidx[k]).number_format = QTY
    for k in ('rate', 'price', 'amt', 'total', 'delivered', 'pending'):
        wi.cell(ri, colidx[k]).number_format = MONEY
    wi.cell(ri, colidx['text']).alignment = Alignment(wrap_text=True, vertical='top')
# the total row: SUBTOTAL, so that it follows a filter
tr = last + 1
wi.cell(tr, 1, 'TOTAL (follows the filter)').font = BOLD
for k in ('total', 'delivered', 'pending'):
    L = get_column_letter(colidx[k])
    c = wi.cell(tr, colidx[k], f'=SUBTOTAL(109,{L}2:{L}{last})')
    c.font, c.number_format = BOLD, MONEY
for c in range(1, len(cols) + 1):
    wi.cell(tr, c).border = Border(top=Side(style='medium'))
    wi.cell(tr, c).fill = PatternFill('solid', fgColor='EEEEEE')
wi.freeze_panes = 'G2'
wi.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{last}'

# ------------------------------------------------------------ sheet 1: date wise summary (formulas over the Items sheet)
ws = wb.create_sheet('Date wise summary', 0)
ws.append(['Created on', 'Purchase orders', 'Items', 'Total order value (INR)', 'Delivered value (INR)', 'Pending value (INR)', 'Total - Delivered - Pending (No GR items and over-delivery)'])
for c in range(1, 8):
    cell = ws.cell(1, c)
    cell.fill, cell.font = HEAD_FILL, HEAD_FONT
    cell.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
for c, w in zip('ABCDEFG', (24, 12, 8, 22, 22, 22, 26)):
    ws.column_dimensions[c].width = w
ws.row_dimensions[1].height = 34
by_date = OrderedDict()
for r in rows:
    by_date.setdefault(r['created'], []).append(r)
rng = lambda k: f"Items!${get_column_letter(colidx[k])}$2:${get_column_letter(colidx[k])}${last}"
for i, (d, rs) in enumerate(by_date.items(), start=2):
    ws.cell(i, 1, d).number_format = 'DD-MMM-YYYY'
    ws.cell(i, 2, len({r['po'] for r in rs}))
    ws.cell(i, 3, f'=COUNTIFS({rng("created")},A{i})')
    for col, k in ((4, 'total'), (5, 'delivered'), (6, 'pending')):
        ws.cell(i, col, f'=SUMIFS({rng(k)},{rng("created")},$A{i})').number_format = MONEY
    ws.cell(i, 7, f'=D{i}-E{i}-F{i}').number_format = MONEY
lr = len(by_date) + 1
tr2 = lr + 1
ws.cell(tr2, 1, 'TOTAL').font = BOLD
ws.cell(tr2, 2, len({r['po'] for r in rows})).font = BOLD
ws.cell(tr2, 3, f'=SUM(C2:C{lr})').font = BOLD
for col in (4, 5, 6, 7):
    L = get_column_letter(col)
    c = ws.cell(tr2, col, f'=SUM({L}2:{L}{lr})')
    c.font, c.number_format = BOLD, MONEY
for c in range(1, 8):
    ws.cell(tr2, c).border = Border(top=Side(style='medium'))
    ws.cell(tr2, c).fill = PatternFill('solid', fgColor='EEEEEE')
sr = tr2 + 2
ws.cell(sr, 1, 'By delivery status').font = BOLD
for c, h in enumerate(('Delivery', 'Items', 'Total order value (INR)', 'Delivered value (INR)', 'Pending value (INR)', 'What it is'), start=1):
    cell = ws.cell(sr + 1, c, h)
    cell.fill, cell.font = HEAD_FILL, HEAD_FONT
    cell.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
WHAT = {'Not delivered': 'ordered, nothing received yet', 'Partly delivered': 'part received, part still to come', 'Delivered': 'fully received (nothing pending)',
        NOGR: 'nothing left to deliver and nothing received: the SAP Purchase Order Items list does not show these items', 'No status data': 'no row in the status view'}
present = [s for s in WHAT if any(r['st'] == s for r in rows)]
for i, s in enumerate(present, start=sr + 2):
    ws.cell(i, 1, s)
    ws.cell(i, 2, f'=COUNTIFS({rng("st")},A{i})')
    for col, k in ((3, 'total'), (4, 'delivered'), (5, 'pending')):
        ws.cell(i, col, f'=SUMIFS({rng(k)},{rng("st")},$A{i})').number_format = MONEY
    ws.cell(i, 6, WHAT[s])
ei = sr + 2 + len(present)
ws.cell(ei, 1, 'TOTAL').font = BOLD
for col in (2, 3, 4, 5):
    L = get_column_letter(col)
    c = ws.cell(ei, col, f'=SUM({L}{sr + 2}:{L}{ei - 1})')
    c.font = BOLD
    c.number_format = MONEY if col > 2 else 'General'
ws.column_dimensions['F'].width = 40
tr2 = ei  # the notes go below this table
ws.cell(tr2 + 2, 1, f'Source: SAP S/4HANA Cloud (YY1_PO_ITEM_SUPPLIER_CDS and YY1_PO_ITEM_STATUS_CDS), read live through the dashboard at {fetched.strftime("%d-%b-%Y %H:%M")}. '
        f'Purchase orders created from {d_from} to {d_to}, all items (delivered and pending).')
ws.cell(tr2 + 3, 1, 'Total order value = net value in rupees (other currencies at the exchange rate of the PO). Delivered value = delivered quantity x net value / order quantity. '
        'Pending value = quantity still to be delivered x net value / order quantity (asset POs included). Total = Delivered + Pending for items that are not over-delivered.')
ws.cell(tr2 + 4, 1, 'The Items sheet has a filter on every column: filter "Delivery" to see only the pending items; its TOTAL row follows the filter.')
ws.freeze_panes = 'A2'
wb.calculation.fullCalcOnLoad = True
wb.save(out_path)
print('saved', out_path, '| dates', len(by_date))
