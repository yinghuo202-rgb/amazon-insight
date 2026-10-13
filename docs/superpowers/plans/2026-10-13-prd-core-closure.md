# PRD 核心复核与安全闭环实施计划

> **For agentic workers:** 使用计划执行及并行协作技能，按职责隔离实施；子代理不提交，主代理整合、验证并发布。

**Goal:** 补齐逐项审计确认的五个 P0/P1 内部缺口，不以候选镜像成功代替商业化验收。

**Architecture:** 保留 Next.js、Prisma、现有账号/运营库与独立 worker。复核继续复用 CollaborationTask 的 context/history；只更新版本化经营证据和待复核状态，不覆盖人工结论。敏感发布使用当前会话、本站写入校验及绑定目标的再次验证；登录增加有界限流。

**Tech Stack:** TypeScript、Next.js 16、React、Prisma、SQLite、Vitest；无新增依赖。

**Spec:** `/Users/winter/Downloads/Measureman_PRD_V2.0.md` 的 3.5、7.2、8.1，以及 `docs/网站审查与优化-20261013.md` 的已确定交付边界。

## Global Constraints

- 原共用账号和工作区不变；不恢复个人权限校验，不冒充个人身份审计。
- 经营范围为 MEASUREMAN US/CA，MX/AU 不恢复采集，历史记录保留。
- 不执行采购、改价或广告业务动作，不自动关闭经营问题。
- 不操作 NAS 容器、Compose、业务文件或密钥；按用户最新要求单独备份并更新 env 至已验证 rc.10，其余配置逐字节不变。rc.11 不自动写入 NAS。
- rc.10 固定在 e27d786，不覆盖其标签；本计划在 rc.11 分支实施。
- 只使用临时合成数据测试，真实 API、WPS 授权与 NAS 恢复另行验收。
- 保留已有未提交文档更新和用户 docker/.DS_Store，不新增框架或依赖。

## Review Focus

- 新版本再次触发已处理问题：重新待复核，但原备注、基线和处理结论仍可查询。
- 同一版本重复执行与并发编辑：无重复证据事件，不覆盖刚保存的人工结论。
- 旧记录没有 context、证据或站点：兼容读取，不能伪造过去的快照。
- 登录计数重启、并发与伪造代理头：有界、可恢复，不依赖任意客户端头绕过限流。
- 确认已过期、重放或目标改变：拒绝发布/回退，已有报告和业务记录不变。

---

### Task 1: 登录限流

**Files:** 新增 `automation/integrations/amazon-insight/src/lib/login-throttle.ts` 与对应测试；修改 `src/app/api/auth/login/route.ts`。不修改共享账号选择、密码算法或既有 auth.ts。

**Interfaces:** 登录 route 在执行密码验证前检查并记录有界尝试；被限制时返回 429 与 Retry-After。计数只存不可逆标识和时间，不存邮箱明文、密码或令牌。具体存储及限额取维护性优先的保守初值，实施者记录选定值供主代理审查。

- [x] 先写并观察失败测试：边界、并发、冷却恢复、伪造来源、错误凭证与正确登录。
- [x] 实现服务器端计数与清理，不无限锁死共用账号，不静默在存储故障时绕过保护。
- [x] 运行该模块及真实 route 的聚焦测试、相关 ESLint；报告执行结果，不提交。

### Task 2: 复核证据、重新触发与连续历史查询

**Files:** 修改 `src/lib/inventory/operating-review.ts`、`src/app/api/team/route.ts`、`src/components/inventory/team-workbench.tsx` 及对应三个测试；新增版本复核协调模块/测试，必要时修改 worker 及其打包脚本、编译 worker 验收测试。不得修改 data-refresh-center、login 或 data-import。

**Interfaces:** history 的新证据事件包含版本、期间、指标和 triggered；旧事件仍可解析。managed review 按 listingId/issueKey 更新，首次 baseline 和人工备注不变。协调接口 `reconcileOperatingReviews(): Promise<...>` 必须有可验证的实际运行入口，不以人工点击假装自动更新。worker 或发布协调失败单独记录，不把已经发布的数据称作回滚成功。

- [x] 先复现：已处理记录新证据再次触发仍 DONE，中间快照丢失，第 101 条不可访问。
- [x] 添加不可变证据事件；新版本仍触发时 DONE/DISMISSED 转 REVIEW，保留结论，不因提醒消失自动关闭。
- [x] 确认并记录最小自动协调入口和打包依赖方案后，接入发布版本变更；同版本幂等、人工并发采用 CAS。
- [x] GET 加有界连续查询，返回 nextCursor；游标包含明确稳定顺序和筛选上下文，非法游标拒绝。
- [x] UI 加 SKU/站点筛选与连续追加，未标站点历史可查；保留草稿、冲突提醒和键盘/手机布局。
- [x] 运行三组聚焦测试和自动入口集成；报告实际 red/green 与限制，不提交。

### Task 3: 数据发布与回退二次验证

**Files:** 修改 `src/app/api/inventory/data-import/route.ts`、`src/components/inventory/data-refresh-center.tsx`；新增目标绑定确认模块与 route/UI 测试。不改 team、login 或 NAS 文件。

**Interfaces:** 本站 Origin 使用既有 NEXT_PUBLIC_APP_URL 约定；JSON 操作严格校验 Content-Type，二进制分片保留 octet-stream。发布/回退前重新验证当前共用账号，签发短期、会话及目标绑定的确认；实际执行校验目标、版本基线、有效期与一次性使用，不能仅依赖 window.confirm 或客户端 confirmed=true。凭证只在 HTTPS/本机可信开发环境验证，不落盘、不返回、不记录。

- [x] 先复现并拒绝：外站/缺失 Origin、错误 Content-Type、未确认、过期、重放、换目标和旧基线。
- [x] 在现有界面提供明确再次验证步骤，绑定发布批次/回退版本；保留上传及进度流程。
- [x] 必要审计只记操作、目标、账号会话标识和结果，不输出密码、确认令牌或原始异常。
- [x] 运行聚焦模块、route 与 UI 测试，未授权操作不可调用发布函数；报告结果，不提交。

### Task 4: 集成与固定版本交付

- [x] 主代理检查各任务变更及接口；记录实际选择和偏离原因，不复做已通过无关测试。
- [x] 执行与安全风险匹配的联合验证、类型检查与相关视觉/操作检查；独立全分支代码审查。
- [x] 更新当前 README、审计与部署材料，区分代码、镜像、NAS、真实数据和公开连接的证据。
- [x] 按已有授权提交、推送新的固定候选标签，确认双架构镜像启动；不推 main/latest、不部署 NAS。
- [ ] 最后按真实需求逐项验收；未授权或未验真的外部事项不得称作完成。

## 决策与进度

- 本计划的三个领域互不编辑同一文件；复核域自动入口细节须在编码前回报并由主代理确认。
- TDD 与聚焦验证优先；安全相关组合风险及镜像打包由最终集成/云端检查覆盖。
- rc.10 双架构构建已经通过，不重建或覆盖标签。
- Task 1 决定：共用登录使用服务器全局 10 次/60 秒窗口，运营 SQLite 原子计数；不信任客户端代理头，不保存邮箱明文或密码，拒绝不延长窗口。短时共享预算不等于永久锁定，不替代网关 DoS 防护。
- Task 2 决定：原 worker 未挂载账号库，改用 Next node instrumentation 启动 30 秒有界协调，复用原 Prisma 和账号库，不增加 NAS 挂载或 worker 打包依赖；Node-only、构建保护、singleton、非阻塞、单轮互斥、CAS、独立失败审计。创建时间/id 游标避免自动更新 updatedAt 导致列表漏项，UI 明示创建排序。
- Task 3 决定：120 秒随机 opaque 确认令牌，运营库只保存 SHA，绑定当前 user/session、操作、目标内容与当前报告基线；一次消费，不新增 HMAC 密钥。扩展 data-import.ts、uploaded_data.py、report_versions.py 与对应测试，在既有发布锁内复核基线/目标，关闭 TS 预检查到 Python 提交的竞态；原内部自动调用保持兼容，网页确认必需。
- rc.10 工作流 38363672448 已成功：50 文件/333 网页测试，123 Python 测试，双架构构建及启动检查；本计划后续仍不覆盖此标签。
- Task 1 验证：实施者先观察 9 条失败及真实双 worker 超额，再实现通过；主代理复跑两个文件 10 条通过，四个源/测试文件与 QA 副本逐字节一致。实测 SQLite 双 worker 原子计数、独立 worker 重启读原计数、窗口恢复；原 auth.ts 未改。所有数据为临时合成，不验证实际 NAS ACL。
- Task 2 补充决定：model.dataVersion 包含当前日期及全店内容，不能单独作为重新触发依据。发布 nonce 和采集时间同样不属于经营事实；只在期间、该 SKU 事实/覆盖/业务快照日期或适用规则发生 material 变化且仍触发时重新待复核。回退更新 latest，但不重复既有证据或重开已审的历史问题。
- 独立审查 P1 修复：真实 Python 发布 V1→V2、处理后回退新指针 P3 的失败复现已观察；修复后保留 DONE/原备注/历史，新销售事实再触发才进入 REVIEW。
- 独立审查 P2 修复：12 个并发密码验证先有绕过复现；改为 SQLite BEGIN IMMEDIATE 预先原子预留，每会话 5 次/5 分钟，成功和失败都计数，不延长拒绝窗口。修复后 5 次验证、7 次 429；不替代网关保护。
- 主代理联合验收：10 个网页测试文件 89 条通过；Python 发布保护及相关回归 20 条通过；生产构建含 TypeScript 通过，standalone 准备成功。手机 390×844 密码输入宽度原 58px，布局修复后 308px，5 条 UI 操作回归通过；1440×900 无横向溢出，Enter 验证、Escape 取消、连续加载和历史站点筛选实际检查通过。仅合成数据组件验收，不代替 NAS 验收。
- 镜像 smoke 新增真实生产 instrumentation 自动协调断言：隔离账号库未知合成 listing 应记录 skipped 并保留人工 DONE；源码脚本语法检查通过，等待 rc.11 双架构实际镜像检查，不能以单元模拟替代。
- rc.11 云端验证日志已读取：57个文件/403条网页测试、130条Python测试及生产构建/类型检查通过；工作流38375784053的docker构建仍运行，实际启动门禁及清单摘要未取得。不得用verify成功替代整轮成功。
- 最终rc.11工作流38375784053全部成功，固定提交c75f3cf；AMD64/ARM64分别真实执行fresh、worker、resume，新生产自动协调断言通过。清单摘要为 `sha256:f199e35e18ebfb972cff84fe286640cb11603b38f5e82dde734d1f3abc38f3be`，latest跳过。NAS仍配置rc.10，不自动部署；真实数据及完整PRD验收未完成，后续已确认成本版本缺口在rc.12单独实施。
