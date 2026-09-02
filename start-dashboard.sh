#!/bin/bash
# =====================================================================
# Khởi chạy Service Monitor Web Dashboard & Desktop Application
# =====================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-48899}"
export PORT

echo "======================================================================"
echo "🚀 Đang khởi động Service Monitor Desktop Application..."
echo "📍 Backend URL: http://localhost:$PORT"
echo "💡 Đóng cửa sổ ứng dụng hoặc bấm Ctrl+C để dừng Dashboard."
echo "======================================================================"

# Kiểm tra nếu có Electron được cài đặt cục bộ hoặc global
if command -v electron &> /dev/null; then
  electron main.electron.js
elif [ -f "./node_modules/.bin/electron" ]; then
  ./node_modules/.bin/electron main.electron.js
else
  # Khởi động Node server nền và mở cửa sổ App Mode trên Windows/Desktop
  node server/index.js &
  SERVER_PID=$!

  sleep 1

  # Phát hiện nếu đang chạy trong WSL2 gọi ra Windows host
  if grep -qEi "(Microsoft|WSL)" /proc/version 2>/dev/null; then
    cmd.exe /c start msedge --app="http://localhost:$PORT" --window-size=1480,920 2>/dev/null || \
    cmd.exe /c start chrome --app="http://localhost:$PORT" --window-size=1480,920 2>/dev/null || \
    cmd.exe /c start "http://localhost:$PORT" 2>/dev/null
  elif command -v google-chrome &> /dev/null; then
    google-chrome --app="http://localhost:$PORT" --window-size=1480,920 &
  elif command -v open &> /dev/null; then
    open "http://localhost:$PORT"
  elif command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:$PORT"
  fi

  wait $SERVER_PID
fi
