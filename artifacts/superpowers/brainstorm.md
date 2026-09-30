# Superpowers Brainstorm - Giới Hạn Tối Đa 100 Dòng Log Mới Nhất

## Goal
Giới hạn số lượng dòng log tối đa được lưu trữ và hiển thị ở cả Frontend và Backend xuống đúng **100 dòng log mới nhất** cho mỗi service, giúp cắt giảm tối đa việc chiếm dụng bộ nhớ RAM và tối ưu hóa hiệu năng render terminal.

## Constraints
- Đảm bảo khi số dòng log vượt quá 100, các dòng log cũ nhất sẽ tự động bị loại bỏ theo cơ chế FIFO (First In First Out).
- Áp dụng đồng bộ từ Server backend (RAM của Node.js), API trả về (`initial-state`, `/api/services/:id/logs`), đến React State và DOM trong `TerminalView`.
- Không ảnh hưởng đến các tính năng khác như filter tìm kiếm, tự động cuộn (auto-scroll) và xóa log thủ công.

## Known context
- Hiện tại:
  - Backend `server/services/process-manager.js` đang đặt `MAX_LOG_LINES = 800` và `getAllLogs(300)`.
  - Frontend `dist/index.html` và `client/src/App.jsx` đang lưu trữ và cắt mảng ở mức 400 dòng (`slice(-400)`).
- Khi người dùng chạy nhiều service cùng lúc (10-20 services), việc giảm từ 400 dòng xuống 100 dòng sẽ giảm thêm 75% số lượng object và DOM node trong bộ nhớ trình duyệt, đưa RAM về mức tối thiểu tuyệt đối (~80MB - 120MB).

## Risks
- Với các service có stack trace dài (ví dụ lỗi database hoặc exception đa tầng dài > 100 dòng), log lỗi chi tiết lúc khởi động có thể bị trôi nếu service tiếp tục in thêm nhiều dòng log sau đó.
  - *Giải pháp*: 100 dòng vẫn hoàn toàn đáp ứng tốt việc kiểm tra trạng thái hoạt động tức thời của service dev cục bộ. Người dùng vẫn có thể xem lại log chi tiết nếu cần qua terminal hệ thống.

## Options (2–4)

### Phương án 1: Cắt giảm đồng bộ 100 dòng trên toàn hệ thống (Khuyên dùng)
- **Backend (`process-manager.js` & `server/index.js`)**:
  - Đặt `MAX_LOG_LINES = 100`.
  - Cập nhật `getAllLogs(100)` mặc định cho sự kiện `initial-state` và endpoint `/api/services/:id/logs`.
- **Frontend (`dist/index.html` & `client/src/App.jsx`)**:
  - Cắt mảng log ở mức 100 dòng (`slice(-100)`) trong cả hai listener `service-log` và `service-logs-batch`.
- **Ưu điểm**: Nhất quán hoàn toàn, siêu nhẹ, RAM giảm về mức tối thiểu tuyệt đối, không có độ lệch giữa frontend và backend.
- **Nhược điểm**: Backend không giữ thêm log đệm phòng khi người dùng muốn cuộn xa hơn 100 dòng.

### Phương án 2: Backend giữ 200 dòng (Buffer đệm), Frontend chỉ render 100 dòng
- Backend lưu 200 dòng trong memory buffer. Khi người dùng mở trang hoặc xem card, frontend chỉ nhận và hiển thị 100 dòng mới nhất.
- Khi người dùng mở rộng Popout Fullscreen Terminal, có thể tải xem tối đa 200 dòng.
- **Ưu điểm**: An toàn hơn một chút cho các lỗi khởi động dài.
- **Nhược điểm**: Vẫn tốn thêm RAM trên server, không hoàn toàn đồng nhất với yêu cầu "chỉ giữ lại 100 dòng log".

## Recommendation
Khuyên dùng **Phương án 1**: Triển khai giới hạn 100 dòng đồng bộ trên toàn bộ luồng xử lý (Backend buffer 100, Initial state 100, Frontend state 100). Đúng chuẩn yêu cầu của người dùng, cực kỳ nhẹ và đơn giản.

## Acceptance criteria
1. `MAX_LOG_LINES` trong `server/services/process-manager.js` được cấu hình là 100.
2. Endpoint SSE `/api/events` (`initial-state`) và `/api/services/:id/logs` chỉ trả về tối đa 100 dòng log gần nhất cho mỗi service.
3. State `logsMap` trong frontend (`dist/index.html` và `client/src/App.jsx`) luôn giữ tối đa 100 dòng (`slice(-100)`).
4. Terminal trong mỗi Service Card hiển thị nhãn `(X lines)` với `X <= 100`.
5. Khi service in log liên tục, các dòng mới được nối vào cuối và các dòng cũ hơn 100 bị đẩy ra ngoài mượt mà, không giật lag.
