# 产品成本版本闭环实施计划

> **For agentic workers:** 使用执行计划和测试驱动技能；存储/API与页面按文件隔离，主代理整合验收，不让子代理提交或访问 NAS。

**Goal:** 补齐 PRD 已确认的成本有效期、历史版本和修改审计，保留现有经营事实。

**Architecture:** 既有运营 SQLite 追加不可变成本版本与恢复事件；当前成本由有效日期解析，原接口兼容。现有成本后台提供版本录入和连续历史，不重建系统。

**Tech Stack:** Next.js 16、TypeScript、React、SQLite、Zod、Vitest，无新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-cost-version-design.md`

## Global Constraints

- 不修改已发布历史利润、原报告、NAS文件、密钥、容器或调度；NAS env 保持 rc.10。
- rc.11 标签固定 c75f3cf，不覆盖或重新构建。下一补丁用新候选分支/标签。
- 含税/未税成本固定13%换算不变，试算税0默认也不变；两者不能混用。
- 原覆盖与旧未知生效日期保留；恢复源成本不得删除历史。
- 不扩大个人权限体系、不冒充自然人审计、不新增主导航。

## Review Focus

- 未来及失效版本不能误用于当前试算；前一版本不能在新版本失效后复活。
- 同日连续修订、重复保存和批量冲突：历史有完整事实，失败无半批更新。
- 升级旧表与旧内部调用：旧成本不丢失，不虚构历史日期。
- 回退报告不删除新成本/人工历史；历史实际利润不随当前成本变动。
- 敏感写操作不能仅依靠客户端校验，不泄漏原始会话或数据库异常。

### Task 1: 存储、日期解析与成本 API

**Files:** `src/lib/inventory/product-cost-store.ts`、新增 `src/lib/inventory/product-cost-history.ts`（必要时）、`src/app/api/inventory/product-costs/route.ts`；新增合成存储/路由测试。

**Interfaces:** 保留 `listProductCostOverrides()`/`saveProductCostOverrides(items)`/`deleteProductCostOverrides(skus)`/`applyProductCostOverrides(data, overrides)`，扩展可选元数据与按日期读取。新增编辑状态与连续历史函数；实施者编码前回报精确导出类型和 route 请求/响应形状供 Task2 使用。

- [ ] 先写并观察失败：生效期、历史、恢复留痕、旧覆盖兼容、同日修订、真零/空值、未来与失效、批量CAS。
- [ ] 实现追加表、当前解析、事务与审计；不倒推旧生效期，不改历史利润算法。
- [ ] route 增加登录/同源JSON、日期/来源/版本校验与连续历史；受控错误及会话SHA。
- [ ] 聚焦合成测试与 ESLint 通过；交付精确契约和旧镜像回退限制，不提交。

### Task 2: 成本工作台与页面接入

**Files:** `src/components/inventory/product-cost-workbench.tsx`、`src/lib/inventory/product-costs.ts`、`src/app/inventory/costs/page.tsx`及对应页面测试；不编辑 Task1 文件。

**Interfaces:** 使用 Task1 已确认的编辑状态、元数据及历史契约；成本数值字段和原筛选/连续下滑保持不变。

- [ ] 先写并观察失败：保存/恢复携带日期来源及版本，冲突保留草稿，历史连续加载。
- [ ] 默认历史收起，明确覆盖SKU数与版本数，展示当前/未来/失效/未知历史；手机日期输入不拥挤。
- [ ] 运行聚焦 UI 测试及实际手机/键盘验收；不得用合成页面称作 NAS 上线。

### Task 3: 集成与新候选镜像

- [ ] 主代理读 diff，聚焦联合回归、生产构建、独立审查，证明旧利润报告不受成本编辑影响。
- [ ] 记录代码/镜像/NAS/数据的独立证据，提供回退和迁移兼容说明。
- [ ] 按已有授权提交并构建新固定镜像，双架构启动通过后才称可交付；不推main/latest、不操作NAS。

## 决策

- 该缺口由两次源码核对确认，不是新增 ERP 或臆测性功能；通用编辑已明确排除成本字段，不需无关改造。
- 用户要求自主推进，沿用已批准PRD和既有架构；不重新要求用户选择限流、表结构等实现细节。
- 以不可变版本与日期解析补齐需求，不只追加时间戳审计来冒充有效成本历史。
