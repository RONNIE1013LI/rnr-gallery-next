# Issue #30：TikTok 付款前追踪交付审查

日期：2026-10-21。依据：[Issue #30](https://github.com/RONNIE1013LI/rnr-gallery-next/issues/30)，最后核实 updated_at=2026-10-21T06:00:46Z，以及本次用户批准的 Events API 替代方案。

以下为发布前审核快照；随后用户已授权代码发布，实际发布结果以本聊天的发布回执为准。Production 环境变更与激活仍未获授权。

代码位于 `/private/tmp/rnr-tiktok-issue-30`，分支 `codex/tiktok-issue-30`。最新抓取的 `origin/main` 为 `7cbf0014812dc2328a56fa1529d90d380ec338de`。未提交、推送、创建 Preview 或部署 Production；现交付本地代码审核。

## 结果

- 已实现 UTM、明确广告同意限定的 ttclid、TikTok organic/paid 来源分类，以及 PageView、ViewContent、AddToCart、InitiateCheckout。
- 用户选定的既有 Pixel ID：`CTBTC6RC77U39S6DVPQG`。没有新建第三个 Pixel。最初名称为 `10.12.2024`，最后 UI 显示名称 `21.10.2026`，ID 不变；本次没有执行重命名操作。
- 官方浏览器 SDK 在 opaque sandbox 中读取 Cookie 抛出 SecurityError，队列没有完成发送。没有通过放宽隔离暴露结账表单；用户明确批准改用服务器 Events API。最终代码不加载 TikTok 浏览器 SDK、iframe 或自动匹配脚本。
- 真实合成验证：8 次服务器请求全部 HTTP 200 / TikTok `code=0`。包括两个不同安全路径的 Pageview，以及 NZD、AUD 各一条 ViewContent、AddToCart、InitiateCheckout。Events Manager 的 Test Events 已显示六条商务事件；Pageview 按该页面说明不展示，以 API 成功回执验证。没有真实订单或付款。
- Purchase 完全未开发、修改或测试；没有运行支付、订单、webhook、Stripe、Afterpay 或 Flik 测试。TikTok 不会通过本次功能测量付费订单；现有第一方 UTM 订单归因仍可沿用，但本次未验证订单归因或订单增长。

证据：[平台截图](tiktok-issue-30-evidence/events-api-received.jpg)、[脱敏 API 回执](tiktok-issue-30-evidence/events-api-receipts.json)。记录均为测试数据，不代表真实销售或广告效果。

## 具体改动

1. `layout.tsx` 挂载无 UI 的 Events controller。服务端验证 ID、显式执行开关和 Token 是否存在，仅传布尔可用状态给浏览器，Token 始终留在服务器。
2. `tiktok.ts` 从既有中央 dispatcher 只映射三个付款前商务事件，允许 NZD/AUD、有限非负金额、受限 SKU/数量；不传名称、图片或个性化内容。当前安全路径最新 ViewContent/InitiateCheckout 上下文只保存在短暂内存，供 hydration/稍后明确同意时重放；不缓存过去的加购动作。
3. `tiktok-events-controller.tsx` 使用安全路径白名单，只有 Production、执行开关、有效配置、广告同意和当前标签页明确选择全部成立时才向同源接口发送。只发 pathname、事件 UUID、白名单参数和可选合法 ttclid；没有原始 URL、query、referrer 或用户字段。撤回/私有路由取消未完成请求并移除监听器。
4. 客户端有最多 50 个进行中请求、100 条/30 分钟 session ledger；Strict Mode 首次取消的 effect 不发请求。已确认事件不重发；不确定响应跨刷新复用 event_id。独立加购动作保留。
5. 新 `/api/analytics/tiktok` 使用现有同源 mutation 校验、16 KiB 请求上限、严格 schema、四事件白名单、路由二次校验。服务器只构建 `https://rnrgallery.com` 的无 query 页面 URL。只允许可选 ttclid 用户字段；不向 TikTok 转发 IP、User-Agent、Cookie、客户身份、邮箱、地址、图片或请求头。
6. API 复用现有 Redis 配置，使用独立 `:tiktok:<pixelId>:` namespace。原始 IP 仅用于服务器内 HMAC 限流，不存储或传给 TikTok。原子限制每网络 30 次/60 秒、全局 120 次/60 秒；处理中 event_id 租约 60 秒，成功保留两天，明确拒绝释放，超时等租约到期。配置/Redis/可信 IP 不可用即停止追踪，不影响客户动作。TikTok 请求超时 5 秒，不跟随重定向、不记录原始错误或凭据。
7. 同意接口保持原有 analytics/advertising 自动保存行为，新增可选的明确 TikTok 选择。手动选择成功才设置独立 HttpOnly/SameSite Cookie，与服务器生成的同意时间匹配；自动/历史同意不能启用 TikTok。客户端另要求当前标签页选择。撤回立即停止客户端追踪，即使保存失败。
8. ttclid 仅接受 `[A-Za-z0-9_-]`、最多 200 字符；使用现有 session/有界 touch history，撤回时清理，保留 UTM 和其他提供商逻辑。内部报告分辨 `tiktok` / `tiktok_ads`，维持既有 DB channel=`other`，没有 schema 或迁移。首个第一方 pageview 等明确同意 hydration 完成，避免纯 ttclid 着陆误记 Direct。

## 验证

最终限定运行 **12 个文件，93 项全部通过**：

```sh
./node_modules/.bin/vitest run \
 src/domain/analytics/tiktok-attribution.test.ts \
 src/domain/analytics/tiktok.test.ts \
 src/domain/analytics/tiktok-dispatch.test.ts \
 src/components/tiktok-events-controller.test.tsx \
 src/components/tiktok-consent.test.tsx \
 src/components/tiktok-capture.test.tsx \
 src/components/attribution-capture.test.tsx \
 src/components/website-analytics-tracker.test.tsx \
 src/domain/analytics/website-attribution.test.ts \
 src/components/consent-preferences.test.tsx \
 src/app/api/consent/route.test.ts \
 src/app/api/analytics/tiktok/route.test.ts
```

新增测试覆盖配置关闭、明确同意与撤回、私有路由、参数限制、NZD/AUD、SPA/Strict Mode/刷新去重、稍后同意重放、API 成功/失败、lease 完成/释放。既有测试仅限实际修改的同意/第一方归因边界。未运行全量测试、release:test:isolated、数据库 sweep 或无关 e2e。

- 限定 TypeScript：`tsc -p /private/tmp/rnr-tiktok-scoped-tsconfig.json --noEmit --incremental false` 通过；配置包括变更入口及其依赖。
- ESLint：只列出本次变更的源码和测试文件，通过。`git diff --check` 通过。
- 仓库要求的一次成功 optimized build：`npm run build` 通过，保留 automation guard 与 Production source guard，没有设置/伪造 Vercel 系统变量。此前三次因本地环境中止：外部 node_modules symlink、缺少认证变量、临时 localhost origin 不满足已有 Passkey 规则。修复为同卷 APFS clone 的同版本依赖，并仅向构建进程提供官网允许 origin、随机临时 secret 和不可连接的 `127.0.0.1:9` 数据库地址。没有使用 Production 凭据或访问真实数据库。最终编译、项目 TypeScript 和页面生成均通过。构建生成的无关知识库时间/commit 元数据已逐项比对后恢复。
- 独立代码审查发现并修复三个漏记问题：同意恢复前页面事件丢失、首个 pageview 分类时序、明确拒绝后的长锁。每项先补失败回归再修正；复审未发现新的实质问题。

真实浏览器验证使用独立临时组件夹具，调用本工作区真实 consent/event route，向 TikTok 发送带 `test_event_code` 的合成数据。仅 Redis claim 以夹具内存实现替代，没有操作 Production Redis。明确同意前回执为 0；同意后 8 条均成功；私有路由尝试与撤回后均保持 8 条。数据只含测试 SKU、25 NZD/AUD 和安全页面路径，无客户字段。真实 Redis 行为仍未集成测量，按失败关闭处理；不将 mock lease 称为真实 Redis 验证。

用户授权生成了一个 Events API Token，只用于上述合成测试；没有显示、记录或提交值。两个临时服务已停止、浏览器夹具已关闭、临时 Token 文件已删除。平台侧生成凭据没有执行撤销操作；生产配置需另行安全生成/提供凭据。没有保存浏览器 Cookie 或绕过登录。

## 上线配置与权限

尚未写入以下 Production 变量：

| 名称 | 用途 / 审核值 |
| --- | --- |
| `TIKTOK_PIXEL_ID` | `CTBTC6RC77U39S6DVPQG`，公开标识 |
| `TIKTOK_PIXEL_ENABLED` | 默认关闭；只有另行批准激活时设置精确 `true` |
| `TIKTOK_EVENTS_API_TOKEN` | 服务器 Secret，另行安全生成/配置，绝不进入浏览器/Git |

复用现有 `RNR_AI_REDIS_REST_URL`、`RNR_AI_REDIS_REST_TOKEN`、`RNR_AI_REDIS_NAMESPACE`。已在 Production UI 只核实三个变量名存在，没有揭示值或修改。API test code 仅为注入的测试配置，Production 路径不读取或发送 test code。

当前只读发布身份核实：Vercel 项目 `rnr-gallery-staging` / `prj_6HHmxCsLMm8oTwUhMWkpphH7rBlO`，Production Branch=`main`，自动域名分配开启。READY Production `dpl_4DUxMeFQ2yGmQjNqDfJXXaRxmguy`，githubCommitRef=`main`、SHA=`7cbf0014812dc2328a56fa1529d90d380ec338de` 与最新 origin/main 一致；aliases 包含 rnrgallery.com、www.rnrgallery.com、rrgallery.co.nz、www.rrgallery.co.nz。未发现来源漂移；发布前仍应再抓取核对。

代码可交付审核。推送/合并至 main（自动 Production 发布）以及 Production 环境配置/激活分别需要用户明确授权。不会直接运行 vercel --prod、改域名、创建多余 Preview 或启用广告。

## 预计影响与限制

预期提高 NZ/AU TikTok 来源及付款前漏斗的可测量性，减少重复及错误 Direct 分类；没有验证订单增加或广告效果。手动明确同意意味着 TikTok 数据只覆盖同意人群；现有 UI 不自动弹出新增 TikTok 同意提示，因此覆盖率可能较低。缺少 ttclid/匹配身份的自然流量即使 API 接收成功，也不等于 TikTok 已归因到具体用户或广告。没有订单/付款事件、收入 ROAS 或送达保证；网络失败/限流可以导致漏记。

浏览器 SDK 的 AAM/Cookie/enhanced-data 开关在设置向导内曾暂时取消，但没有保存；后续实际 Settings 确认为原有三个开关仍开。没有更改线上 Pixel 隐私配置。最终方案不加载该 SDK，不依赖这些开关。

## 回退

未发布前，仅在此工作区修订本次 diff。发布后优先经单独授权关闭 `TIKTOK_PIXEL_ENABLED`，必要时通过 main 正常 revert 本次代码并自动部署；不改写 main、不碰付款配置或迁移。当前 READY deployment/SHA 是现阶段回退基准，实际发布时重新记录。没有数据库迁移需回退。

## 修改文件

源码：

- `src/app/layout.tsx`
- `src/app/api/analytics/tiktok/route.ts`（新增）
- `src/app/api/analytics/tiktok/route-handler.ts`（新增）
- `src/app/api/consent/route-handler.ts`
- `src/components/tiktok-events-controller.tsx`（新增）
- `src/components/consent-preferences.tsx`
- `src/components/attribution-capture.tsx`
- `src/components/website-analytics-tracker.tsx`
- `src/domain/analytics/tiktok.ts`（新增）
- `src/domain/analytics/client.ts`
- `src/domain/analytics/attribution.ts`
- `src/domain/analytics/attribution-history.ts`
- `src/domain/analytics/website-attribution.ts`
- `src/domain/consent/advertising-consent.ts`

测试：上述限定命令中的文件，`website-attribution.test.ts` 原有文件仅运行未修改；其余为本次新增或最小修改。

交付：本文与 `docs/audits/tiktok-issue-30-evidence/` 中的脱敏证据。旧 sandbox 实验源码已移除，不随本次交付；没有新增依赖、env 文件或正式迁移。

接口依据：[TikTok 官方 Events API 模板](https://github.com/tiktok/gtm-template-eapi/blob/main/template.tpl)；仅采用 web envelope、官方端点、Pageview 名称及可选 ttclid 字段，没有复制其身份收集或日志逻辑。
