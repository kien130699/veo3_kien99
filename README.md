# Veo3 Kien99 — V1 Clean

Đây là bản viết lại từ đầu. Cây mã V1/V2 cũ đã được loại khỏi nhánh `main`; lịch sử Git vẫn giữ để có thể quay lại commit cũ.

## Mục tiêu của V1

V1 chỉ giữ một luồng đã được kiểm chứng trực tiếp trên Google Flow:

```text
UI local
→ Python/FastAPI
→ Playwright kết nối Edge CDP 9223
→ mở Dự án mới nếu đang ở gallery
→ tìm Slate editor (`data-slate-editor=true`)
→ nhập prompt bằng keyboard thật qua CDP
→ xác minh prompt đã nằm trong editor
→ tìm nút Tạo gần editor
→ click qua Playwright/CDP
→ quan sát tín hiệu submit
```

Không gọi private API, không lấy token, không can thiệp CAPTCHA và không replay request nội bộ.

## Chức năng

- Kết nối Edge thật qua `http://127.0.0.1:9223`.
- Nhận diện trang danh sách dự án và tự bấm `Dự án mới`.
- Nhận diện Slate, ProseMirror, role textbox và textarea.
- Nhập Unicode prompt qua Playwright/CDP.
- Xác minh nội dung trước khi submit.
- Nhận nút `Tạo`, `Create`, `Generate`, `Gerar`, `Crear` và icon `arrow_forward`.
- Có chế độ `current`, `image`, `video`.
- Chụp màn hình trước/sau/lỗi vào `data/screenshots/`.
- Ghi JSONL vào `data/logs/`.
- Có Mock mode để test UI/API không tốn credit.

## Chạy trên Windows

Giải nén rồi chạy:

```bat
START_V1.bat
```

Hoặc chạy riêng:

```bat
scripts\start_edge_9223.bat
run_windows.bat
```

Mở:

```text
http://127.0.0.1:8765
```

Đăng nhập Google trong cửa sổ Edge được mở bằng profile riêng.

## Cách dùng ổn định nhất

1. Trong Flow, chọn thủ công **Ảnh** hoặc **Video**.
2. Trên V1 chọn `Chế độ hiện tại trong Flow`.
3. Nhập một prompt.
4. Bấm `Quét Flow`.
5. Khi ô prompt và nút Tạo được nhận diện, bấm `Gửi prompt`.

Google thường A/B menu mode. Vì vậy tùy chọn tự chuyển Ảnh/Video chỉ là fallback và sẽ dừng với thông báo rõ nếu không tìm được selector.

## Mock test

```bat
run_mock_windows.bat
```

Mock mode không mở Flow và không sử dụng credit.

## Test

```powershell
py -3 -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
pytest -q
```
