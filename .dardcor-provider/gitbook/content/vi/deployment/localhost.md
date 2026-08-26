# 🏠 Triển khai Localhost

Chạy Dardcor Code trên máy cá nhân để phát triển và dùng cá nhân.

---

## 📦 Cài đặt

Cài đặt Dardcor Code toàn cục qua npm:

```bash
npm install -g dardcor-code
```

**Yêu cầu:**
- Node.js 20 trở lên
- npm 9 trở lên

---

## 🚀 Khởi động Server

Khởi động Dardcor Code với một lệnh duy nhất:

```bash
dardcor-code
```

Dashboard sẽ tự động mở trong trình duyệt tại `http://localhost:3000`

**Cấu hình mặc định:**
- **Dashboard**: `http://localhost:3000`
- **API Endpoint**: `http://localhost:20128/v1`
- **Data Directory**: `~/.dardcor-code`

---

## 🔧 Cấu hình

### Custom Data Directory

Đặt thư mục data tùy chỉnh qua biến môi trường:

```bash
DATA_DIR=/path/to/data dardcor-code
```

### Custom Port

Port API (20128) và port dashboard (3000) được cấu hình trong application. Để đổi, bạn cần sửa source code hoặc dùng biến môi trường nếu được hỗ trợ.

---

## 🛑 Dừng Server

Nhấn `Ctrl+C` trong terminal đang chạy Dardcor Code.

```bash
# In the terminal running dardcor-code
^C  # Press Ctrl+C
```

Server sẽ shutdown an toàn và lưu mọi dữ liệu.

---

## 🔄 Khởi động lại Server

Chỉ cần chạy lệnh start lại:

```bash
dardcor-code
```

Mọi cấu hình, API keys và combos được giữ lại trong thư mục data.

---

## 📊 Cập nhật Dardcor Code

Cập nhật phiên bản mới nhất:

```bash
npm update -g dardcor-code
```

Kiểm tra version hiện tại:

```bash
npm list -g dardcor-code
```

---

## 🔍 Troubleshooting

### Port đã được dùng

Nếu port 20128 hoặc 3000 đã được dùng:

```bash
# Find process using the port (macOS/Linux)
lsof -i :20128
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### Lỗi Permission

Nếu gặp lỗi permission khi cài đặt:

```bash
# Use sudo (not recommended)
sudo npm install -g dardcor-code

# Or fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Vấn đề Data Directory

Nếu thư mục data không truy cập được:

```bash
# Check permissions
ls -la ~/.dardcor-code

# Fix permissions
chmod 755 ~/.dardcor-code
```

---

## 📁 Cấu trúc Data Directory

```
~/.dardcor-code/
├── db.json           # Main database (providers, combos, settings)
├── logs/             # Application logs
└── cache/            # Temporary cache files
```

**Backup Data:**

```bash
# Backup
cp -r ~/.dardcor-code ~/.dardcor-code.backup

# Restore
cp -r ~/.dardcor-code.backup ~/.dardcor-code
```

---

## 🔗 Bước tiếp theo

- [Kết nối Providers](/providers/subscription.md)
- [Tạo Combos](/features/combos.md)
- [Tích hợp với CLI Tools](/integration/cursor.md)
