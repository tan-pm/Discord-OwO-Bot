# Báo cáo Sprint 1 — Hybrid Gateway + Serverless Engine

Trạng thái: Sprint1 hoàn tất và QA local đạt; chờ user sign-off, chưa deploy. Bắt đầu 2026-11-08 18:47 UTC, giới hạn đến 19:17 UTC. Hoàn tất18:56 UTC (~9 phút, trong timebox30 phút).

## Kết quả triển khai

- Chốt kiến trúc thin Gateway relay → Cloudflare Worker → Supabase PostgreSQL. Gateway giữ kết nối Discord và gửi reply; Worker giữ toàn bộ xử lý game; PostgreSQL giữ trạng thái/transaction.
- Khởi tạo shared context, registry, directory locks và board trong `.scrum/`. Tối đa bốn agent chạy đồng thời; các role chạy theo từng đợt, không ghi đè thư mục của nhau. Dùng model khả dụng `gpt-6.1-sol` cho subagents; không giả lập các model GPT-4o/o3/o4-mini không còn trong danh sách runtime.
- Hai ingress dùng chung NormalizedCommandContext và RPC `play(interaction,guild,player,action)`: slash/readonly component qua Ed25519; prefix relay qua HMAC-SHA256.
- Payload relay giới hạn16KiB, kiểm tra timestamp ±300 giây, HMAC trên timestamp + dấu chấm + raw body; không nhận rank/reward/clock do client gửi. Receipt relay có namespace riêng và được bind vào guild/user/action.
- Guild config rỗng/template bị từ chối cho mọi lệnh. Signed PING chỉ cần public key hợp lệ để kiểm tra endpoint; không cấp quyền economy.
- Daily giữ công thức game gốc: base `min(500+floor(U*200)+25*streak,5000)`, XP100 và một box50/50. Streak không reset sau ngày bỏ lỡ vì legacy override đang bật.
- Thêm supporter rank>=3 do SQL owner quản lý, nhân đôi base tiền sau cap; marriage/catch-up một lần mỗi ngày; Valentine nhân đôi tiền marriage sau cap và ba marriage boxes/người.
- Các phần thưởng, trạng thái cặp đôi và receipt commit cùng transaction. Khóa theo receipt → guild gate → marriage row → player rows đã sort. Guild gate ưu tiên tính đúng trong bản private nhỏ; throughput phải đo lại trước khi mở rộng.
- Giữ nguyên legacy `src/`, `secret/`, entrypoint và root manifests. Không đọc/in secret/env, không đăng ký command hoặc deploy dịch vụ ngoài.

## File bàn giao

| Thành phần | Đường dẫn |
|---|---|
| Shared brain | `.scrum/PROJECT_CONTEXT.md` |
| Registry/locks | `.scrum/AGENTS_REGISTRY.md` |
| Sprint board | `.scrum/SPRINT_BOARD.md` |
| Backlog sáu sprint | `.scrum/PRODUCT_BACKLOG.md` |
| Architecture/contract | `.scrum/ARCHITECTURE_SPEC.md`, `rebuild/src/contracts/commands.js` |
| Legacy extraction | `.scrum/specs/hybrid_sprint_01_daily.md` |
| Unified ingress | `rebuild/src/worker.js` |
| Migration mới | `rebuild/supabase/migrations/003_daily_bonuses.sql` |
| Hướng dẫn SQL owner | `rebuild/supabase/README.md` |
| Setup và relay protocol | `rebuild/README.md` |
| QA chi tiết | `.scrum/QA_TEST_REPORT.md` |
| Sprint log | `.scrum/sprints/hybrid_sprint_01.md` |

Migrations chạy theo thứ tự001 →002 →003 trên project Supabase mới; không áp dụng vào database OwO gốc. Giữ lại migration001/002 và các tài liệu sprint cũ để kiểm tra lịch sử.

## Kiểm thử

| Lệnh đã chạy | Kết quả |
|---|---|
| `npm test --prefix rebuild` |89/89 PASS:73 signed HTTP/auth +16 contract cases |
| `npm run test:db --prefix rebuild` |31/31 PASS trên PostgreSQL17 thật:16 core sau migration003 +15 bonus |
| `npm run test:db:core --prefix rebuild` (harness tương đương đã chạy trực tiếp) |16/16 PASS cho baseline001/002 |
| `npm run test:runtime --prefix rebuild` |5/5 PASS trên local workerd |
| `wrangler deploy --dry-run` |PASS, bundle local, không publish |

Không có test skip. Unit/HTTP dùng cryptography thật, mock outbound HTTP. Concurrency dùng PostgreSQL17 thật trong Docker cô lập; không dùng mock để chứng minh transaction. Quan sát hai session thật đang chờ lock trước khi mở gate; receipt retries không cấp lặp; lock timeout100ms và lỗi receipt ép buộc rollback cả hai spouse, metadata và receipt. Test money có seeded RNG để kiểm tra preclaim streak và cap.

Review độc lập không tìm thấy blocker về auth, normalization, receipt hoặc lock order. Test containers và process runtime đã được dọn; tất cả subagents đã nhả lock.

Worker bundle local đã qua `wrangler deploy --dry-run`, Wrangler4.158.0. Runtime smoke trên workerd đã xác nhận signed PING, slash help, HMAC relay help, wrong-guild403 và unsigned401. Những kiểm tra local này không chứng minh CPU10ms trên Cloudflare production hoặc end-to-end Discord/Supabase.

## Các giới hạn còn lại

- Chưa có Gateway process: endpoint prefix đã sẵn để nối relay, nhưng chưa thể gõ `owo daily` trong Discord cho đến Sprint2.
- Hunt/zoo vẫn là placeholder; chưa port animal collection, shop, give, inventory, gambling, lootbox opening, battle/weapons và passive chat XP.
- Supporter privilege/marriage/event được provision bằng trusted SQL. Chưa có live Patreon/billing sync, lệnh social tạo marriage, announcement/survey/custom daily rendering. Không gọi đây là full legacy feature parity.
- UTC là timezone mặc định có thể cấu hình; legacy dùng host-local timezone chưa xác định. Economy/XP/items theo guild thay vì global là adaptation đã ghi nhận.
- Receipt đảm bảo không cấp thưởng lặp; không đảm bảo gửi message Discord đúng một lần. Webhook lỗi sau deferred ACK được log an toàn nhưng có thể chưa hiển thị kết quả.
- Chưa có anti-macro/captcha, receipt retention, backup/restore, đo Worker CPU/load, runtime RAM/reconnect của Gateway và kiểm tra deployment thật.

## Đánh giá free-tier

Không thể cam kết “100% free/always-on” chỉ từ kiến trúc. [Cloudflare Free](https://developers.cloudflare.com/workers/platform/limits/) hiện giới hạn100.000 requests/ngày và10ms CPU/request; phải đo runtime đã deploy. [Fly](https://docs.fly.io/about/free-trial) là trial hữu hạn, không phải free hosting vĩnh viễn. [Koyeb Free](https://www.koyeb.com/docs/reference/instances) có chế độ ngủ sau1h không nhận traffic; [scale-to-zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero) dựa vào traffic/kết nối inbound, nên socket outbound tới Discord không tự bảo đảm luôn thức. Wispbyte chưa được xác minh. Chọn host cuối cùng ở Sprint6.

## Bàn giao

Đã dừng sprint để user review/sign-off theo directive. Không tự bắt đầu Sprint2 và không tự deploy. Xem board và registry tại `.scrum/SPRINT_BOARD.md` và `.scrum/AGENTS_REGISTRY.md`.
