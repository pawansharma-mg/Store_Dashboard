# Mittal Group SAP dashboard

A live, multi-page dashboard on top of SAP S/4HANA Cloud OData CDS views. A small Python server (`backend/serve_dashboard.py`) calls SAP, caches the
result and serves the six pages of `frontend/` (five data pages and one Summary page that combines them). There is no database and no build step: standard library only, Python 3.12.

```
dashboard_build/
  backend/    Python server, SAP access, lookup tables and the hand-edited data files (backend/data)
  frontend/   the six pages (HTML, CSS and JavaScript in one file each) and the logo
  Dockerfile  Cloud Run image (copies backend and frontend)
  README.md
```

| Page | Menu tab | CDS view(s) | What it shows |
|---|---|---|---|
| `/summary` | Summary | the four views below (no extra SAP call) | One page with the headline figures of the five pages below, filtered by plant and date |
| `/` | Pending PR | `YY1_STORE_PENDING_PR_CDS` | Purchase requisitions still to be ordered: ageing, plant and PO status, purchasing group, user, month and day wise, item list |
| `/issue` | Store Issue | `YY1_STORE_RESERVATION_CDS` | Goods issued to cost centers since 1 Jan 2026, by department, cost center, material, month and day |
| `/po` | Pending Purchase Orders | `YY1_PO_ITEM_SUPPLIER_CDS` + `YY1_PO_ITEM_STATUS_CDS` | PO items since 1 Jan 2026 with supplier; by default only items still to be delivered (fully or in part) |
| `/po-approval` | PO Approval Pending | `YY1_PO_ITEM_SUPPLIER_CDS` | POs that are In Approval, with how long they have waited and the (likely) approver |
| `/stock` | Store Stock | `YY1_STORE_STOCK_CDS` + goods issues from `YY1_STORE_RESERVATION_CDS` | Stock value in INR for the listed store locations, Top 5 materials, materials not used for 5 months |

All views are read with the SAP communication user `POWERBI_USER_PRD` (basic auth). Everything is read-only.

## Run it on this PC

Double-click `..\Start_Live_Dashboard.bat` (or run `python serve_dashboard.py` in the `backend` folder). The dashboard opens at http://localhost:8765/.

SAP login on a local PC:

1. On the first start the server asks for the SAP user (Enter alone takes `POWERBI_USER_PRD`) and the password (typing is hidden).
2. After a successful login it saves them in **Windows Credential Manager** (target `MittalDashboard/SAP`, encrypted for this Windows user), so later starts do not ask.
3. If SAP rejects the saved password (HTTP 401) the saved login is removed and the server stops, so a wrong password is never retried on its own (account lock). Start again and type the current password.
4. The password is never written to a file, a log or the page. Do not paste it into chat or into any file of this project.

Options (`python serve_dashboard.py --help`):

| Option | Environment variable | Default | Meaning |
|---|---|---|---|
| `--port` | `PORT` | 8765 | Port to listen on |
| `--lan` | | off | Local PC only: let other PCs open `http://<this-pc-ip>:8765/` (no login) |
| `--base-url` | `SAP_BASE_URL` | Pending PR view | Base URL of the Pending PR view |
| `--ttl` | `CACHE_TTL` | 300 | Seconds to reuse the Pending PR data before asking SAP again |
| `--no-browser` | | off | Do not open the browser |
| | `SAP_USER`, `SAP_PASSWORD` | | SAP login (used on Cloud Run, from Secret Manager) |
| | `K_SERVICE` | | Set by Cloud Run; switches to cloud mode (listen on `0.0.0.0`, no prompt, login from the variables) |

## How it works

```
browser  --/api/*-->  serve_dashboard.py  --OData V2, basic auth-->  SAP S/4HANA Cloud
   ^                        |  cache + compact JSON
   '---- page (HTML) -------'
```

Browsers cannot call SAP directly (no CORS, and the password would sit in the page), so the server makes the calls and returns compact JSON.

* **`Sap` class** (`serve_dashboard.py`): one instance per view. It reads every page of the view (`$top 5000`, `$inlinecount=allpages`, the remaining
  pages in parallel with 4 workers) and keeps the result in memory (JSON + gzip).
  * Every query has a stable `$orderby` (the key of the view). Without it SAP skips and repeats rows between pages.
  * Cache: Pending PR 300 s (Refresh button at most every 30 s); Store Issue, PO and Stock 30 minutes (Refresh button at most every 5 minutes).
    An expired cache is served at once and refreshed in the background, so nobody waits for SAP.
  * `query` may be a list of variants; if SAP answers 400 the next, simpler one is used (Store Issue falls back to a date-only filter).
  * `extra=[(base, entity, query[, fold])]` reads more views together with the main one and passes their rows to the compact function.
    With a `fold(state, rows)` function the extra rows are processed page by page and not kept in memory (used for the ~290,000 goods issue rows of the stock page; `Folded` holds the result).
  * After one 401 no view calls SAP again (`Sap.auth_failed`), so a bad login cannot lock the SAP user.
  * A network hiccup (timeout, connection reset) or a 502 / 503 / 504 from SAP is tried again up to 3 times (after 2 s and 4 s); 400, 401 and 403 are never retried.
  * An `extra` entry can be optional (`(base, entity, query, fold, True)`): if it cannot be read the view is served without it. The goods issues of the stock page are optional: without them the stock still shows and only "Not used for 5 months" is missing.
  * Any other error while preparing a view comes back as `{"error": ...}` with status 500 and is written with its traceback in the server window; it never drops the connection.
* **Server details:** a local server listens on `127.0.0.1` and on the IPv6 loopback `::1` (otherwise `localhost` waits about 2 seconds on every new connection, because it tries `::1` first). `HEAD` works. Every response carries `Content-Security-Policy` (pages are self-contained), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`; the logo is cached for a day, everything else is `no-store`.
* **Compact JSON** (`backend/pr_data.py`): each `*_compact` function turns SAP rows into arrays of numbers plus shared dictionaries (plants, users, units ...),
  so a page with 60,000 rows is a few MB gzipped. The row layouts are documented in the docstrings.
* **Pages** are templates with placeholders: `__DATA__` (offline build only), `__USERS__` (user names), `__PGS__` (purchasing group names),
  `__MGS__` (material group names). The server fills them on every request, so **a template edit shows after a browser refresh; a change in a `.py` file needs a restart**.
* **API**: `/api/pr`, `/api/issue`, `/api/po`, `/api/stock` (add `?refresh=1` to force SAP), `/api/po-approvers`, `/healthz`, `/logo.png`, and the shared look `/ui.css` and `/ui.js` (revalidated on every load, so an edit shows after a refresh).
  All responses are `no-store`; errors come back as `{"error": "..."}` and the page shows them next to the red status dot.

## Files

Backend (`backend/`): everything that talks to SAP or holds data.

| File | Purpose |
|---|---|
| `backend/serve_dashboard.py` | Server: login handling, `Sap` class, view queries, routes, startup |
| `backend/pr_data.py` | Field lists, filters, the `*_compact` functions, and the lookup tables (purchasing group, material group, users, departments) |
| `backend/check_data.py` | Check of a running dashboard: does every page and API answer, which names / descriptions / approvers are still missing (see below) |
| `backend/build_dashboard.py` | Offline: builds a static Pending PR HTML from a saved JSON in the project folder (the other pages need the server) |
| `backend/data/stock_locations.csv` | The store locations the stock page covers, with their category (see below) |
| `backend/data/po_approvers.csv` | Confirmed approver per PO (optional; `po_approvers.xlsx` in the same folder is read first when present) |
| `backend/data/po_approver_rules.csv` | Likely approver by purchasing organisation, group and value band |

Frontend (`frontend/`): what the browser shows. The server serves these files; it fills the placeholders `__USERS__`, `__PGS__`, `__MGS__` with the lookup tables from `pr_data.py`.

| File | Purpose |
|---|---|
| `frontend/dashboard_template.html` | Pending PR page |
| `frontend/issue_template.html` | Store Issue page |
| `frontend/po_template.html` | Pending Purchase Orders page |
| `frontend/po_approval_template.html` | PO Approval Pending page |
| `frontend/stock_template.html` | Store Stock page |
| `frontend/summary_template.html` | Summary page: reads `/api/pr`, `/api/issue`, `/api/po`, `/api/stock` and `/api/po-approvers` in the browser |
| `frontend/ui.css` | The look shared by all pages: soft colour in the background, header with status pill, menu with icons, filter card, tiles with an icon bubble, cards that rise in, tables with value bars, charts, loading shimmer, highlight cards, CSV button, phone layout, print (A4 landscape). Loaded after each page's own styles; colours come from the page variables, so Normal and Dark both follow. Made once by a script, but it is a plain file: edit it directly |
| `frontend/ui.js` | Helpers shared by all pages. It changes no figure, it only draws: bars behind the value column of the summary tables, an icon on every tile, numbers that count up (and move from the old to the new number when a filter changes), bar and donut charts above the month / day / ageing / plant / category tables, a CSV button in the heading of every table card, a shadow under the header once scrolled, a back-to-top button and `/` for the search box |
| `frontend/logo.png` | Logo |

Project level:

| File | Purpose |
|---|---|
| `Dockerfile`, `.gcloudignore` | Cloud Run image |
| `..\GCP_DEPLOY.md` | Step by step Cloud Run deployment |
| `..\Start_Live_Dashboard.bat` | Local launcher (starts `backend\serve_dashboard.py`) |

## Checking the dashboard

With the dashboard running, `python backend/check_data.py` (stdlib only) answers: does every page and API work, and what is still missing in the lookup tables:
purchasing groups and material groups without a name, user IDs without a name, reservation creators without a department, Store Issue lines without a department,
POs In Approval without a confirmed or likely approver, listed stock locations that hold no stock, and how old the data is. It exits with 1 when a page or an API fails.
Run it after changing `pr_data.py` or the CSV files, and before a deployment.

## Page rules

### Summary (`/summary`)
* The first tab of the menu. It adds no SAP call of its own: the browser reads the same `/api/*` data as the other pages and works the figures out with the **same rules as those pages** (copied from them), so a figure here equals the figure on the page with the same filters.
* Top row: one headline tile per page (Pending PR items, Store issue value, PO value still to deliver, POs waiting for approval, Store stock value); click a tile to open its details on its page. Below, one card per page with four tiles, a small table (by plant, top 5 departments, top 5 suppliers, top 5 approvers, top 5 materials) and an "Open page" link.
* Filters: Plant and a date range (the whole current month at first; "Current month" resets it). The dates apply to Pending PR (PR creation date), Store Issue (posting date), Pending Purchase Orders and PO Approval Pending (PO creation date). Store Stock is the stock of today and takes only the plant. Under each figure "all dates" shows the same figure without the dates.
* Definitions used: Pending PR = quantity still not ordered, not closed, status "No PO yet"; PO = still to be delivered > 0 (value to deliver as on the PO page); approval = POs In Approval (state 03) or on the approver list, approver = confirmed or likely; stock = Store locations for Top 5 and Not used for 5 months. If the rules of a page change, change this page too (`prepPR`, `prepIssue`, `prepPO`, `buildApprovals`, `calcStock`).
* Each card fills as its data arrives; a view that fails shows its error in its card.
* **Every tile (the five headline tiles, the tiles of the cards and the alert cards) is a link** that opens the details of the same tile on its page, with the plant and the dates chosen here carried over (see "Links between pages" below). The tiles show a small arrow after the label.
* **Needs a look** (highlights) sits above the tiles. These are alerts worked out from the same figures and the same filters, worst first (red, orange, blue, green); a card is a link to the page with the details. Rules (`highlights()` in the template): Pending PR items older than 1 year; Pending PR items past their delivery date; a Store Issue month at least 4 times the median month (all dates of the chosen plant); POs older than 90 days still waiting for delivery; POs waiting for approval more than 30 days (or a green card when none); Store materials not used for 5 months (orange when they are 25% or more of the Store stock value). A rule with nothing to report shows no card.
* **Print** (button at the top right) prints the page, or saves it as a PDF, in A4 landscape. The menu, filters and buttons are left out and a heading shows the print time, plant, dates and the age of the SAP data.

### Pending PR (`/`)
* Dates and counts follow the **PR creation (requisition) date**, never the release date.
* Purchasing group is shown by name (`PG_NAMES`). The page opens with the date range set to the whole current month; edit it for older data.
* **Every tile opens its details** when clicked (click again to hide; the page scrolls to them; they follow the filters): Pending PR items (one row per PR, oldest first), Net value (by plant, by PR type, the 10 PRs with the most value), Delivery date passed, Older than 1 year and Quantity to check (the items, longest overdue / oldest / biggest quantity first). Long lists show the first 25 with "See all".
  The last three tiles also filter the whole page, as before: the details have a button "Filter the whole page to these N items" (click again to remove it; the same chips show it). An empty group says so and offers no filter.
* Known gap: the CDS view leaves out partly ordered items (status B), so the dashboard shows 494 where SAP shows 503. This can only be fixed in SAP.

### Store Issue (`/issue`)
* Goods movements 201 (issue to a cost center) and 202 (reversal) since 1 Jan 2026. Quantity and value are positive for an issue and negative for a reversal.
* **Department** of a line is the department of **the user who raised the reservation** ("Reservation by"), as the user gave it on 20-Oct-2026 (`ISSUE_USER_DEPT`, 32 users, basis 7). This layer is checked first and replaces the department the cost center would give.
  Only a line without a reservation (direct issue) or a creator who is not in that list falls back to the older layers, first match wins: machine list (cost center base in `RAW`/`EXTRA`/`UNLISTED`),
  department code of an old-style cost center (`CODE_DEPT`), plant-common function (`PLT_FUNC`), the creator's older listed department (`DEPT_USERS`),
  the creator's usual department (at least 20 lines and 75% in one department), else "Unassigned". The basis is kept per line and shown as a tooltip on the Department column.
  Not given: Nipendra Jha (he only posts issues and raises no reservation). To change a user's department edit `ISSUE_USER_DEPT` in `backend/pr_data.py` and restart.
* User IDs are shown by name from `USER_NAMES`; IDs without a name show as the ID.
* **Every tile opens its details** when clicked (click again to hide; the page scrolls to them), and the details follow the filters: Net issue value (issues 201 and reversals 202, and by plant), Issue lines (newest first), Cost centers (department, lines, net value, share), Materials (net quantity, net value, price per unit, last issued). Long lists show the first 25 with "See all".
* **Top 5 most expensive items issued (quantity 1)** is a tile and a card (open by default; click the tile to hide or show). It looks only at issue lines with quantity exactly 1 (reversals are left out), one row per material with its most expensive single-piece issue (value, date, document, cost center, department) and how many times it was issued as one piece. The current filters apply. The tile shows the most expensive piece and the sum of the five.

### Pending Purchase Orders (`/po`)
* The supplier view repeats each item once per supplier row, so lines are **de-duplicated by PO + item**. Delivered and to-deliver quantity come from the status view.
* Delivery filter has two options: *All* and *Pending delivery* (Quantity to be delivered > 0, which includes part-delivered items). Quantity to be delivered sits next to Order quantity.
* Returns items carry a negative quantity and value; asset POs (type ZAST) have no value to deliver.
* Date filter: *Created on* (default) or *PO date*. Release filter: Released, In Approval, Rejected. Material group and purchasing group are shown by name.
* The three value tiles, in this order: **Total order value** (the full order value of the items listed, the delivered part included), **Delivered value** (goods already received x net value / order quantity, the same as SAP's "Delivered Value") and **Pending value** (value still to be delivered). They add up, except for asset POs, which have no delivered or pending value in SAP's terms (about ₹1 Cr in October 2026). The line above the item list repeats the three totals for exactly the items listed (e.g. "413 items in 202 purchase orders · Total order value ... · Delivered value ... · Pending value ..."). All three leave out other-currency items (their number is shown).
  Checked on 20-Oct-2026 against an export of SAP's Purchase Order Items list (October, 758 items): 413 pending items in 202 POs, total ₹97.34 Cr and delivered ₹46.68 Cr equal SAP; pending is ₹49.65 Cr on the dashboard and ₹49.61 Cr in SAP. The ₹3.5 L difference is one item (PO 4500012805 item 10): SAP marks every item with account assignment Asset (A) as "Non-Valuated Goods Receipt" and shows no value to be delivered for it, but the dashboard can only recognise asset POs by their type (ZAST), because the SAP views do not carry the account assignment or the flag (checked: both fields are missing in YY1_PO_ITEM_SUPPLIER_CDS and YY1_PO_ITEM_STATUS_CDS).
* **Value to be delivered** (the INR value of the quantity still to be delivered, as on the PO page: net value x quantity still to deliver / order quantity; asset POs show none, as SAP does) sits next to the quantity: in the PO items list (new column, in the document currency of the item), in the PO lists and the 25-item list of the tiles, and in every summary table (the former "To deliver" column, renamed).
* **Quantity to be delivered** is a column of every summary table (supplier, PO type, plant, material group, purchasing group, month, day) and of the PO lists of the tiles. It adds up the quantity still to be delivered per unit (KG, PC, M2 ...), because a PO or a group can mix units. A table row shows the first 4 units one per line and then "+ N more units" (hover shows all of them), the Total row the first 2; the CSV export has every unit (joined with " + "). The summary cards sit side by side from 1200 px wide (below that one under the other), so the extra column fits.
* **Every tile opens its details** when clicked (click again to hide; the page scrolls to them; they follow the filters): Total order value (by PO type, by plant, the 10 POs with the most value), Delivered value (one row per PO, most delivered value first), Pending value (one row per PO, most value to deliver first, with the quantity still to be delivered and the delivered quantity added up per unit, one unit per line (the CSV joins them with " + "; a PO with nothing delivered shows 0), because the items of a PO can have different units; the PO lists of the other tiles have the same column), Purchase orders (newest first), PO items (by delivery status and the 25 items with the most value), Suppliers (with GSTIN, POs, items, value, to deliver and share). Long lists show the first 25 with "See all".

### PO Approval Pending (`/po-approval`)
* A PO is waiting when its processing state is 03 (In Approval) or it is on the approver list; state 08 is shown as Rejected ("Show" filter: Approval / Other / All).
* SAP's OData views do not carry the approver. Order of use: the confirmed list in `backend/data/po_approvers.csv` (a PO number and the approver name),
  else the **likely** approver from `backend/data/po_approver_rules.csv`, which is a pattern seen on POs whose approver is known, never a confirmed fact.
* Both files are read again on every request. They are not part of the Cloud Run image.
* **Every tile opens its details** when clicked (click again to hide; they follow the filters): POs In Approval (oldest first), Net value (by PO type, by plant, the 10 POs with the most value), PO items (most value first), Suppliers (with the longest wait), Oldest (how long POs have waited, and the 10 that waited longest), and confirmed + likely approver (one row per approver with confirmed and likely POs).

### Store Stock (`/stock`)
* Source `YY1_Store_Stock(P_DisplayCurrency='INR')/Results`, an analytical view with a parameter. The fields selected set the grain
  (material, plant, storage location, stock type, special stock) and the measures (quantity, value) are summed over the rest.
  SAP refuses filters on measures, so all ~27,000 rows are read and rows with zero quantity and zero value are dropped (about 5,200 remain, about 3,400 of them in the listed locations).
* **Only the locations in `backend/data/stock_locations.csv` are shown** (221 locations, read again at every SAP refresh). Columns: `Plant, Storage location, Name, Type`.
  Type `Internal Plant material` marks the I/P stores (1010 ML44-ML79, 1040 MD06-MD11, 2010 MC44-MC79, 2020 MF06/07/09/10/11); every other listed location is `Store` (blank also counts as Store).
  Without the file all locations are shown. Add a row and press Refresh (or wait for the next refresh) to include a location. The key is plant + location (MC08 differs between 2010 and 2020).
* Tables show the value split into Store, Internal Plant material and Total. Stock types: 01 Unrestricted use, 02 Quality inspection, 07 Blocked stock (named by the user); other codes are shown as "Stock type NN" (add a name to `STK` in `stock_template.html`).
* **Every tile opens its details** when clicked (click again to hide; the page scrolls to them), and the details follow the filters:
  Stock value (by plant and stock type), Store value and Internal Plant material value (materials, most value first), Materials with stock, Stock lines,
  Storage locations with stock, In quality inspection (stock type 02), Blocked stock (stock type 07; the tile shows only when there is any), Store locations in your list (all 221 of `stock_locations.csv`, with or without stock; plant and category filters apply).
  One of these is open at a time, under the tiles; long lists show the first 25 with "See all".
* **Top 5 materials** and **Not used for 5 months** cover Store locations only. They are tiles too, with their own tables under the tiles, and open and close independently (Top 5 is open by default).
  An item is one material in one plant. "Used" means a goods issue (stock out) of movement type 201, 221, 241, 261, 281, 291 or 543 (`CONSUME_MVTS`) since 1 Jan 2026,
  in any storage location of the plant. Transfers (311, 321, 343 ...), scrapping, deliveries and returns do not count.
  Not used = no such issue in the last 5 months (the date is shown in the hint). Limits: material received in the last 5 months and not used yet is also listed;
  reversals (262, 202) are not netted; use before 1 Jan 2026 shows as "Not since 01 Jan 2026".
* No date filter: the page is a snapshot of current stock.

## Common behaviour on all pages

* The date range opens as the whole current month and moves with the calendar; edit the dates to look at older data.
* "See all" shows every row (drawn in batches); the heading bar and table headings stay while scrolling; Normal | Dark switch (remembered in the browser).
* **Charts** are drawn by `ui.js` from the summary tables on the page, above the table (the table stays below with its bars): month-wise and day-wise columns (Store Issue, Pending Purchase Orders), department / plant / PO type donuts, ageing columns and approver / plant donuts (PO Approval Pending), category / stock type / plant donuts (Store Stock). A click on a bar, a slice or a legend line does what a click on the table row does (the same filter). They are listed in `CHARTS` at the top of the chart section of `ui.js`: add a line there (page, table id, `cols` or `donut`, which column) to chart another table. Pending PR has its own charts. A donut shows the six biggest slices and "Others"; month labels are thinned out when the chart is narrow.
* The summary tables show a bar behind their value column (the longest bar is the biggest value of that table). The menu tabs have icons and scroll sideways on a phone; on a phone the filters sit in a two column card.
* **Links between pages**: a page opens with a tile's details when its address has `?tile=KEY` (keys: Pending PR `items value overdue old suspect`; Store Issue `val lines ccs mats top`; Pending Purchase Orders `val delivered open pos items sups`; PO Approval Pending `pos val items sups oldest appr`; Store Stock `val store ipm mats lines slocs qi blocked listed vendor top dead`). It can also carry `plant=1010`, `from=2026-10-01&to=2026-10-31` (ISO dates) or `dates=all` (no dates; without any date value the page keeps its current-month default). The link is read once, on the first load; an unknown tile or plant is ignored. The Summary page builds these links (`go()` in `summary_template.html`).
* **CSV**: every card with a table has a small CSV button in its heading (not on the Summary page). It downloads the table as a file that opens in Excel (UTF-8, comma separated), named `page_table_date.csv`. A list that shows only its first 25 rows is opened to all rows for the download and put back. Amounts like "₹1.21 Cr" or "₹39.27 L" are written as whole rupees so Excel can add them up. A card with several tables (a tile's details) puts them one under the other in one file. The code is the CSV block of `ui.js`.
* Keyboard: `/` jumps to the search box; a button at the bottom right brings you back to the top of a long page.
* Dropdown options show no counts; codes are shown with descriptions where a list exists.
* Click a row in a summary table to filter the whole page; the chips under the filters show what is active and clear it.

## Maintaining the lookup data

| What | Where | Needs a restart |
|---|---|---|
| Purchasing group names | `PG_NAMES` in `backend/pr_data.py` | yes |
| Material group names | `MG_NAMES` in `backend/pr_data.py` | yes |
| User names | `USER_NAMES` in `backend/pr_data.py` (an ID without a name is shown as the ID) | yes |
| Department tables, cost center rules | `RAW`, `EXTRA`, `UNLISTED`, `CODE_DEPT`, `PLT_FUNC`, `DEPT_USERS` in `backend/pr_data.py` | yes |
| Stock locations and category | `backend/data/stock_locations.csv` | no (next SAP refresh or Refresh button) |
| Confirmed PO approvers | `backend/data/po_approvers.csv` / `po_approvers.xlsx` (header with "Purchase Order" and "Approver") | no |
| Likely approver rules | `backend/data/po_approver_rules.csv` | no |
| Movement types that count as use | `CONSUME_MVTS` in `backend/pr_data.py` | yes |
| Data start dates | `ISSUE_DATE_FILTER`, `PO_DATE_FILTER` in `backend/pr_data.py` | yes |

## Deploying to Cloud Run

Follow `..\GCP_DEPLOY.md` (secrets in Secret Manager, IAP for access, region asia-south1). The image contains `backend/serve_dashboard.py`, `backend/pr_data.py`, `backend/data/stock_locations.csv`, `backend/data/po_approver_rules.csv` and the whole `frontend/` folder (see `Dockerfile`; the deploy command keeps `--source dashboard_build`). Things to know:

* The new pages have **not been deployed yet**; run the deploy command of Step 5 again to publish them.
* `backend/data/po_approvers.csv` / `po_approvers.xlsx` (the confirmed approvers, an export that is out of date after a day) are not copied into the image, so `/po-approval` on Cloud Run shows only the "likely" approvers from the rules.
* Memory: with all views loaded (about 48,000 issue rows, 66,000 + 34,000 PO rows, 27,000 stock rows and 290,000 goods issue rows read page by page) the server peaked at about 300 MB while loading on a PC and settles near 100 MB, so the deploy guide uses `--memory 1Gi` (512Mi is too tight). Not measured on Cloud Run itself.
* Keep `--max-instances 1`: the caches live in memory and SAP should be called from one place.

## Known limitations

* The real approver of a PO is not in the SAP views; names come from the confirmed list or from inferred rules.
* About 476 Pending PR items have no purchasing group in SAP.
* Items in USD or EUR are shown in document currency (SAP shows INR).
* The SAP user name (the second entry in `USER_NAMES`) of `CB9980000048` (Nikhilesh Pindoliya) and `CB9980000041` (Suresh Kot) is not known and left empty. Department-type PR creators (MRP Controll, Coil divisio, Cup division ...) are shown as SAP gives them, cut at 12 characters, and free-text "Requisitioner" names are not mapped.
* The stock page total for the listed locations was ₹7,59,48,211 on 19 Oct 2026 against ₹7,58,57,011 in the user's SAP report (₹91,200 apart, 0.12%); the cause is not found yet.
  `..\Store_Stock_by_location.xlsx` (summary, by location, all lines) was made to compare it line by line.
