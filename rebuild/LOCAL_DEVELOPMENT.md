# Chạy local và cấu hình trước khi deploy

Spec daily mô tả luật xử lý. Chạy code rebuild trong `rebuild/`; không chạy bot legacy ở thư mục gốc. Yêu cầu Node.js 24+; Docker cần cho test SQL.

## 1. Test tự động, chưa cần key

Từ thư mục gốc repo:

```sh
npm ci --prefix rebuild
npm test --prefix rebuild
npm run test:db --prefix rebuild
npm run test:runtime --prefix rebuild
```

Test SQL tạo PostgreSQL tạm bằng Docker, chạy migration và kiểm tra daily/bonus/concurrency, rồi tự xóa container. Test runtime tự khởi động Worker, dùng key sinh tạm để kiểm tra chữ ký và routing. Các test này không đăng ký command hay deploy, không cần bot token hoặc Supabase thật.

## 2. Chỗ điền key

```sh
cd rebuild
cp -n .env.example .env
```

Điền toàn bộ cấu hình trong một file `rebuild/.env`. Worker local, tool gửi thử command và lệnh đăng ký Discord đều đọc file này. `.env` đã được Git bỏ qua; chỉ commit `.env.example`. Nếu còn `.dev.vars` từ cấu hình cũ, chuyển giá trị sang `.env` rồi bỏ file cũ vì Wrangler ưu tiên `.dev.vars`.

| Giá trị trong `.env` | Dùng để làm gì |
|---|---|
| `ALLOWED_GUILD_ID` | ID server Discord được phép gọi Worker và đăng ký slash command. |
| `DISCORD_PUBLIC_KEY` | Public Key trong General Information của ứng dụng Discord; xác minh slash interaction. |
| `SUPABASE_URL` | URL project Supabase, dạng `https://<project-ref>.supabase.co`. |
| `SUPABASE_SECRET_KEY` | Key backend dạng `sb_secret_...` trong Supabase Settings → API Keys. |
| `RELAY_SHARED_SECRET` | Secret dùng ký request relay, ít nhất 32 byte; dùng chung với Gateway khi triển khai Sprint 2. |
| `DISCORD_BOT_TOKEN` | Token bot để đăng ký slash command. |
| `DISCORD_APPLICATION_ID` | Application ID của ứng dụng Discord riêng. |

Sinh relay secret bằng lệnh sau, rồi dán kết quả vào `.env`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Nếu dùng key `service_role` JWT cũ, xóa dòng `SUPABASE_SECRET_KEY` và điền `SUPABASE_SERVICE_ROLE_KEY` thay thế. Không để `SUPABASE_SECRET_KEY` trống khi dùng chế độ key cũ: biến mới được ưu tiên và giá trị trống sẽ báo lỗi cấu hình. Không dùng key `anon`/`sb_publishable_...`.

**Connection string database:** Worker không mở kết nối PostgreSQL trực tiếp; nó gọi RPC qua HTTPS nên dùng URL + API key ở trên. Chuỗi `postgresql://...` chỉ cần nếu quản trị/migrate bằng công cụ SQL ngoài; hiện repo không có script đọc `DATABASE_URL`. Có thể áp migration bằng SQL Editor của Supabase, không cần thêm chuỗi kết nối vào Worker.

Cơ chế `.env` theo [tài liệu Cloudflare](https://developers.cloudflare.com/workers/local-development/environment-variables/); loại key backend và quyền `service_role` theo [tài liệu Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

## 3. Chạy Worker local và thử daily với database thật

Tạo **project Supabase development riêng**. Chạy lần lượt trong SQL Editor với quyền owner, mỗi migration một lần:

1. `migrations/001_core.sql`
2. `migrations/002_daily_core.sql`
3. `supabase/migrations/003_daily_bonuses.sql`

Điền `.env`, sau đó chạy trong `rebuild/`:

```sh
npm run dev
```

Mở terminal thứ hai, cũng ở `rebuild/`. Thay các ID ví dụ bằng ID user/channel của bạn; bật Developer Mode trong Discord để Copy ID:

```sh
npm run local:command -- help 234567890123456789 345678901234567890
npm run local:command -- balance 234567890123456789 345678901234567890
npm run local:command -- daily 234567890123456789 345678901234567890
npm run local:command -- balance 234567890123456789 345678901234567890
```

`help` không cần DB hoặc Discord Public Key; chỉ cần guild ID và relay secret hợp lệ. `daily`/`balance` gọi project Supabase đã cấu hình và thực sự cập nhật/đọc dữ liệu ở đó. Đây là Worker local + database development trên Supabase, không phải toàn bộ Supabase chạy offline.

Tool in event ID trước khi gửi. Muốn retry/replay, thêm ID đó làm tham số cuối, giữ nguyên command/user/channel, ví dụ `npm run local:command -- daily 234567890123456789 345678901234567890 456789012345678901`. Lần replay trả đúng receipt cũ, không cộng thưởng lần nữa. Gọi `daily` với event ID mới trong cùng ngày trả cooldown; lần đầu đủ điều kiện nhận 525–724 coin, 100 XP và một box khi không có supporter/marriage bonus.

Tool chỉ gọi loopback `http://127.0.0.1:8787/relay`, ký HMAC đúng protocol và in kết quả trong terminal. Nếu chạy Worker bằng port khác, đặt `OWO_LOCAL_PORT` tương ứng khi gọi tool. Nó không gửi tin nhắn Discord. `hunt`/`zoo` hiện vẫn là prototype; bot đọc prefix `owo ...` cần Gateway ở Sprint 2.

Lỗi thường gặp: `401` kiểm tra relay secret giữa tool và Worker; `503 misconfigured` kiểm tra guild/URL/key; `503 upstream_unavailable` kiểm tra migration, project/key Supabase và Data API. Restart Worker sau khi sửa cấu hình nếu giá trị chưa được cập nhật.

## 4. Đăng ký Discord và chuẩn bị deploy

Trong `rebuild/`, chỉ khi muốn ghi danh sách slash command vào **ứng dụng Discord riêng**:

```sh
npm run register:commands
```

Lệnh này đọc cùng file `.env` và thay danh sách command của ứng dụng trong guild đã chọn. Để Discord gọi slash command, cần endpoint HTTPS public `/interactions`; địa chỉ localhost không đủ.

Khi chuyển lên Cloudflare, điền `ALLOWED_GUILD_ID` ở `wrangler.toml` và đưa từng giá trị vào Worker secrets:

```sh
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put RELAY_SHARED_SECRET
```

Các file local không tự được upload. Không đưa bot token vào Worker. Với key JWT cũ, dùng `SUPABASE_SERVICE_ROLE_KEY` thay cho `SUPABASE_SECRET_KEY`. Cấu hình và lần deploy đầu có thể được tạo/cập nhật bởi các lệnh `secret put`; phần này là thao tác trên Cloudflare thật, không thuộc test local.

Kiểm tra đóng gói mà chưa publish:

```sh
npx wrangler deploy --dry-run
```

Sau khi hoàn tất release gates trong README, `npm run deploy` publish Worker; đặt URL `/interactions` của Worker vào Discord Developer Portal → Interactions Endpoint URL. Test local pass xác nhận phần được kiểm tra; round trip Discord/Supabase thật và các gate tải/backup/Gateway vẫn cần kiểm tra riêng trước production.
