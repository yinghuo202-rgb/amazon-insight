# 经营指标版本闭环实施计划

> **For agentic workers:** 使用执行计划和测试驱动技能；主代理整合，独立实现者不提交、不访问NAS或真实数据。

**Goal:** 补齐已批准PRD的可追溯指标定义与计算规则版本，不引入新财务口径。

**Architecture:** 单一代码JSON资产，TS模型/复核引用，Python整批发布归档并保存版本，复用报告SHA与回退。

**Tech Stack:** 现有Next/TS/Zod、Python和JSON，无新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-metric-contract-design.md`

## Global Constraints

- 不改NAS env rc.11、容器、密钥、真实报告；不覆盖rc.12失败标签，不推main/latest。
- 不改既有公式、提醒阈值、核验标记或新品试算默认；不把未知源金融口径写成已确认。
- 与月报完整性实现者文件隔离：不编辑profitability_snapshot/monthly_reports/inventory_dashboard/sales_history/uploaded_data及其测试。
- 当前新候选在codex/release-v1.5.0-rc.13，只有所有门禁通过才标可交付。

## Review Focus

- 旧报告/复核缺版本时不能被伪造为当前已确认版本。
- 回退应还原归档口径，当前解释代码版本单独呈现；人工事务不能被回滚。
- 默认规则或计算定义变动需改变请求版本和复核证据，不能与旧口径默默相等。
- JSON是唯一资产；Docker/Python实际读取不能靠开发机源码路径碰巧成功。
- 缺失/损坏资产拒绝发布且不动旧指针；字段不齐不生成默认零或金融确认。

### Task 1: 指标资产与页面模型/复核

**Files:** 新增src/lib/inventory/metric-definitions.json、metric-contract.ts；修改data.ts、dashboard-view-model.ts、operating-review.ts、revenue-overview-dashboard.tsx、team-workbench.tsx；新增src/test/metric-contract.test.ts及team-workbench-drafts.test.ts等聚焦行为测试。

**Interfaces:** 当前版本对象含`metricDefinitionVersion`、`calculationRuleVersion`及完整definitions；已发布来源版本可null。evidenceSchema可选兼容版本字段，buildReviewEvidence实际写入，旧baseline不重写。GET报告和当前模型的日期/版本固定在既有withReportVersion范围。

- [ ] 先失败复现当前模型/证据无定义版本，旧证据不应被回填，变动版本改变复核比较。
- [ ] 实现单一资产、严格读取、当前解释与来源版本分离；默认规则纳入模型版本。
- [ ] 现有折叠区简洁展示，不新增主入口；合成测试、相关ESLint/类型检查通过。

### Task 2: Python发布与镜像资产

**Files:** 新增automation/src/store_ops/metric_contract.py；修改report_versions.py、Dockerfile；新增合成Python测试。

**Interfaces:** Python读取同一JSON资产，生成新批`reports/metric-contract.json`并在manifest/current保存版本引用；SHA沿用已有report_file_hashes。report_transaction扩展显式`preserve_metric_contract=False`，restore_reports使用True；恢复已有资产保留原版本，无资产旧备份保留未知，不给原始源报告伪造版本。Python资产由Docker从同一src JSON复制至`/opt/store-ops/config/metric-definitions.json`。

- [ ] 先失败复现发布缺完整定义资产/引用；损坏资产拒绝并保留旧指针，回退保留原归档定义。
- [ ] 最小实现，Docker复制同一资产到现有config目录，无新增Python依赖。
- [ ] 聚焦报告版本及编译worker回归通过；不更改原始源资料。

### Task 3: 集成与候选

- [ ] 主代理读diff及独立审查，一次修复轮，聚焦回归与生产构建。
- [ ] 与成本版本、worker原子审计和月报完整性一起提交新固定候选，云端全流程/双架构实际启动通过。
- [ ] 更新审查与部署材料，明确代码、镜像、NAS及真实数据各自状态；完整PRD仍按外部证据逐项验收。

## 决策

- 这是既有数据链路的版本元数据收口，不重建系统、不猜金融规则；用户自主执行要求覆盖常规实现细节的重复确认。
- 原本rc.12门禁网页448条成功、Python130条中1条失败；失败发生于worker任务完成后审计尚未提交，镜像未构建，不覆盖标签。修复采用任务/审计同事务而非放宽测试或延长等待。
- 月报完整性保持既有完整数值契约，已确认未知值不填零；字段缺失拒绝整批而非放行部分和。积加已有nullable费用事实路径不变。
- 复核显示范围裁定：现有team-workbench只显示金额和“非因果证明”，未实现自动动作效果评分。本轮仅在原证据区补基线/最新口径版本和可比性，不添加效果公式；未知不能冒充相同口径。
