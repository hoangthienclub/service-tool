# Superpowers Implementation Plan - Giới Hạn Tối Đa 100 Dòng Log Mới Nhất

## Goal
Cấu hình và đồng bộ toàn bộ hệ thống (Node.js Server, SSE Endpoint, API REST và React Frontend) để chỉ lưu trữ và hiển thị tối đa **100 dòng log mới nhất** cho mỗi service. Đảm bảo khi vượt quá 100 dòng, các dòng log cũ hơn sẽ tự động bị loại bỏ (FIFO), giúp tối ưu hóa tối đa RAM và CPU.

## Assumptions
- File giao diện chính phục vụ người dùng là `dist/index.html` (đồng thời đồng bộ file nguồn `client/src/App.jsx`).
- Backend quản lý buffer tại `server/services/process-manager.js` và phát SSE tại `server/index.js`.
- 100 dòng log là hoàn toàn đáp ứng đầy đủ nhu cầu quan sát trạng thái tức thời của các service trong môi trường local development.

## Plan

### Bước 1: Giới hạn Buffer trong Backend Node.js
- **Files**: `server/services/process-manager.js`, `server/index.js`
- **Change**:
  - Trong `server/services/process-manager.js`:
    - Đặt `const MAX_LOG_LINES = 100;` (thay cho 800).
    - Cập nhật hàm `getAllLogs(maxLinesPerService = 100)` mặc định trả về 100 dòng thay vì 300 dòng.
  - Trong `server/index.js`:
    - Cập nhật sự kiện SSE `initial-state`: gọi `processManager.getAllLogs(100)`.
    - Cập nhật endpoint `/api/services/:id/logs`: chỉ trả về tối đa 100 dòng log gần nhất (`slice(-100)`).
- **Verify**:
  - Chạy `node --check server/index.js && node --check server/services/process-manager.js`.
  - Chạy unit test in 250 dòng log vào một service thử nghiệm; kiểm tra `processManager.getLogBuffer('test')` xác nhận độ dài mảng luôn `<= 100`.

### Bước 2: Giới hạn State và DOM Log trong Frontend
- **Files**: `dist/index.html`, `client/src/App.jsx`
- **Change**:
  - Trong `dist/index.html`:
    - Trong listener `service-logs-batch`: Cắt mảng log ở mức 100 dòng: `merged.length > 100 ? merged.slice(-100) : merged`.
    - Trong listener `service-log`: Cắt mảng log ở mức 100 dòng: `merged.length > 100 ? merged.slice(-100) : merged`.
    - Trong sự kiện `initial-state`: Đảm bảo mảng log ban đầu nạp vào state được giới hạn tối đa 100 dòng.
    - Trong `fetchServiceLogs`: Cắt mảng log tải về ở mức 100 dòng.
  - Trong `client/src/App.jsx`:
    - Cập nhật tương tự cho các listener `service-logs-batch` và `service-log` với `slice(-100)`.
- **Verify**:
  - Kiểm tra cú pháp file bằng node script.
  - Kiểm tra độ dài mảng state `logsMap` trong React Component xác nhận không bao giờ vượt quá 100 phần tử.

### Bước 3: Kiểm tra Tổng thể & Xác nhận Hiển thị
- **Files**: Toàn bộ dự án
- **Change**:
  - Khởi động service in log nhanh liên tục (ví dụ chạy lệnh in 500 dòng).
  - Quan sát số lượng dòng hiển thị trên header của terminal: `(100 lines)`.
- **Verify**:
  - Header terminal dừng ở `(100 lines)` và không tăng thêm.
  - Log mới liên tục cuộn mượt mà ở cuối terminal, log cũ biến mất dần.
  - RAM ổn định ở mức tối thiểu.

## Risks & mitigations
- **Rủi ro**: 100 dòng có thể bị trôi nhanh nếu service in log quá nhiều trong 1 giây?
  - *Giải pháp*: Nhờ có cơ chế micro-batching 80ms đã làm ở lượt trước, log được cập nhật theo từng nhịp 80ms, giao diện hiển thị mượt mà không bị giật, developer vẫn theo dõi được đầy đủ các thông tin output mới nhất.

## Rollback plan
- Sử dụng Git checkpoint (`git checkout server/ dist/index.html client/`) để khôi phục lại giới hạn trước đó nếu cần.
