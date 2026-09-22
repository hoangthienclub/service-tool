# Implementation Plan: GitHub Actions Release cho Service-Tool

## Bối Cảnh & Mục Tiêu
Áp dụng cơ chế tự động Release tương tự QuickSnag cho dự án `service-tool` (`dashboard/` -> `git@github.com:hoangthienclub/service-tool.git`).
Tạo quy trình CI/CD hỗ trợ build độc lập 2 nền tảng: macOS (arm64) và Windows (x64) kèm đính kèm file nén trực tiếp vào GitHub Releases.

## Kế Hoạch Từng Bước (Steps)

### Bước 1: Nâng cấp script đóng gói macOS (`scripts/build-mac-app.sh`)
- Sửa lỗi thiếu dependencies (như `body-parser`) bằng cách chạy `npm install --omit=dev --no-audit --no-fund` trong thư mục `Contents/Resources/app`.
- Đảm bảo file zip xuất ra có tên chuẩn `Service-Monitor-macOS-arm64.zip`.

### Bước 2: Tạo script đóng gói Windows (`scripts/build-win-app.ps1`)
- Tạo kịch bản PowerShell chuẩn hóa cho Windows:
  1. Khởi tạo thư mục release `release/Service-Monitor-win-x64`.
  2. Copy runtime Electron x64 từ `node_modules/electron/dist/`.
  3. Đổi tên `electron.exe` thành `Service Monitor.exe`.
  4. Chuẩn bị `resources/app`: chép `package.json`, `main.electron.js`, `server/`, `dist/`.
  5. Đổi entrypoint `main` trong `resources/app/package.json` sang `main.electron.js`.
  6. Chạy `npm install --omit=dev --no-audit --no-fund` trong `resources/app`.
  7. Nén thành `release/Service-Monitor-Windows-x64.zip`.

### Bước 3: Tạo workflow GitHub Actions (`.github/workflows/release.yml`)
- Cấu hình kích hoạt khi push tag `v*` hoặc qua `workflow_dispatch`.
- Job 1: `build-macos` trên `macos-14`:
  - `actions/setup-node@v4` với Node.js 20.
  - `npm ci`
  - `npm run build:client`
  - `bash scripts/build-mac-app.sh`
  - Upload artifact `Service-Monitor-macOS-arm64`.
- Job 2: `build-windows` trên `windows-latest`:
  - `actions/setup-node@v4` với Node.js 20.
  - `npm ci`
  - `npm run build:client`
  - `powershell -ExecutionPolicy Bypass -File scripts/build-win-app.ps1`
  - Upload artifact `Service-Monitor-Windows-x64`.
- Job 3: `release` trên `ubuntu-latest`:
  - Thu thập cả 2 artifacts.
  - Tạo GitHub Release qua `softprops/action-gh-release@v2`.
  - Hiển thị bảng download và mô tả tính năng.

### Bước 4: Cập nhật `package.json`
- Bổ sung lệnh scripts tiện lợi:
  - `"dist:win": "powershell -ExecutionPolicy Bypass -File scripts/build-win-app.ps1"`

### Bước 5: Kiểm tra cục bộ & Commit
- Chạy kiểm tra local syntax và build thử giao diện (`npm run build:client`).
- Commit các thay đổi vào nhánh `develop`.
- Hướng dẫn người dùng push hoặc push tag `v1.0.0` để kích hoạt workflow.

## Kế Hoạch Xác Minh (Verification)
1. Kiểm tra build client: `npm run build:client` tạo `dist/` thành công.
2. Kiểm tra script macOS: `bash scripts/build-mac-app.sh` tạo file zip không còn lỗi thiếu `body-parser`.
3. Kiểm tra GitHub Actions: Sau khi push tag, theo dõi cả 2 job macOS và Windows pass và xuất hiện trên GitHub Releases.
