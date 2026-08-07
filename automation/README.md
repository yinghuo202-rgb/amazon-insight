# 店铺运营自动化

这是一个不依赖长期对话状态的本地自动化骨架。运营文件仍保留原样；程序只读源文件，将运行状态、SKU映射和异常写入本地SQLite，并把报告输出到 `runtime/`。

## 架构

- `config/project.json`：数据源、权威级别和读取规则。
- `src/store_ops/`：确定性CLI、数据库、SKU规则和任务实现。
- `runtime/db/operations.sqlite3`：持久化运行状态和异常队列。
- `runtime/reports/`：每次运行的结构化报告。
- `integrations/amazon-insight/`：本地可视化工作台；只读取 `runtime/reports/` 的标准数据，不直接读取业务表格。
- `skills/run-store-operations/`：供Codex复用的编排Skill。
- `AGENTS.md`：任何新对话都必须遵守的安全与实现边界。

## 首次运行

```powershell
powershell -ExecutionPolicy Bypass -File .\ops.ps1 init
powershell -ExecutionPolicy Bypass -File .\ops.ps1 audit-skus
powershell -ExecutionPolicy Bypass -File .\ops.ps1 build-inventory-dashboard-data
powershell -ExecutionPolicy Bypass -File .\ops.ps1 status
```

## 运营驾驶舱 V2

`build-inventory-dashboard-data` 会一次生成美国、加拿大两个站点的数据，并联合库存规划、装箱量、销量与广告基线生成：

- `runtime/reports/inventory_dashboard.json`：美国店（USD）
- `runtime/reports/inventory_dashboard.ca.json`：加拿大店（CAD）

当前口径：

- FBA 仅使用“可售”；预留转运和处理中单列展示，不计入即时可售。
- 可计入库存为 FBA 可售 + AWD 可用 + AWD 已出库到 FBA。
- AWD 入库因缺少 ETA 只展示，不计入 75 天补货计算。
- 默认船期 75 天、周复核 7 天、到货后目标覆盖 45 天、安全库存 21 天。
- 当前销量基线来自 `US2025预估` 最近三个月，页面明确标记为低置信度。
- 经营趋势来自 `US-按月导出` 的 2024 月度销量、销售额和广告归因销售额。
- 广告趋势来自 US 广告活动月报的内部数据日期，当前覆盖 2025-01 至 2025-12。
- 加拿大销量来自 2025 年 1—12 月 `SKU销售汇总`，补货日销使用最近三个月 1:2:3 加权；广告数据当前覆盖 10 个月。
- 加拿大当前可用库存源为 2025-05-23 的 FBA 快照，尚无 AWD 数据；页面会明确标记快照日期与仅 FBA 口径，结果需人工复核。
- 页面可以模拟海运船期、销量情景、目标覆盖、安全库存和目标 ACOS；调整不会写回源文件。
- SKU 销量走势图合并“按月导出”和月度销售报告，展示数据源中全部可识别的实际月份；补货日销仍只使用配置的近月加权窗口。
- 国内供应量会把“工厂库存及已下订单”拆成国内现货与未完工采购订单；使用尚未被发货记录核销的最新采购批次向前对账，并以原合计列为上限。
- 采购订单超过 45 天仍未核销时进入首页交期预警；SKU 页面和补货表可展开查看订单号、下单日期、订单量与未完工数量。
- 待处理清单可以在库存动作与广告动作之间切换，并按 SKU、活动名称和建议动作筛选。

生成数据后，在 `integrations/amazon-insight/` 启动 Web 项目并访问 `/inventory`（运营驾驶舱），通过左侧“美国店 / 加拿大店”切换站点。

## 当前任务边界

第一版完成SKU识别、跨表映射、主数据缺失检查、FNSKU冲突检查、库存可视化数据集和运行留痕。采购单生成、发货单生成、销售利润导入将作为后续独立 Job 接入同一架构。

## 稳定复用原则

1. 对话只负责提出目标和解释结果。
2. 业务规则保存在配置、代码和Skill中。
3. 运行进度保存在SQLite中。
4. 原始文件只读，输出和异常独立保存。
5. 每个Job可单独运行、重试和审计。
