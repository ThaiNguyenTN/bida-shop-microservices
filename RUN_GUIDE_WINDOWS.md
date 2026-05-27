# Hướng dẫn chạy trên Windows

> Bản fixed: chỉ mở cổng `8081` cho API Gateway, `5174` cho Frontend và `15673` cho RabbitMQ UI. Các microservice nội bộ không publish cổng `3001-3005` ra máy thật để tránh lỗi `port is already allocated`.


Bản này là **Node.js microservice**. Không cần Java, không cần Maven.

## 1. Dọn container cũ nếu từng chạy bản trước

Mở PowerShell tại thư mục project rồi chạy:

```powershell
docker compose down --remove-orphans
```

Nếu còn container cũ tên `billiard-rabbitmq`, xóa bằng:

```powershell
docker rm -f billiard-rabbitmq
```

## 2. Chạy hệ thống

```powershell
docker compose up --build -d
```

## 3. Kiểm tra container

```powershell
docker ps
```

## 4. Mở các địa chỉ

- Frontend: http://localhost:5174
- API Gateway: http://localhost:8081
- RabbitMQ: http://localhost:15673
  - Username: `guest`
  - Password: `guest`

## 5. Test nhanh

```powershell
curl http://localhost:8081/health
```

Thêm tồn kho cho sản phẩm 1:

```powershell
curl -X PATCH http://localhost:8081/inventory/1 -H "Content-Type: application/json" -d '{"quantity":20}'
```

Tạo đơn hàng:

```powershell
curl -X POST http://localhost:8081/orders -H "Content-Type: application/json" -d '{"userId":1,"items":[{"productId":1,"quantity":2}]}'
```

Xem đơn hàng:

```powershell
curl http://localhost:8081/orders
```

Xem thông báo:

```powershell
curl http://localhost:8081/notifications
```