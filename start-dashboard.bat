@echo off
REM =====================================================================
REM Khởi chạy Service Monitor Application trên Windows
REM =====================================================================
setlocal enabledelayedexpansion

echo 🚀 Đang khởi động Service Monitor Desktop App...
wsl -e bash -lc "cd $(wslpath '%~dp0') && ./start-dashboard.sh"

pause
