# Billiard Shop Microservices

Hệ thống bán gậy bida theo kiến trúc microservices, đã được chỉnh lại để có:

- frontend đa trang kiểu `bida-shop-customer-ui-refresh`
- khu `customer` và `admin` dùng chung một API Gateway
- lớp `SQL adapter` trong Gateway để đọc/ghi trực tiếp `BidaShopDB` trên SQL Server
- bộ microservice gốc vẫn chạy riêng với PostgreSQL và RabbitMQ

Điểm quan trọng: repo này hiện là mô hình `hybrid`.

- Luồng storefront/admin mới dùng `GET/POST /sql/...` qua SQL Server.
- Luồng microservice học phần gốc vẫn dùng `/users`, `/products`, `/orders`, `/inventory`, `/notifications`.

## 1. Kiến trúc hiện tại

### Luồng frontend mới

`Frontend -> API Gateway (/sql/*) -> SQL Server (BidaShopDB)`

Luồng này phục vụ:

- trang chủ
- danh sách sản phẩm
- chi tiết sản phẩm
- giỏ hàng
- tài khoản
- blog / info / review
- admin dashboard

### Luồng microservice gốc

`Client -> API Gateway -> từng service Node.js -> PostgreSQL`

Kết hợp với:

- `RabbitMQ` cho message queue
- `order-service -> inventory-service -> notification-service` cho flow bất đồng bộ

## 2. Thành phần hệ thống

| Thành phần | Port ngoài máy | Vai trò |
|---|---:|---|
| Frontend (nginx) | `5174` | Storefront + admin UI đa trang |
| API Gateway | `8081` | Gateway chung, gồm proxy + SQL adapter |
| RabbitMQ AMQP | `5673` | Message queue cho flow microservice |
| RabbitMQ UI | `15673` | Trang quản trị RabbitMQ |
| User Service | nội bộ | Quản lý người dùng cho flow microservice gốc |
| Product Service | nội bộ | Quản lý sản phẩm cho flow microservice gốc |
| Order Service | nội bộ | Tạo đơn hàng và phát event |
| Inventory Service | nội bộ | Kiểm tra / cập nhật tồn kho |
| Notification Service | nội bộ | Ghi nhận thông báo / sự kiện |

Các service `3001-3005` không publish trực tiếp ra máy host để tránh xung đột cổng. Chúng chỉ được gọi qua `api-gateway`.

## 3. SQL Server dùng cho storefront/admin

Frontend mới đang đọc dữ liệu thật từ SQL Server với cấu hình:

```env
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=BidaShopDB
DB_USER=sa
DB_PASSWORD=1234
DB_ENCRYPT=false
DB_TRUST_SERVER_CERT=true
```

Trong Docker Compose, `api-gateway` kết nối tới host bằng:

```env
SQLSERVER_HOST=host.docker.internal
SQLSERVER_PORT=1433
SQLSERVER_DATABASE=BidaShopDB
SQLSERVER_USER=sa
SQLSERVER_PASSWORD=1234
SQLSERVER_ENCRYPT=false
SQLSERVER_TRUST_SERVER_CERT=true
```

Lưu ý:

- SQL Server phải chạy trên máy host trước khi `api-gateway` khởi động.
- Repo này đang tối ưu cho Windows + Docker Desktop vì dùng `host.docker.internal`.
- Nếu chạy trên Linux, bạn sẽ cần đổi `SQLSERVER_HOST` cho phù hợp.

## 4. Cấu trúc đáng chú ý

```text
api-gateway/
  src/index.js        # proxy microservice + SQL adapter routes
  src/sqlServer.js    # kết nối SQL Server

frontend/
  index.html
  products.html
  product.html
  cart.html
  account.html
  blog.html
  info.html
  review.html
  admin.html
  assets/
    styles.css
    store.js
    frontend.js
    admin.js
    uploads/         # ảnh local copy từ project UI refresh tham chiếu

services/
  user-service/
  product-service/
  order-service/
  inventory-service/
  notification-service/
```

## 5. Cách chạy nhanh

Yêu cầu:

- Docker Desktop
- SQL Server đang chạy ở `localhost:1433`
- database `BidaShopDB` đã có sẵn schema và dữ liệu cần dùng cho frontend

Chạy toàn bộ stack:

```bash
docker compose up --build -d
```

Sau khi chạy:

- Frontend: http://localhost:5174
- API Gateway: http://localhost:8081
- RabbitMQ UI: http://localhost:15673
- RabbitMQ login: `guest / guest`

## 6. Frontend hiện có gì

Frontend đã được tách thành nhiều trang theo phong cách shop thật:

- `/` hoặc `index.html`: trang chủ
- `/products.html`: danh sách sản phẩm
- `/product.html?id=...` hoặc theo slug: chi tiết sản phẩm
- `/cart.html`: giỏ hàng và checkout
- `/account.html`: đăng ký / đăng nhập / đơn hàng người dùng
- `/blog.html`: bài viết
- `/info.html`: thông tin shop / chính sách
- `/review.html`: đánh giá sản phẩm
- `/admin.html`: admin dashboard

Nguồn dữ liệu chính của các trang này:

- `products`, `product_images`, `product_reviews`
- `users`
- `orders`, `order_items`
- `notifications`
- `settings`
- `blog_posts`
- `banners`

## 7. Hai luồng dữ liệu khác nhau

### A. Luồng storefront/admin mới

Luồng này dùng các route `/sql/...` trong `api-gateway/src/index.js`.

Các chức năng chính:

- đăng ký / đăng nhập tài khoản SQL
- đọc danh sách sản phẩm từ `BidaShopDB`
- xem review, blog, banner, settings
- checkout trực tiếp vào bảng `orders` và `order_items`
- admin tạo / sửa / xóa sản phẩm
- admin cập nhật tồn kho trực tiếp trên SQL Server

Lưu ý quan trọng:

- checkout của frontend mới không đi qua RabbitMQ
- nó ghi thẳng vào SQL Server qua `POST /sql/orders/checkout`

### B. Luồng microservice gốc

Luồng này vẫn giữ để phục vụ mô hình microservices của bài toán:

1. Client gọi `POST /orders`
2. `order-service` tạo đơn `PENDING_INVENTORY`
3. `order-service` phát event `order.created`
4. `inventory-service` nhận event và kiểm tra tồn kho
5. nếu đủ hàng thì phát `inventory.updated`
6. nếu thiếu hàng thì phát `inventory.failed`
7. `order-service` cập nhật đơn thành `CONFIRMED` hoặc `CANCELLED`
8. `notification-service` ghi log sự kiện

## 8. API chính

### 8.1. Gateway health

```bash
curl http://localhost:8081/health
curl http://localhost:8081/sql/health
```

### 8.2. SQL adapter routes

#### Public/customer

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/sql/settings` | Lấy cấu hình shop |
| GET | `/sql/banners` | Lấy banner |
| GET | `/sql/blog-posts` | Lấy bài viết |
| GET | `/sql/products` | Lấy danh sách sản phẩm |
| GET | `/sql/products/:slugOrId` | Chi tiết sản phẩm |
| GET | `/sql/reviews?productId=...` | Review theo sản phẩm |
| POST | `/sql/reviews` | Tạo review |
| POST | `/sql/auth/register` | Đăng ký user trong SQL |
| POST | `/sql/auth/login` | Đăng nhập user trong SQL |
| GET | `/sql/orders?userId=...` | Danh sách đơn của user |
| GET | `/sql/orders/:id` | Chi tiết đơn hàng |
| POST | `/sql/orders/checkout` | Tạo đơn trực tiếp trong SQL |
| GET | `/sql/notifications?userId=...` | Thông báo của user |

#### Admin

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/sql/users` | Danh sách user |
| GET | `/sql/inventory` | Danh sách tồn kho |
| PATCH | `/sql/inventory/:productId` | Cập nhật tồn |
| POST | `/sql/products` | Tạo sản phẩm |
| PUT | `/sql/products/:id` | Cập nhật sản phẩm |
| DELETE | `/sql/products/:id` | Xóa sản phẩm |

### 8.3. Legacy microservice routes

| Method | Endpoint gốc qua Gateway | Service đích |
|---|---|---|
| `ANY` | `/users/*` | `user-service` |
| `ANY` | `/products/*` | `product-service` |
| `ANY` | `/orders/*` | `order-service` |
| `ANY` | `/inventory/*` | `inventory-service` |
| `ANY` | `/notifications/*` | `notification-service` |

## 9. Ví dụ gọi API

### Lấy sản phẩm từ SQL Server

```bash
curl http://localhost:8081/sql/products
```

### Đăng ký tài khoản customer trên SQL

```bash
curl -X POST http://localhost:8081/sql/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Nguyen Van A\",\"email\":\"a@example.com\",\"password\":\"123456\",\"phone\":\"0900000000\"}"
```

### Đăng nhập

```bash
curl -X POST http://localhost:8081/sql/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"a@example.com\",\"password\":\"123456\"}"
```

### Checkout bằng SQL adapter

```bash
curl -X POST http://localhost:8081/sql/orders/checkout \
  -H "Content-Type: application/json" \
  -d "{\"userId\":1,\"items\":[{\"productId\":1,\"quantity\":1}],\"paymentMethod\":\"cod\",\"note\":\"Giao buoi toi\"}"
```

### Tạo sản phẩm từ admin flow

```bash
curl -X POST http://localhost:8081/sql/products \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Cuetec AVID Proof\",\"brand\":\"Cuetec\",\"category\":\"Break Cue\",\"price\":12900000,\"description\":\"Co break cho thi dau\",\"imageUrl\":\"/assets/uploads/products/default-product.svg\"}"
```

### Gọi flow microservice cũ

```bash
curl -X POST http://localhost:8081/orders \
  -H "Content-Type: application/json" \
  -d "{\"userId\":1,\"items\":[{\"productId\":1,\"quantity\":2}]}"
```

## 10. Ảnh sản phẩm

Một phần dữ liệu SQL đang tham chiếu ảnh kiểu `/uploads/...` từ project giao diện tham chiếu. Để frontend load được ảnh:

- ảnh đã được copy vào `frontend/assets/uploads`
- frontend cũng có fallback placeholder nếu URL ảnh hỏng hoặc không tồn tại

## 11. Reset môi trường

Nếu muốn xóa các volume PostgreSQL của stack Docker và chạy lại:

```bash
docker compose down -v
docker compose up --build -d
```

Lưu ý: lệnh trên không xóa dữ liệu trong SQL Server host `BidaShopDB`, vì database đó nằm ngoài Docker Compose.

## 12. Ghi chú triển khai

- `api-gateway` hiện là điểm tích hợp quan trọng nhất của repo.
- `frontend` đang ưu tiên trải nghiệm storefront/admin thực tế hơn là demo một trang.
- `services/*` vẫn phù hợp để trình bày kiến trúc microservices, RESTful API, message queue và database-per-service.
- Nếu cần làm thuần microservice hoặc thuần SQL monolith, nên tách README và flow triển khai riêng để tránh lẫn hai mô hình.
