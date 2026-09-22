# Brainstorm: GitHub Actions CI/CD Release cho Service-Tool (Service Monitor)

## 1. Mục Tiêu (Goal)
Tạo hệ thống tự động build và phát hành (CI/CD Release) tương tự QuickSnag cho dự án **Service-Tool** (thư mục `dashboard`, repo: `hoangthienclub/service-tool`).
Khi push tag `v*` (ví dụ `v1.0.0`) hoặc kích hoạt thủ công (`workflow_dispatch`), GitHub Actions sẽ tự động:
1. Đóng gói ứng dụng desktop native/Electron độc lập cho **macOS (Apple Silicon arm64)** (.zip / .dmg).
2. Đóng gói ứng dụng desktop cho **Windows (x64)** (.zip với `Service Monitor.exe`).
3. Tự động đính kèm các file nén vào GitHub Release kèm link tải trực tiếp và ghi chú phát hành.

## 2. Ràng Buộc & Hiện Trạng (Constraints & Findings)
1. **Kiến trúc ứng dụng**:
   - Giao diện: React 18 + TailwindCSS + Vite (trong thư mục `client/`), biên dịch ra `dist/`.
   - Backend local: Node.js Express server + WebSocket + SSH2 (trong thư mục `server/`).
   - Desktop Shell: Electron wrapper (`main.electron.js`).
2. **Vấn đề phát hiện trong script đóng gói cũ (`scripts/build-mac-app.sh`)**:
   - Đoạn copy `node_modules` cũ chỉ copy thủ công 7 thư mục `cors express cross-spawn tree-kill ssh2 ws safer-buffer`.
   - Kết quả: Khi chạy bên ngoài thư mục dự án, ứng dụng lập tức crash vì thiếu các transitive dependencies của `express` (như `body-parser`, `serve-static`, `send`...).
   - **Giải pháp**: Trong bundle `Resources/app`, chạy `npm install --omit=dev --no-audit --no-fund` để nạp đầy đủ 100% production dependencies độc lập.
3. **Đóng gói Windows**:
   - Tạo script `scripts/build-win-app.ps1` (PowerShell) để giải nén Electron Windows binary, nạp source và production dependencies, đổi tên thành `Service Monitor.exe` và nén thành `Service-Monitor-Windows-x64.zip`.
4. **GitHub Actions**:
   - Sử dụng `macos-14` (Apple Silicon M-series) cho macOS build.
   - Sử dụng `windows-latest` cho Windows build.
   - Sử dụng `ubuntu-latest` với `softprops/action-gh-release@v2` để gom artifacts và tạo Release.

## 3. Tiêu Chí Nghiệm Thu (Acceptance Criteria)
1. Có file `.github/workflows/release.yml` trong repo `service-tool`.
2. Có script đóng gói chuẩn:
   - `scripts/build-mac-app.sh` tạo `Service-Monitor-macOS-arm64.zip` không bị thiếu dependencies.
   - `scripts/build-win-app.ps1` tạo `Service-Monitor-Windows-x64.zip` tự chạy trên Windows 64-bit.
3. GitHub Actions chạy hoàn tất cả 2 job macOS + Windows và tự động tạo GitHub Release với 2 file tải về.
