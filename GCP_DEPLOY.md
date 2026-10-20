# Mittal Group dashboard (Summary, Pending PR, Store Issue, Pending Purchase Orders, PO Approval Pending, Store Stock): GCP (Cloud Run) par live deploy

Dashboard Cloud Run par chalega, SAP se data fresh khinchega (Pending PR ka 5 minute ka cache, baaki bade views ka 30 minute ka), aur sirf aapke diye hue Google accounts khol payenge (IAP).
Code `dashboard_build/backend` (Python server) aur `dashboard_build/frontend` (pages) me hai; `dashboard_build/README.md` me poori detail hai.
SAP ka password Secret Manager mein rahega. Kisi file, chat ya code mein nahi.

Saare commands **PowerShell** ke hain. `PROJECT_ID`, `USER_EMAIL` jaisi capital cheezein apni value se badlo.

## Step 0: Pehle local PC par ek baar real SAP se test karo (5 minute)

`Start_Live_Dashboard.bat` double-click karo, SAP user aur password type karo.
Dashboard khulna chahiye aur upar "Live from SAP · updated hh:mm" dikhna chahiye.
Yeh test GCP par jaane se pehle real SAP ke saath code ko check karta hai. Agar yahan error aaye to GCP par bhi aayega.

Saare data aa jane ke baad (pehli baar 1-2 minute) ek aur check chalao, jo batata hai ki kaunsa page/API nahi chal raha aur kis naam, description ya approver ki list me kami hai:

```powershell
cd "C:\Ankur Project\Mittal Plant work\CDS_VIEW_TESTING\dashboard_build\backend"
python check_data.py
```

## Step 1: Sahi account aur project chuno

```powershell
gcloud auth list
gcloud config set project PROJECT_ID
gcloud config get-value project
```

Is PC par gcloud pehle se kisi aur account (`@ankur.farm`) par login tha. Apna sahi account chuno:
`gcloud auth login` (browser khulega), phir `gcloud config set account USER_EMAIL`.
Project mein Billing on honi chahiye.

## Step 2: APIs on karo

```powershell
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iap.googleapis.com
```

## Step 3: SAP login ko Secret Manager mein rakho (browser mein, password yahin type karna)

Google Cloud Console, phir **Security, Secret Manager, Create secret**.

| Secret name | Value |
|---|---|
| `sap-user` | SAP communication user (jo basic auth ke liye hai) |
| `sap-password` | uska password |

Password sirf Console ke box mein type/paste karo. Terminal mein mat likho.

## Step 4: Cloud Run ko secrets padhne ki permission do

```powershell
$PN = gcloud projects describe PROJECT_ID --format="value(projectNumber)"
$SA = "$PN-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding sap-user     --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding sap-password --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor
```

Agar deploy ke waqt build permission error aaye, yeh bhi chalao:

```powershell
gcloud projects add-iam-policy-binding PROJECT_ID --member "serviceAccount:$SA" --role roles/cloudbuild.builds.builder
```

## Step 5: Deploy (project folder `CDS_VIEW_TESTING` se chalao)

```powershell
cd "C:\Ankur Project\Mittal Plant work\CDS_VIEW_TESTING"
gcloud run deploy store-pending-pr `
  --source dashboard_build `
  --region asia-south1 `
  --no-allow-unauthenticated --iap `
  --max-instances 1 --memory 1Gi --no-cpu-throttling `
  --set-secrets "SAP_USER=sap-user:latest,SAP_PASSWORD=sap-password:latest"
```

`--no-cpu-throttling` isliye hai ki SAP se naya data peeche (background) mein aata hai. Iske bina Cloud Run request ke baad CPU rok deta hai aur naya data der se aata hai.

`--memory 1Gi` isliye hai ki ab 5 bade views (Store Issue ~48,000 lines, PO ~66,000 + 34,000, Stock ~27,000 + 2.9 lakh goods issue lines) ek saath memory me rehte hain. Is PC par load ke waqt server ki peak memory ~300 MB nikli, to pehle wala 512Mi tang tha. Agar Cloud Run me "out of memory" ya container restart dikhe to isse badhao.

`--max-instances 1` isliye hai ki SAP ko ek hi jagah se calls jayein (galat password par account lock hone ka risk bhi kam).
`--no-allow-unauthenticated --iap` isliye hai ki URL public na ho.

## Step 6: IAP ko service chalane do aur users ko access do

```powershell
gcloud run services add-iam-policy-binding store-pending-pr --region asia-south1 `
  --member "serviceAccount:service-$PN@gcp-sa-iap.iam.gserviceaccount.com" --role roles/run.invoker

gcloud iap web add-iam-policy-binding --region asia-south1 --resource-type cloud-run --service store-pending-pr `
  --member "user:USER_EMAIL" --role roles/iap.httpsResourceAccessor
```

Pehli command fail ho ("service account does not exist") to pehle yeh chalao, phir dobara try karo:
`gcloud beta services identity create --service=iap.googleapis.com`

Har user ke liye doosri command ek baar chalani hai. Poore group ke liye `--member "group:GROUP_EMAIL"` use karo.
Dashboard ka link: `gcloud run services describe store-pending-pr --region asia-south1 --format="value(status.url)"`.
Link kholne par Google login aayega, jisko access diya hai wahi dekh payega.

## Baad mein

| Kaam | Kya karna hai |
|---|---|
| Code ya dashboard badalna | Step 5 ka deploy command dobara chalao |
| Stock ki locations badalna | `backend/data/stock_locations.csv` me row add/hatao, phir Step 5 dobara chalao (Cloud Run me ye file image ke andar hai; local PC par har refresh par dobara padhi jaati hai) |
| Naam / department / approver rules badalna | `backend/pr_data.py` (naam, department) ya `backend/data/po_approver_rules.csv` (likely approver), phir Step 5 dobara chalao |
| SAP password badalna | Secret Manager mein `sap-password` ka new version add karo, phir Step 5 dobara chalao (naya revision) |
| Galat password ya SAP error | Logs: Cloud Run, store-pending-pr, Logs. Dashboard par bhi lal dot ke saath message dikhta hai |
| Data kitna fresh hai | Server SAP se max 5 minute purana data deta hai. Page ka Refresh button 30 second se jaldi dobara SAP nahi bulata |
| Band karna | `gcloud run services delete store-pending-pr --region asia-south1` |

## Dhyan rakhne ki baatein

- **SAP ki taraf IP allowlist** ho to Cloud Run ke IP SAP tak nahi pahunchenge. Tab Cloud NAT se fixed outbound IP lagana padega. Step 0 pass ho aur GCP par "Could not reach SAP" aaye to yahi wajah hogi.
- **SAP user** ko in CDS views ka read access chahiye (Power BI wala user chal sakta hai): `YY1_STORE_PENDING_PR_CDS`, `YY1_STORE_RESERVATION_CDS`, `YY1_PO_ITEM_SUPPLIER_CDS`, `YY1_PO_ITEM_STATUS_CDS`, `YY1_STORE_STOCK_CDS`.
- **Approver ke confirmed naam** (`po_approvers.xlsx/.csv`, SAP se export) Cloud Run image me nahi jaate; wahan PO Approval page par sirf "likely" approver (rules se) dikhta hai. Confirmed naam sirf local PC par dikhte hain.
- **Cost:** Idle rehne par lagbhag zero. Dashboard kholte hi pehli baar 1-2 minute lag sakte hain (SAP se bada data aata hai); baad me turant khulta hai.
- **Region:** `asia-south1` (Mumbai). Badalna ho to har command mein `--region` badlo.
