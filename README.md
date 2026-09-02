# ⚡ Service Monitor & Env Manager

<div align="center">

![Service Monitor Banner](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-38bdf8?style=for-the-badge&logo=apple&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-22c55e?style=for-the-badge&logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-60a5fa?style=for-the-badge&logo=react&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind-CSS-06b6d4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-f59e0b?style=for-the-badge)

<p align="center">
  <b>Bảng điều khiển quản lý Microservices cục bộ, điều phối biến môi trường (Env Profiles) đa tầng và thực thi Custom Scripts 1-click chuyên nghiệp dành cho Developers.</b>
</p>

[Tính Năng Nổi Bật](#-tính-năng-nổi-bật) • [Cài Đặt & Khởi Chạy](#-cài-đặt--khởi-chạy-nhanh) • [Đóng Gói macOS App](#-đóng-gói-ứng-dụng-macos-app) • [Hướng Dẫn Chi Tiết](#-hướng-dẫn-sử-dụng-chi-tiết) • [Cấu Trúc Cấu Hình](#-cấu-trúc-dữ-liệu--cấu-hình)

</div>

---

## 🌟 Tổng Quan Dự Án

Trong quá trình phát triển các hệ thống Microservices hiện đại, lập trình viên thường phải:
- Mở hàng chục tab Terminal để `npm run start:dev` từng service.
- Quản lý và chuyển đổi thủ công hàng loạt file `.env` giữa các môi trường `local`, `dev`, `staging`, `production`.
- Quên kill port khi tiến trình bị treo, dẫn đến lỗi xung đột cổng (`EADDRINUSE`).
- Chạy các đoạn script shell (`./a.sh`, `clone-db.sh`, `seed-data.js`...) một cách rời rạc.

**Service Monitor & Env Manager** được xây dựng để giải quyết triệt để tất cả các vấn đề trên trong một giao diện Dark Mode hiện đại, mượt mà và trực quan!

---

## 🚀 Tính Năng Nổi Bật

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        ⚡ SERVICE MONITOR DASHBOARD                         │
├────────────────────────────────┬───────────────────────────────────────────┤
│  🖥️ 1. Quản Lý Microservices   │  ⚙️ 2. Điều Phối Env Profiles             │
│  - Grid Card & Focus Console   │  - Chuyển Profile 1-Click (Local/Dev/UAT) │
│  - Live Port Monitor & Kill    │  - Kế thừa Global Profile & Overrides     │
│  - Real-time ANSI Terminal     │  - So sánh Diff & Xuất file .env          │
├────────────────────────────────┼───────────────────────────────────────────┤
│  📜 3. Custom Scripts Runner   │  🧩 4. Quản Lý Danh Mục & Services        │
│  - Chọn file trực tiếp Finder  │  - Thêm/Sửa/Xóa Service động              │
│  - Tự động nạp .env & Profiles │  - Kho Templates mẫu phong phú            │
│  - Setup biến ENV tùy chỉnh    │  - Sao lưu / Xuất / Nhập JSON toàn diện   │
└────────────────────────────────┴───────────────────────────────────────────┘
```

### 1. 🖥️ Giám Sát & Điều Khiển Microservices Tập Trung
- **Giao diện 2 chế độ**:
  - **Grid View rộng rãi**: Mỗi service có thẻ riêng kèm trạng thái Live (RUNNING / STARTING / STOPPED / ERROR), PID, Port, Bộ chọn Profile và Terminal mini (340px) tích hợp.
  - **Focus Console View**: Xem chi tiết Terminal toàn màn hình cho 1 service cụ thể, tích hợp nút mở nhanh Swagger UI, Queue Monitor, Kill Port, Config Env.
- **Khởi động / Dừng theo nhóm (Category Groups)**: Bấm `Start Group`, `Stop Group`, `Restart Group` hoặc `Restart All` cho toàn bộ dự án.
- **Giải phóng cổng thông minh (Kill Port)**: Tự động tìm PID chiếm dụng cổng của service và giải phóng tức thì chỉ với 1 cú click.

### 2. ⚙️ Điều Phối Biến Môi Trường (Env Profiles) Đa Tầng
- **Chuyển đổi Profile 1-Click**: Đổi môi trường cho từng service hoặc chuyển đồng loạt toàn bộ hệ thống (`local` ⇄ `development` ⇄ `staging` ⇄ `production`).
- **Cấu trúc 3 tầng linh hoạt**:
  1. `Global Environment Profiles`: Cấu hình các biến dùng chung cho toàn bộ dự án.
  2. `Service Profile Environment`: Biến riêng của từng service theo từng môi trường.
  3. `Local Custom Overrides`: Ghi đè biến cục bộ mà không làm thay đổi file gốc.
- **Trình so sánh Diff trực quan**: Xem nhanh sự khác biệt giữa các Profile trước khi áp dụng.
- **Xuất file `.env`**: Tự động tổng hợp và xuất ra file `.env` chuẩn tại thư mục của service.

### 3. 📜 Trình Quản Lý & Chạy Custom Scripts Độc Lập
- **Chọn file Finder Native**: Bấm `📁 Chọn File Finder` để mở ngay hộp thoại chọn file của macOS để chọn `.sh`, `.ts`, `.js`, `.py`.
- **Tự động sinh lệnh & Runner**: Tự động gợi ý `bash ./a.sh`, `pnpm ts-node ...`, `node ...`, `python3 ...`.
- **🌿 Tự động nạp `.env` & Profile của Service**:
  - Chọn thư mục làm việc CWD ➜ Hệ thống tự động nhận diện và nạp các biến từ file `.env` hoặc Profile của service tương ứng.
- **🔧 Cấu hình biến ENV bổ sung**: Cho phép nhập thêm các biến `KEY=VALUE` riêng biệt cho từng script.
- **Console Output toàn màn hình**: Theo dõi tiến trình và log màu ANSI thời gian thực qua Server-Sent Events (SSE).

### 4. 🧩 Quản Lý Danh Mục & Services Động
- **Không cần sửa code**: Thêm mới, chỉnh sửa, nhân bản hoặc xóa service trực tiếp trên giao diện web.
- **Kho Templates sẵn có**:
  - `NestJS API (TypeScript)`
  - `Express / Node.js Server`
  - `Next.js / Vite React Frontend`
  - `FastAPI / Flask Python`
  - `Background Worker / Consumer`
- **Sao lưu & Đồng bộ**: Xuất file JSON toàn bộ cấu hình để chia sẻ cho đồng đội hoặc import cấu hình dự án mới trong 1 giây.

### 5. ⚡ Quick Actions (Tác Vụ Nhanh Toàn Hệ Thống)
- **⬇️ Sync Code**: Tự động `git pull` đồng loạt toàn bộ repositories trong workspace.
- **📦 Install Dependencies**: Tự động phát hiện `pnpm-lock.yaml`, `yarn.lock` hoặc `package.json` để chạy lệnh cài đặt thư viện phù hợp.
- **🧹 Clean Cache & Dist**: Dọn dẹp `dist/`, `.turbo/`, `node_modules/.cache` giúp làm sạch workspace.

---

## 📦 Cài Đặt & Khởi Chạy Nhanh

### 📋 Yêu cầu hệ thống:
- **Node.js**: Phiên bản `>= 18.x`
- **Hệ điều hành**: macOS (M1/M2/M3/Intel), Windows (Native / WSL2), Ubuntu/Linux.

### 🔹 Bước 1: Clone mã nguồn & Cài đặt
```bash
git clone https://github.com/your-username/service-monitor.git
cd service-monitor/dashboard
npm install
```

### 🔹 Bước 2: Khởi chạy

#### Cách A: Chạy Web Dashboard (Truy cập `http://localhost:48899`)
```bash
npm start
# hoặc: npm run dev
```

#### Cách B: Chạy dưới dạng Desktop App (Electron)
```bash
npm run app
```

---

## 🔨 Đóng Gói Ứng Dụng macOS (.app)

Ứng dụng hỗ trợ đóng gói thành file **Native macOS Standalone App (.app)** 1 file duy nhất, không cần cài đặt phức tạp:

```bash
cd dashboard
npm run package
```

**📍 Kết quả xuất ra tại:**
- `dashboard/release/Service Monitor.app` (Nhấp đúp chuột là chạy ngay)
- `dashboard/release/Service-Monitor-mac.zip` (Dễ dàng chia sẻ hoặc gửi qua Slack/Telegram)

---

## 📖 Hướng Dẫn Sử Dụng Chi Tiết

### 1️⃣ Khởi động và giám sát Microservices
1. Mở ứng dụng ➜ Màn hình **🖥️ Service Monitor** sẽ hiển thị danh sách các services được gom nhóm theo Danh mục.
2. Bấm nút **`▶ Start`** trên từng thẻ service để khởi động, hoặc bấm **`Start Group`** ở đầu mỗi nhóm.
3. Muốn xem chi tiết log chuyên sâu, bấm nút **`📺 Console`** để chuyển sang chế độ **Focus Console View**.

### 2️⃣ Quản lý Biến Môi Trường (Env Profiles)
1. Chọn tab **`⚙️ Biến Môi Trường & Cấu Hình`** trên Sidebar.
2. Chọn Service cần chỉnh sửa ➜ Chọn Tab Profile (`local`, `dev`, `staging`...).
3. Bạn có thể:
   - Thêm / Sửa các cặp `KEY=VALUE`.
   - Xem bảng **So sánh Diff** giữa các Profile.
   - Bấm **`💾 Xuất ra .env`** để ghi thẳng nội dung cấu hình vào file `.env` của project.

### 3️⃣ Chạy Script Tùy Chỉnh (Custom Scripts)
1. Chọn tab **`📜 Quản Lý Scripts`** trên Sidebar.
2. Bấm **`➕ Thêm Script Mới`**:
   - Chọn **Thư mục làm việc (CWD)**: Chọn Workspace Root hoặc Service cụ thể (hệ thống sẽ tự động nạp các biến `.env` tương ứng).
   - Bấm **`📁 Chọn File Finder`** để nhấp chọn file `.sh` hoặc `.js` từ máy.
   - Nhập thêm biến môi trường riêng (nếu cần) vào ô Textarea `KEY=VALUE`.
3. Bấm **`▶ Chạy Ngay`** ➜ Theo dõi luồng log chạy trực tiếp trên màn hình Console bên phải!

---

## 📂 Cấu Trúc Dữ Liệu & Cấu Hình

Toàn bộ dữ liệu tùy chỉnh của người dùng được lưu trữ bền vững tại:
`dashboard/data/user-profiles.json`

```json
{
  "workspaceRoot": "/path/to/your/workspace",
  "activeGlobalProfile": "default",
  "globalProfiles": {
    "default": {
      "env": { "NODE_ENV": "development", "TIMEZONE": "Asia/Ho_Chi_Minh" }
    }
  },
  "activeProfiles": {
    "api-gateway": "local",
    "auth-service": "local"
  },
  "globalScripts": [
    {
      "id": "gscript_01",
      "name": "Sync Database UAT",
      "command": "bash ./scripts/sync-db.sh",
      "cwdType": "auth-service",
      "icon": "🗄️",
      "rawEnv": "DEBUG=true\nSYNC_LIMIT=500"
    }
  ]
}
```

---

## 🛠️ Công Nghệ Sử Dụng

- **Frontend**: React 18, Tailwind CSS, Heroicons / Lucide Icons, Ansi-to-HTML parser.
- **Backend Server**: Node.js Native HTTP / Express, Server-Sent Events (SSE) log streaming.
- **Process Management**: `cross-spawn`, `tree-kill`, POSIX signals.
- **Desktop Framework**: Electron, AppleScript (`osascript`) macOS Finder Integration.

---

## 🤝 Đóng Góp & Phát Triển (Contributing)

Mọi đóng góp, báo lỗi (Issues) và Pull Requests đều được hoan nghênh!
1. Fork dự án
2. Tạo nhánh tính năng (`git checkout -b feature/AmazingFeature`)
3. Commit thay đổi (`git commit -m 'Add some AmazingFeature'`)
4. Push lên branch (`git push origin feature/AmazingFeature`)
5. Mở Pull Request

---

## 📄 Giấy Phép (License)

Dự án được phân phối dưới giấy phép **MIT License**. Tự do sử dụng, chỉnh sửa và phân phối cho mục đích cá nhân và thương mại.

<div align="center">
  <sub>Được xây dựng với sự đam mê dành cho cộng đồng lập trình viên Microservices 🚀</sub>
</div>
