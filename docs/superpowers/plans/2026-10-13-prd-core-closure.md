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
- 不操作 NAS 容器、Compose、业务文件或密钥；当前 env 保持 rc.9。
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

- [ ] 先写并观察失败测试：边界、并发、冷却恢复、伪造来源、错误凭证与正确登录。
- [ ] 实现服务器端计数与清理，不无限锁死共用账号，不静默在存储故障时绕过保护。
- [ ] 运行该模块及真实 route 的聚焦测试、相关 ESLint；报告执行结果，不提交。

### Task 2: 复核证据、重新触发与连续历史查询

**Files:** 修改 `src/lib/inventory/operating-review.ts`、`src/app/api/team/route.ts`、`src/components/inventory/team-workbench.tsx` 及对应三个测试；新增版本复核协调模块/测试，必要时修改 worker 及其打包脚本、编译 worker 验收测试。不得修改 data-refresh-center、login 或 data-import。

**Interfaces:** history 的新证据事件包含版本、期间、指标和 triggered；旧事件仍可解析。managed review 按 listingId/issueKey 更新，首次 baseline 和人工备注不变。协调接口 `reconcileOperatingReviews(): Promise<...>` 必须有可验证的实际运行入口，不以人工点击假装自动更新。worker 或发布协调失败单独记录，不把已经发布的数据称作回滚成功。

- [ ] 先复现：已处理记录新证据再次触发仍 DONE，中间快照丢失，第 101 条不可访问。
- [ ] 添加不可变证据事件；新版本仍触发时 DONE/DISMISSED 转 REVIEW，保留结论，不因提醒消失自动关闭。
- [ ] 确认并记录最小自动协调入口和打包依赖方案后，接入发布版本变更；同版本幂等、人工并发采用 CAS。
- [ ] GET 加有界连续查询，返回 nextCursor；游标包含明确稳定顺序和筛选上下文，非法游标拒绝。
- [ ] UI 加 SKU/站点筛选与连续追加，未标站点历史可查；保留草稿、冲突提醒和键盘/手机布局。
- [ ] 运行三组聚焦测试和自动入口集成；报告实际 red/green 与限制，不提交。

### Task 3: 数据发布与回退二次验证

**Files:** 修改 `src/app/api/inventory/data-import/route.ts`、`src/components/inventory/data-refresh-center.tsx`；新增目标绑定确认模块与 route/UI 测试。不改 team、login 或 NAS 文件。

**Interfaces:** 本站 Origin 使用既有 NEXT_PUBLIC_APP_URL 约定；JSON 操作严格校验 Content-Type，二进制分片保留 octet-stream。发布/回退前重新验证当前共用账号，签发短期、会话及目标绑定的确认；实际执行校验目标、版本基线、有效期与一次性使用，不能仅依赖 window.confirm 或客户端 confirmed=true。凭证只在 HTTPS/本机可信开发环境验证，不落盘、不返回、不记录。

- [ ] 先复现并拒绝：外站/缺失 Origin、错误 Content-Type、未确认、过期、重放、换目标和旧基线。
- [ ] 在现有界面提供明确再次验证步骤，绑定发布批次/回退版本；保留上传及进度流程。
- [ ] 必要审计只记操作、目标、账号会话标识和结果，不输出密码、确认令牌或原始异常。
- [ ] 运行聚焦模块、route 与 UI 测试，未授权操作不可调用发布函数；报告结果，不提交。

### Task 4: 集成与固定版本交付

- [ ] 主代理检查各任务变更及接口；记录实际选择和偏离原因，不复做已通过无关测试。
- [ ] 执行与安全风险匹配的联合验证、类型检查与相关视觉/操作检查；独立全分支代码审查。
- [ ] 更新当前 README、审计与部署材料，区分代码、镜像、NAS、真实数据和公开连接的证据。
- [ ] 按已有授权提交、推送新的固定候选标签，确认双架构镜像启动；不推 main/latest、不部署 NAS。
- [ ] 最后按真实需求逐项验收；未授权或未验真的外部事项不得称作完成。

## 决策与进度

- 本计划的三个领域互不编辑同一文件；复核域自动入口细节须在编码前回报并由主代理确认。
- TDD 与聚焦验证优先；安全相关组合风险及镜像打包由最终集成/云端检查覆盖。
- 当前 rc.10 正在双架构构建，继续观察原任务，不因此计划重建或覆盖 rc.10。
- Task 1 决定：共用登录使用服务器全局 10 次/60 秒窗口，运营 SQLite 原子计数；不信任客户端代理头，不保存邮箱明文或密码，拒绝不延长窗口。短时共享预算不等于永久锁定，不替代网关 DoS 防护。
- Task 2 决定：原 worker 未挂载账号库，改用 Next node instrumentation 启动 30 秒有界协调，复用原 Prisma 和账号库，不增加 NAS 挂载或 worker 打包依赖；Node-only、构建保护、singleton、非阻塞、单轮互斥、CAS、独立失败审计。创建时间/id 游标避免自动更新 updatedAt 导致列表漏项，UI 明示创建排序。
- Task 3 决定：120 秒随机 opaque 确认令牌，运营库只保存 SHA，绑定当前 user/session、操作、目标内容与当前报告基线；一次消费，不新增 HMAC 密钥。扩展 data-import.ts、uploaded_data.py、report_versions.py 与对应测试，在既有发布锁内复核基线/目标，关闭 TS 预检查到 Python 提交的竞态；原内部自动调用保持兼容，网页确认必需。
- rc.10 工作流 38363672448 已成功：50 文件/333 网页测试，123 Python 测试，双架构构建及启动检查；本计划后续仍不覆盖此标签。
