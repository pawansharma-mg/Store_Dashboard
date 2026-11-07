# Store Dashboard (Mittal Group)

A live, multi-page dashboard for the store and purchase teams, built on SAP S/4HANA Cloud OData CDS views. A small Python server (standard library only, Python 3.12) reads the SAP views, keeps them in memory and serves twelve pages of plain HTML / CSS / JavaScript. There is no database and no build step. Every page refreshes itself every 30 seconds while it is open, and everything is read-only.

## Pages

| Menu tab | What it shows |
|---|---|
| Summary | The figures of every page on one screen (by plant and date), with the full pages stacked under it |
| Store Issue | Goods issued to cost centres: by department, cost centre, material, month and day |
| Capital Issue | SAP fixed-asset acquisitions (asset transactions) |
| Store Stock | Stock value of the listed store locations, stock in / out by month and day, materials not used for 5 months |
| Pending PR | Purchase requisitions still to be ordered: ageing, plant, purchasing group, month and day |
| Pending Purchase Orders | PO items still to be delivered, with the value to be delivered |
| PO Approval Pending | Every PO that waits for approval in SAP's release workflow, with the real approver and the waiting time |
| Pending Invoice Entry | Supplier invoices entered as inbound deliveries whose goods receipt is not posted yet |
| Purchase | Goods receipts (101) and reversals (102) against POs, delivery time PO to receipt |
| Price Variance | Materials whose purchase rate went up or down, with the rate trend and the loss / profit |
| Payment Ageing | Party-wise balance of the open vendor items: what we have to give and what we have to get, aged |
| Vendor Business | Which vendor we do the most business with: value and % share, what we buy from each, classes A / B / C, and how much each vendor raised its rates |

Every tile opens its details, every list opens the highest value first, and every page has a **Download** menu (PDF): Summary, Details, and **Whole dashboard** (one short file with the Summary and the tiles and graphs of every page).

## Run it

Double-click `Start_Live_Dashboard.bat` (or run `python backend/serve_dashboard.py` inside `dashboard_build`). The dashboard opens at <http://localhost:8765/>. On the first start the server asks for the SAP user and password and keeps them in Windows Credential Manager (encrypted for your Windows user); the password is never written to a file, a log or a page.

## What is left out on purpose

RM (raw material) items, every internal stock transfer (ZSTO, UB), plant 1040 and storage location ML93 are dropped on the server in every view; Payment Ageing leaves out RM parties and the group companies. The one exception: **PO Approval Pending shows every pending PO, RM included.**

## Folders

```
dashboard_build/   the dashboard: backend/ (Python server, SAP access, lookup tables, hand-edited CSV files), frontend/ (the pages), Dockerfile, README.md
GCP_DEPLOY.md      step by step Cloud Run deployment
Start_Live_Dashboard.bat   local launcher
```

The full documentation (every page, every rule, the lookup files, how the live refresh and the PDF download work, deployment and known limits) is in [`dashboard_build/README.md`](dashboard_build/README.md).
