FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
# backend: the Python code and the two lists that are part of the dashboard (stock locations, likely approver rules). po_approvers.csv/.xlsx, an export
# from SAP that is out of date after a day, stays on the local PC. frontend: the pages and the logo.
COPY backend/serve_dashboard.py backend/pr_data.py ./backend/
COPY backend/data/stock_locations.csv backend/data/po_approver_rules.csv ./backend/data/
COPY frontend/ ./frontend/
RUN useradd --create-home app
USER app
# Cloud Run sets PORT and K_SERVICE; the SAP login arrives as SAP_USER / SAP_PASSWORD from Secret Manager.
CMD ["python", "backend/serve_dashboard.py"]
