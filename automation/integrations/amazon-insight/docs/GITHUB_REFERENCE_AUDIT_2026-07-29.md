# Measureman Ops 功能自查与 GitHub 对标

更新时间：2026-07-29

## 结论

当前项目的核心架构适合本地运营分析：Next.js 负责交互，Python/Node 任务生成结构化报告，本地 SQLite 保存可执行草稿。暂不建议整体替换成 ERP、BI 或工作流平台。更合适的路线是保留现有业务模型，按功能吸收成熟项目的设计与算法：

1. 数据层先建立“来源 → 清洗 → 指标 → 页面/导出”的可追踪关系。
2. 预测层用多模型回测替代单一固定公式，并对稀疏销量 SKU 使用间歇需求模型。
3. 采购与发货层增加约束求解，但人工确认、锁定、导出仍保留在本站。
4. 广告和库存优先接入官方或成熟 API 客户端，减少文件时效差。
5. A+ 以产品事实为唯一卖点依据，历史文件只作视觉风格参考。

## 逐功能对标

| 本站功能 | 当前自查 | GitHub 参考 | 可借鉴内容 | 建议 |
| --- | --- | --- | --- | --- |
| 运营总览 | 指标与明细同页，部分卡片重复下游页面信息 | [Metabase](https://github.com/metabase/metabase) | 规范化指标、全局筛选、点击下钻、告警 | 借鉴交互，不引入整套 BI |
| 库存视图 | 规则透明、双站与国内共享池已关联；预测仍以固定窗口为主 | [StatsForecast](https://github.com/Nixtla/statsforecast) | AutoETS/Theta、SeasonalNaive、Croston/TSB、批量回测 | 优先加入预测基准和置信区间 |
| 季节库存分析 | 已合并清货与补货，并区分站点缺口、国内调拨、未完工和最终采购 | [StatsForecast](https://github.com/Nixtla/statsforecast) | 季节模型、间歇需求模型、多模型择优 | 保留现有业务规则，用回测选销量模型 |
| 采购计划与催货 | 已有草稿、复核、锁定、下单状态；季节表与采购表曾重复 | [ERPNext](https://github.com/frappe/erpnext) | 采购单状态机、供应商交期、收货/未完成数量、审计轨迹 | 借鉴状态与事件，不迁移 ERP |
| 发货计划 | 能保存和导出，当前分配主要依赖规则 | [Google OR-Tools](https://github.com/google/or-tools) | 箱规、仓容、时效、预算、优先级等约束优化 | 在规则候选后增加可解释的求解层 |
| 采购算法回测 | 已有历史回测页，但候选模型有限 | [StatsForecast](https://github.com/Nixtla/statsforecast) | 统一时间序列交叉验证和模型排行榜 | 增加 WAPE、偏差、缺货/过量成本 |
| 产品与变体知识图谱 | 已使用 Cytoscape.js，规格、父子体、订单与供应商已关联 | [Cytoscape.js](https://github.com/cytoscape/cytoscape.js) | 图布局、选择态、图分析、扩展布局 | 已选对工具；下一步做路径筛选和证据侧栏 |
| SKU 子页面与订单明细 | 数据关联完整，但证据分散在多个卡片 | [ERPNext](https://github.com/frappe/erpnext) | 单据时间线、来源单据跳转、状态审计 | 合并为 SKU 事件时间线 |
| 广告管理 | 建议草稿与原始活动曾重复；广告源数据时效不足 | [python-amazon-ad-api](https://github.com/denisneuf/python-amazon-ad-api), [Amazon Skills](https://github.com/nexscope-ai/Amazon-Skills) | 广告 API 鉴权/报表、否词、ACOS 目标、预算与竞价策略 | 先接最新报表/API；策略保留可审核规则 |
| 内容与美工 | 旧逻辑优先复制历史同系列结构，可能让模板替代产品策划 | [Amazon A+ Content Generator](https://github.com/omishagupta/amazon-aplus-content-generator), [FeedGen](https://github.com/google-marketing-solutions/feedgen) | 策略→文案/图片→布局→质检；属性优先、生成后评分与人工批准 | 已改为产品事实驱动，并保留工程/合规审核 |
| 图片排版与编辑 | 目前输出 Excel brief，还没有浏览器内可编辑画布 | [Konva](https://github.com/konvajs/konva), [Presenton](https://github.com/presenton/presenton) | 可编辑画布、模板布局、文本/图片生成器分离、导出 | 只有在需要在线改图时再引入 Konva |
| 数据更新 | 有本地任务和运行记录，但跨报告依赖与新鲜度可视化仍可加强 | [Dagster](https://github.com/dagster-io/dagster) | 数据资产、依赖图、分区检查、新鲜度与失败重跑 | 借鉴 asset check；暂不引入重型编排器 |
| 下载中心 | 能重下历史文件，缺少输入版本到输出文件的完整血缘 | [Dagster](https://github.com/dagster-io/dagster) | 物化记录、输入版本、产物元数据 | 给每个产物记录源文件哈希和算法版本 |
| Amazon 数据接入 | 当前仍以本地报表为主，数据时效依赖人工下载 | [Amazon SP-API Models](https://github.com/amzn/selling-partner-api-models), [amazon-sp-api](https://github.com/amz-tools/amazon-sp-api), [Amazon Seller MCP](https://github.com/jay-trivedi/amazon_sp_mcp) | 库存、订单、Listing、报告获取，限流和令牌刷新 | 作为下一阶段最高价值集成 |
| 选品搜索与设置 | 外部数据源配置已存在，但搜索证据和数据源状态可更透明 | [Amazon SP-API Models](https://github.com/amzn/selling-partner-api-models) | 目录/Listing 字段模型、请求限流和错误分类 | 在结果页显示来源、时间和失败回退 |
| 通用自动化 | 现有代码任务已能完成核心刷新与导出 | [n8n](https://github.com/n8n-io/n8n) | 可视化工作流、人工审批、连接器 | 暂不引入；许可证与重复建设成本较高 |

## 实施优先级

### P0：先保证数据可信

- 为库存、销量、广告、毛利、采购订单建立统一数据新鲜度和源文件版本。
- 下载产物记录输入哈希、算法版本、市场、快照日期和生成状态。
- 广告页只展示可执行队列，原始明细默认折叠。
- 采购页只展示统一执行表，季节规则和数据来源默认折叠。

### P1：提升算法

- 在采购回测中加入 SeasonalNaive、AutoETS、CrostonSBA/TSB。
- 用 WAPE、偏差、缺货件数、过量件数和资金占用共同选模。
- 用 OR-Tools 作为发货/采购的约束求解器，但输出必须保留逐 SKU 原因。
- 季节补货明确展示：站点缺口 - 国内调拨 - 未完工覆盖 = 需采购数量。

### P1：提升数据时效

- 接入 SP-API 的 FBA Inventory、Orders、Listings、Reports。
- 接入 Amazon Advertising API 或标准化最新广告报表导入。
- 令牌、限流、重试和数据快照由独立适配层管理，页面不直接调用外部 API。

### P2：提升内容生产

- A+ 固定使用“核心承诺 → 使用问题 → 性能证据 → 结构证据 → 安装/场景 → 规格/选型”的内容架构。
- 产品主数据和工程参数是事实源，Listing 仅作为文案素材，订单只用于需求分析。
- 后续如需要在线改稿，可用 Konva 增加轻量画布；当前 Excel brief 继续作为跨团队交付格式。

## 不建议直接引入

- 不直接嵌入 Metabase：当前需要大量 SKU 级编辑、锁定和导出，定制页面更合适。
- 不整体迁移 ERPNext：现有业务规则更细，迁移成本高；只借鉴状态机和审计。
- 不立即引入 Dagster/n8n：当前本地规模下会增加部署复杂度；先实现数据资产、新鲜度和重跑语义。
- 不直接采用低活跃 A+ 仓库的完整技术栈：它更适合作为流程设计参考，不作为生产依赖。
