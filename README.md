# 🚀 Service Monitor Dashboard & Generic Service Manager

Công cụ quản lý, điều phối biến môi trường (Env Profiles), quản lý danh sách Microservices động và giám sát log thời gian thực tập trung.

---

## 💻 1. Yêu Cầu Môi Trường (Prerequisites)
- **Node.js**: Phiên bản `>= 18.x`
- **Hệ điều hành**: macOS, Windows (Native / WSL2), Ubuntu / Linux.
- **Trình duyệt Web**: Google Chrome, Microsoft Edge, Brave, Firefox,...

---

## 📦 2. Cài Đặt Dependencies & Khởi Chạy (Quick Start)

### 🔹 Bước 1: Cài đặt thư viện
```bash
cd dashboard
npm install
```

### 🔹 Bước 2: Chạy ứng dụng

#### Cách A: Chạy Web Server (Truy cập `http://localhost:48899`)
```bash
npm start
```

#### Cách B: Chạy Cửa Sổ Desktop App (Electron)
```bash
npm run app
```

---

## 🔨 3. Hướng Dẫn Build & Đóng Gói (Build & Packaging)

### 📦 Đóng gói Standalone macOS App (`.app` và `.zip`)
Để tạo file ứng dụng 1 file duy nhất cho macOS:
```bash
npm run package
# hoặc: npm run dist:mac
```
- **Kết quả xuất ra tại**:
  - `dashboard/release/Service Monitor.app`
  - `dashboard/release/Service-Monitor-mac.zip`

### 🎨 Build Lại Giao Diện Frontend (React / Tailwind)
Nếu có thay đổi giao diện trong thư mục `client/`:
```bash
cd client
npm install
npm run build
```

---

## 🌟 4. Các Tính Năng Chính

1. **🖥️ Service Monitor & Focus Console**:
   - Tích hợp 2 chế độ xem: **Thẻ Lưới (Grid View)** và **Console Chi Tiết (Log View)** trong 1 menu tab duy nhất.
   - Nút Start / Stop / Restart / Pull / Install độc lập.
2. **⚙️ Quản Lý Biến Môi Trường (Env Profiles)**:
   - Hỗ trợ đa profile cho từng service và **Global Shared Config**.
   - Tự động tạo profile cho tất cả services khi thêm Global Profile.
   - Dropdown profile gọn gàng kèm nút **`🗑️ Xóa Env`**, **`📋 Copy .env`**, **`📑 Sao chép từ...`**.
3. **🏷️ Quản Lý Danh Mục (Categories)**:
   - Phân loại nhóm service theo icon và màu sắc.
4. **🧩 Quản Lý Services Độc Lập**:
   - Tự động đọc `.env` / `.env.example` và `package.json` để gợi ý lệnh chạy và thư mục làm việc riêng biệt.
5. **⚡ Auto-Kill Port**:
   - Giải phóng cổng tức thì khi start/restart service, không lo lỗi `EADDRINUSE`.
