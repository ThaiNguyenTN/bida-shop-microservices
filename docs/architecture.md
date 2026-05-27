# Mô tả kiến trúc hệ thống

> Bản fixed: chỉ mở cổng `8081` cho API Gateway, `5174` cho Frontend và `15673` cho RabbitMQ UI. Các microservice nội bộ không publish cổng `3001-3005` ra máy thật để tránh lỗi `port is already allocated`.


## 1. Tổng quan

Hệ thống quản lý bán gậy bida được thiết kế theo kiến trúc microservice. Mỗi service phụ trách một miền nghiệp vụ riêng và có thể triển khai độc lập.

```text
Frontend
   |
   v
API Gateway
   |---------------- User Service -------- User DB
   |---------------- Product Service ----- Product DB
   |---------------- Order Service ------- Order DB
   |---------------- Inventory Service --- Inventory DB
   |---------------- Notification Service Notification DB

Order Service -- order.created --> RabbitMQ --> Inventory Service
Inventory Service -- inventory.updated / inventory.failed --> RabbitMQ --> Order Service
RabbitMQ events --> Notification Service
```

## 2. Vai trò các service

### User Service

Quản lý thông tin người dùng, đăng ký, đăng nhập và phân quyền cơ bản.

### Product Service

Quản lý danh sách gậy bida, thương hiệu, loại gậy, giá bán và mô tả.

### Order Service

Tạo đơn hàng, lưu đơn hàng, lưu chi tiết đơn hàng và phát message `order.created` sang RabbitMQ.

### Inventory Service

Quản lý tồn kho. Service này lắng nghe message `order.created`, kiểm tra số lượng tồn và trừ kho. Sau khi xử lý, service phát `inventory.updated` hoặc `inventory.failed`.

### Notification Service

Lắng nghe các event từ RabbitMQ và lưu lại thông báo. Dùng để chứng minh hệ thống có log nghiệp vụ và giao tiếp bất đồng bộ.

## 3. Giao tiếp đồng bộ

Client gọi API Gateway bằng HTTP. API Gateway chuyển tiếp request đến các service tương ứng. Đây là giao tiếp đồng bộ RESTful API.

Ví dụ:

- `GET /products`
- `POST /orders`
- `GET /inventory`

## 4. Giao tiếp bất đồng bộ

RabbitMQ được dùng trong luồng xử lý đơn hàng:

- `Order Service` phát `order.created`
- `Inventory Service` nhận `order.created`
- `Inventory Service` phát `inventory.updated` hoặc `inventory.failed`
- `Order Service` cập nhật trạng thái đơn hàng
- `Notification Service` ghi nhận sự kiện

## 5. Xử lý lỗi cơ bản

- Các service có cơ chế chờ kết nối database trước khi khởi động.
- Các service dùng retry khi chờ RabbitMQ sẵn sàng.
- Nếu tồn kho không đủ, đơn hàng chuyển sang trạng thái `CANCELLED`.
- Nếu xử lý message lỗi, message bị `nack` và lỗi được ghi log.

## 6. Trạng thái đơn hàng

| Trạng thái | Ý nghĩa |
|---|---|
| `PENDING_INVENTORY` | Đơn mới tạo, đang chờ kiểm tra tồn kho |
| `CONFIRMED` | Tồn kho đủ, đơn được xác nhận |
| `CANCELLED` | Tồn kho thiếu hoặc xử lý tồn kho lỗi |