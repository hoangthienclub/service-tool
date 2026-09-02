#!/bin/bash
set -e

# Script đóng gói Service Monitor thành ứng dụng độc lập 1 file (.app & .dmg)
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

APP_NAME="Service Monitor"
RELEASE_DIR="$DIR/release"
TARGET_APP="$RELEASE_DIR/$APP_NAME.app"
DMG_FILE="$RELEASE_DIR/Service-Monitor.dmg"

echo "=========================================="
echo "🚀 Đang đóng gói $APP_NAME cho macOS..."
echo "=========================================="

# 1. Dọn dẹp thư mục build cũ
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# 2. Sao chép Electron.app làm khung nền tảng
echo "📦 1/5. Sao chép Electron framework..."
cp -R "node_modules/electron/dist/Electron.app" "$TARGET_APP"

# 3. Tạo thư mục app trong Resources
echo "📂 2/5. Nạp mã nguồn và giao diện..."
APP_RESOURCES="$TARGET_APP/Contents/Resources/app"
mkdir -p "$APP_RESOURCES"

# Sao chép các file cần thiết
cp "package.json" "$APP_RESOURCES/"
cp "main.electron.js" "$APP_RESOURCES/"
cp -R "server" "$APP_RESOURCES/"
cp -R "dist" "$APP_RESOURCES/"

# Cài đặt / sao chép production node_modules
mkdir -p "$APP_RESOURCES/node_modules"
for dep in cors express cross-spawn tree-kill; do
  if [ -d "node_modules/$dep" ]; then
    cp -R "node_modules/$dep" "$APP_RESOURCES/node_modules/"
  fi
done

# Đảm bảo package.json trong app trỏ main vào main.electron.js
node -e "
const fs = require('fs');
const pkgPath = '$APP_RESOURCES/package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.main = 'main.electron.js';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
"

# 4. Cập nhật Info.plist (Tên hiển thị & Bundle ID)
echo "⚙️ 3/5. Cập nhật thông tin Info.plist..."
PLIST="$TARGET_APP/Contents/Info.plist"
if [ -f "$PLIST" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName '$APP_NAME'" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string '$APP_NAME'" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleName '$APP_NAME'" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleName string '$APP_NAME'" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier 'com.els.servicemonitor'" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string 'com.els.servicemonitor'" "$PLIST" 2>/dev/null || true
fi

# 5. Gỡ bỏ thuộc tính cách ly & ký mã ad-hoc (tránh lỗi macOS chặn)
echo "🔒 4/5. Xử lý quyền thực thi và ký mã (Codesign)..."
xattr -cr "$TARGET_APP" 2>/dev/null || true
codesign --force --deep --sign - "$TARGET_APP" 2>/dev/null || true

# 6. Tạo file nén zip đóng gói 1 file duy nhất
echo "📦 5/5. Tạo file nén ứng dụng độc lập (.zip)..."
ZIP_FILE="$RELEASE_DIR/Service-Monitor-mac.zip"
rm -f "$ZIP_FILE" "$DMG_FILE" 2>/dev/null || true
ditto -c -k --sequesterRsrc --keepParent "$TARGET_APP" "$ZIP_FILE" 2>/dev/null || true

# Thử tạo file .dmg
hdiutil create -volname "$APP_NAME" -srcfolder "$TARGET_APP" -ov -format UDZO "$DMG_FILE" -quiet 2>/dev/null || true

echo "=========================================="
echo "✅ ĐÓNG GÓI THÀNH CÔNG!"
echo "📍 Ứng dụng độc lập (.app): $TARGET_APP"
if [ -f "$DMG_FILE" ]; then
  echo "📍 File đĩa cài đặt (.dmg): $DMG_FILE"
fi
if [ -f "$ZIP_FILE" ]; then
  echo "📍 File nén 1 file duy nhất (.zip): $ZIP_FILE"
fi
echo "👉 Bạn chỉ cần nhấp đúp vào '$APP_NAME.app' là chạy ngay lập tức!"
echo "=========================================="
