@echo off
REM =====================================================================
REM Khởi chạy Service Monitor Application trên Windows / WSL2
REM =====================================================================
setlocal enabledelayedexpansion

echo ======================================================================
echo 🚀 Đang khởi động Service Monitor Dashboard...
echo ======================================================================

set CURRENT_DIR=%~dp0
set REST_PATH=%CURRENT_DIR:~2%
set REST_PATH=%REST_PATH:\=/%

REM Trường hợp 1: Nếu đường dẫn nằm trên ổ đĩa mạng mapped từ WSL (ví dụ Z:\home\...)
if /i "%REST_PATH:~0,6%"=="/home/" (
    echo 📍 Phát hiện đường dẫn WSL: %REST_PATH%
    wsl -e bash -lc "cd '%REST_PATH%' && ./start-dashboard.sh"
    goto :eof
)

REM Trường hợp 2: Thử chuyển qua wslpath
for /f "tokens=*" %%i in ('wsl wslpath "%~dp0" 2^>nul') do set WSL_DIR=%%i
if defined WSL_DIR (
    echo 📍 Đường dẫn WSL: %WSL_DIR%
    wsl -e bash -lc "cd '%WSL_DIR%' && ./start-dashboard.sh"
    goto :eof
)

REM Trường hợp 3: Fallback tìm tự động thư mục service-tool trong WSL /home
echo 🔍 Đang định vị thư mục service-tool trong WSL...
wsl -e bash -lc "DIR=\"$(find /home -maxdepth 4 -type d -name 'service-tool' 2>/dev/null | head -n 1)\"; if [ -n \"$DIR\" ]; then echo \"📍 Tìm thấy tại: $DIR\" && cd \"$DIR\" && ./start-dashboard.sh; else echo '❌ Không tìm thấy thư mục service-tool trong WSL!'; fi"

pause
