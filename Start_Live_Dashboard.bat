@echo off
title Store Pending PR - live dashboard
cd /d "%~dp0dashboard_build\backend"
python serve_dashboard.py
echo.
pause
