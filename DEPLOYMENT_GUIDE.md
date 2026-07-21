# Hướng dẫn Deploy Web-Stream-Studio lên Render

Dự án Web-Stream-Studio là một ứng dụng phức tạp bao gồm frontend (React/Vite) và backend (Express) trong một monorepo sử dụng pnpm workspaces. Việc deploy lên Render sẽ được thực hiện thông qua Docker để đảm bảo môi trường nhất quán và quản lý các dependencies như `ffmpeg`.

## Cấu hình `render.yaml`

File `render.yaml` đã được tạo trong thư mục gốc của dự án với cấu hình cơ bản cho một dịch vụ web:

```yaml
services:
  - type: web
    name: web-stream-studio
    env: docker
    healthCheckPath: /api/healthz
    envVars:
      - key: DATABASE_URL
        sync: false # Đặt giá trị này trong bảng điều khiển Render
      - key: NODE_ENV
        value: production
    # volumes:
    #   - name: hls-data
    #     path: /tmp/hls
```

**Giải thích:**
- `type: web`: Định nghĩa đây là một dịch vụ web.
- `name: web-stream-studio`: Tên của dịch vụ trên Render.
- `env: docker`: Render sẽ sử dụng `Dockerfile` trong thư mục gốc của dự án để build và chạy ứng dụng.
- `healthCheckPath: /api/healthz`: Render sẽ kiểm tra endpoint này để xác định trạng thái hoạt động của ứng dụng.
- `envVars`: Các biến môi trường cần thiết.
  - `DATABASE_URL`: **Bắt buộc**. Bạn cần cấu hình biến này trong bảng điều khiển Render, trỏ đến cơ sở dữ liệu PostgreSQL của bạn. Giá trị `sync: false` có nghĩa là Render sẽ không cố gắng đồng bộ biến này từ file `render.yaml` mà mong đợi bạn cung cấp nó qua giao diện người dùng hoặc API của Render.
  - `NODE_ENV`: Đặt là `production`.
- `volumes`: Phần này được comment (`#`) nhưng được thêm vào để bạn tham khảo. Nếu bạn muốn dữ liệu HLS (được tạo bởi `mediamtx`) được duy trì giữa các lần deploy hoặc khởi động lại dịch vụ, bạn cần uncomment phần này và cấu hình một Render Disk. Đường dẫn `/tmp/hls` là nơi `mediamtx` lưu trữ các file HLS.

## Các bước Deploy lên Render

1.  **Tạo cơ sở dữ liệu PostgreSQL**: Web-Stream-Studio sử dụng PostgreSQL. Bạn cần tạo một dịch vụ PostgreSQL trên Render hoặc sử dụng một dịch vụ DB bên ngoài. Ghi lại `Connection String` của cơ sở dữ liệu này.

2.  **Tạo dịch vụ mới trên Render**: 
    - Đăng nhập vào tài khoản Render của bạn.
    - Chọn 
`New > Web Service`.
    - Chọn repository GitHub của bạn (trinzofc-commits/Web-Stream-Studio).
    - Đặt tên cho dịch vụ (ví dụ: `web-stream-studio`).
    - Chọn `Environment: Docker`.
    - Render sẽ tự động phát hiện `Dockerfile` trong thư mục gốc của dự án.
    - **Branch**: Chọn branch mà bạn muốn deploy (thường là `main` hoặc `master`).
    - **Root Directory**: Để trống hoặc đặt là `./` nếu `Dockerfile` nằm ở thư mục gốc.

3.  **Cấu hình biến môi trường**: 
    - Trong phần cài đặt dịch vụ trên Render, thêm biến môi trường `DATABASE_URL` và dán `Connection String` của cơ sở dữ liệu PostgreSQL của bạn vào đây.
    - Đảm bảo `NODE_ENV` được đặt là `production` (nếu chưa có, Render sẽ tự động thêm từ `render.yaml`).

4.  **Cấu hình Volume (Tùy chọn)**:
    - Nếu bạn muốn dữ liệu HLS được duy trì, hãy tạo một Render Disk và gắn nó vào đường dẫn `/tmp/hls` trong dịch vụ của bạn. Sau đó, bỏ comment phần `volumes` trong `render.yaml`.

5.  **Deploy**: 
    - Nhấn `Create Web Service`.
    - Render sẽ bắt đầu quá trình build Docker image và deploy ứng dụng của bạn.

## Xử lý `mediamtx`

Điểm khó khăn chính là đường dẫn `mediamtx` được hardcode trong `artifacts/api-server/src/lib/rtmpServer.ts` trỏ đến một đường dẫn Nix (`/nix/store/...`). Có hai cách để giải quyết vấn đề này:

1.  **Cài đặt `mediamtx` trong Dockerfile**: 
    - Bạn có thể sửa đổi `Dockerfile` để tải xuống và cài đặt `mediamtx` vào một đường dẫn mà bạn kiểm soát (ví dụ: `/usr/local/bin/mediamtx`).
    - Sau đó, cập nhật biến `MEDIAMTX_BIN` trong `rtmpServer.ts` để trỏ đến đường dẫn mới.
    - **Ví dụ sửa đổi Dockerfile (thêm vào Runner stage):**
    ```dockerfile
    # ... (các lệnh hiện có)
    RUN wget https://github.com/bluenviron/mediamtx/releases/download/v1.12.2/mediamtx_v1.12.2_linux_amd64.tar.gz -O /tmp/mediamtx.tar.gz && \
        tar -xzf /tmp/mediamtx.tar.gz -C /usr/local/bin/ && \
        chmod +x /usr/local/bin/mediamtx
    # ... (các lệnh hiện có)
    ```
    - **Ví dụ sửa đổi `rtmpServer.ts`:**
    ```typescript
    const MEDIAMTX_BIN = process.env.MEDIAMTX_BIN || "/usr/local/bin/mediamtx";
    ```
    - Sau đó, bạn có thể đặt biến môi trường `MEDIAMTX_BIN` trong Render nếu cần.

2.  **Sử dụng một dịch vụ `mediamtx` riêng biệt**: 
    - Deploy `mediamtx` như một dịch vụ riêng biệt trên Render hoặc một nền tảng khác.
    - Cấu hình ứng dụng Web-Stream-Studio để kết nối đến dịch vụ `mediamtx` đó thông qua địa chỉ IP nội bộ hoặc URL công khai.
    - Cách này phức tạp hơn nhưng có thể cung cấp khả năng mở rộng tốt hơn cho `mediamtx`.

**Khuyến nghị**: Đối với lần deploy đầu tiên, phương án 1 (cài đặt `mediamtx` trong Dockerfile) là đơn giản nhất để bắt đầu. Bạn sẽ cần chỉnh sửa `Dockerfile` và file `rtmpServer.ts` trong dự án của mình.

Chúc bạn thành công!
