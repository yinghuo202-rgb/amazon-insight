# Amazon Selection Workbench Web V1

## PRD V2.0 本轮实施（2026-10-09，NAS 试用版 v1.5.0-rc.2）

沿用现有三个主入口、组件、报告版本和数据库，以下为本轮代码状态。后文早期版本的“尚未完成”与部署版本号为历史记录，以本节和 NAS 文档最新实施说明为准；本节不表示已上线或整份 PRD 已完成。

- **OV / SKU**：经营观察、六项指标、优先复核入口、SKU 搜索、金额趋势和来源说明分层排列。简报新增经营影响、销售额和来源利润率排序。影响排序先区分已核验亏损、当前供货风险、其他提醒、数据核查，同组按可比已核验利润变化金额或销售规模；后者不是损失估算。利润复核同时包含负利润及低于已配置阈值的已核验利润。
- **DET**：SKU 详情按选择月份读取事实，不擅自切换到最新月。上方展示市场、Seller SKU、ASIN、报告版本和六项事实；下方为经营分析、库存与供货、处理记录三个键盘可操作分区。供货问题默认进入供应分区，其他问题可预展开证据。发货历史按站点隔离；MX 无已核验库存时不借用 US/CA。
- **上下文**：总览/简报与 SKU 详情携带站点、月份、搜索、问题类型和排序；后台库存、采购、发货、成本和供应链入口预填 SKU，并可返回原详情。返回列表时仅在同一数据版本下恢复本次浏览的卡片和滚动位置，刷新浏览器后不保证恢复滚动。共享国内采购与仓库账本明确标注，不能解释为站点独占库存。
- **ISS**：扩展现有 `/api/team` 和 `CollaborationTask`，不新建问题 API、数据库或主导航。店铺/市场/SKU 与问题类型形成稳定标识；首次基线与最新证据分别保留，重复建立复核更新证据但不覆盖人工结论。支持新发现、待复核、处理中、已处理、无需处理，已处理/无需处理的复核必须填写依据并确认。版本冲突与并发修改返回冲突提示；共用账号操作历史保留，不冒充个人身份。当前由人点击更新依据，不会因发布新报告自动刷新全部问题或判定动作效果。记录列表当前最多返回最近 100 条，尚未完成连续历史查询和会话级审计。
- **CALC**：保守、基准、提价三个自定义售价方案；没有完整有效期或使用手填费率时须人工确认。市场、类目、包装、箱规及费率改变后确认失效。费率配置可选 `validUntil`、`minimumReferralFee`、`referralTiers: [{maxPrice, percent}]`；后者是分段累进计算，超过最后一档使用 `referralPercent`。平衡售价使用相同最低/分段佣金函数求解，不以当前价的混合比例代替。低价配送优惠、非累进佣金和随价格变化的配送附加费尚未自动建模，须分方案核对，不声称已匹配 Amazon 官方费率。
- **导航与兼容**：业务后台按供货与仓库、产品与经营资料、运营协作、数据管理分组。修复经营报告契约不接受 `scheduled-worker` 导致自动发布后回退旧 Excel 的兼容问题。无效站点不静默切换 US；未知发货站点不映射为 US。

本轮验证：lint、TypeScript 检查、245 项 Web 测试、80 项 Python 测试（含编译 worker）、13 项生产模式浏览器回归和生产构建通过；手机截图检查通过。隔离旧版 SQLite 迁移保留两条原任务、备注和状态，并通过外键检查。首次浏览器回归因测试运营库未初始化出现数据页失败，按既有 StateDb 初始化新隔离库后完整重跑通过，不用真实生产数据库替代。实际 NAS、外部授权和费用口径不在这些模拟/本地结果的覆盖范围内。

### 升级与保留数据

本轮在账号/协作 SQLite 的 `CollaborationTask` 增加可空市场、问题标识、证据 JSON 和默认空历史 JSON，以及工作区/问题唯一索引。旧任务的站点为空，仍在共享任务页保留，不自动归到 US，也不伪造历史审计。现有启动脚本的 Prisma 同步负责增加字段；迁移前须备份账号/协作库、运营库、reports 和原 env。保留数据卷和 SECRET_KEY，禁止删除数据库或以新空库替代。NAS 试用版本及实际构建验收以仓库 `docker/nas/README.md` 和对应标签的 GitHub Actions 为准；尚未在真实 NAS 上验证迁移与恢复。

### V2.0 尚需继续完成

- product/listing/lot 主身份与 Seller SKU / ASIN 映射历史仍需完善；本轮 listing 标识只是现有单店市场/SKU 的稳定复合标识，不表示已经完成 Listing 级迁移。
- 指标字典的实际费用范围、退款归属、广告归因窗口、历史成本生效时点与真实积加样本对账；当前利润和退货仍遵守原来的核验标记，发布不会自动确认财务口径。
- 积加 FBA/广告/退货/仓储映射与全量核验、WPS 正式授权、无人值守任务在 NAS 的实际运行。调度与授权已有本地增量，未替用户启用或发布真实数据；新品 WPS 继续暂缓。
- 自动更新问题证据与复核状态、后续动作效果比较、记录连续查询、成本版本史、库存订单构成全面对账，以及可实际演练的备份恢复。
- 官方有效费率、价格相关配送函数与真实目录权限验收。生产构建仍出现已有 Next JSON 解析诊断（构建可完成），其根因未修复。

## 当前页面口径（2026-10-08）

本节覆盖历史设计文档中的成员角色、前台供应链入口和 PDF 简报要求。

- 所有人共用一个已有账号登录，无管理员/成员功能差异。不删除旧账号、任务或工作区；默认沿用最早创建的账号，也可通过 `SHARED_LOGIN_EMAIL` 指定已有账号。其他账号旧会话不能继续访问运营功能。各设备可同时登录，退出仅影响当前会话。
- 主导航仅为运营总览、SKU 经营简报、利润试算。库存、采购、发货、仓库、供应链、协作和数据更新折叠到业务后台；保留原有路由和数据链路。
- 总览按站点、月份显示销售额、实际利润、利润率、广告销售占比、退货率、库存覆盖。积加仅显示配置店铺 MEASUREMAN 的 US/CA/MX；AU 不加入。MX 使用 MXN。没有已核验库存的站点不借用 US 库存。金额不跨币种相加，经营指标不与库存快照混为同一周期。
- 所有前台经营展示以 SKU 为单位，不按父体汇总，不提供父体筛选；总览移除“五条建议”。总览默认不列 SKU，输入名称、SKU 或 ASIN 后最多预览三张卡片；简报默认 20 张，支持问题类型筛选及按需加载。单卡保留简短建议，可展开历史均价、六个月件数、广告投入、退货、仓储、季节性和库存日期。
- 库存新鲜度按当前日期重新计算，未提供数据用 `—` 表示。仅一个月销售额时不生成伪趋势；历史件数不等于历史金额。广告投入比例不代替广告销售占比。季节性仅为历史件数规律，不承诺未来增长。
- PDF 经营简报取消；保留网页卡片。旧选品 HTML 报告不是经营 PDF，不受影响。

### 积加依据与边界

2026-10-07 重新读取积加公开文档：[鉴权](https://open.gerpgo.com/document?id=596)、[产品表现](https://open.gerpgo.com/document?id=131)、[产品列表](https://open.gerpgo.com/document?id=53)。页面指标按 `orderProductSales`、`averagePrice`、`sellingPrice`、`adsSales`、`adsSpend`、`returnsRate`、`storageFee`、`salesNetProfit` 的事实维度重新组织。

已实现服务端凭证申请、独立 worker 全分页采集、店铺身份筛选、字段转换、差异预览、人工审核整批发布和报告回退。`GERPGO_STORE_NAME` 默认 MEASUREMAN，不按品牌/SKU 猜测店铺；不同店铺的旧 ERP 报告拒绝混用。核心采集覆盖最近六个完整月、当月和 FBA；全量选项补充逐日广告、退货和仓储，失败明示，不冒充完成。2026-10-08 已用真实授权取得核心分页，排除 AU 后生成 MEASUREMAN 的 3,443 条 US/CA/MX 站点/月/SKU 预览，校验通过，但历史金额存在差异，**尚未人工对账发布，网页仍用旧报告；定时同步尚未启用，费用明细尚未全面采集/核验，FBA 尚未覆盖 WPS 库存**。标准利润报告新增兼容性可选字段 `advertisingSales`、`averagePrice`、`asin`、`msku`、`sourceKind`；旧报告不必重建。不得把来源利润未经对账直接认定为本站完整实际利润。

本次修正版 v1.4.1 排除 AU 的页面、查询、预览发布和逐站点采集；兼容读取含 AU 的旧报告但不显示其行/月份。收缩范围发布保留其他站点历史和旧版本归档，不删除业务原始资料。NAS 升级需同版本 app/data-worker 及可写共享 reports/incoming/运营库，参见仓库 `docker/nas/README.md` 与 `measureman-data-worker.override.yml`。只更新 app 镜像不等于已启动后台采集。不修改 NAS、旧账号或业务记录；本地真实原始数据和凭证不进入 Git/镜像。

### NAS 积加授权配置

目标版本 `v1.3.11`，镜像 `ghcr.io/yinghuo202-rgb/amazon-insight:v1.3.11`，构建完成后再拉取。v1.3.10 引入网页凭证入口；v1.3.11 增加浏览器发送前的 HTTPS 拦截。

推荐：更新镜像并保留现有 Compose、数据卷和至少 32 字符的 `SECRET_KEY` → 通过 HTTPS 登录 → 业务后台 → 数据更新 → 在线数据来源 → 填写积加 appId / appKey → 保存积加凭证 → 测试积加连接。不需要在 NAS 环境文件里填写积加 Key，也不需要新数据卷或 Prisma 迁移。所有人共用账号，持有该账号的可信使用者均可修改凭证。

网页保存将整个凭证对用 AES-256-GCM 加密，保存到现有 `operations.sqlite3` 的单行配置表；保存与不含凭证的运行记录在同一事务中。随机 nonce，认证附加数据固定为积加配置上下文。加密密钥从现有 `SECRET_KEY` 派生，不保存在数据库；环境文件和运营数据库必须配套备份。修改 `SECRET_KEY` 会使旧凭证无法解密，需要恢复原值或重新填写。更新镜像不删除配置；新数据卷则不含旧配置。

输入框提交后清空，GET/POST 响应、日志、运行记录和浏览器存储均不返回/保存明文凭证；仅在提交请求和服务端使用时短暂存在。保存要求有效共用账号、本站 Origin、JSON 请求和 HTTPS（本机回环测试除外）。浏览器在发送前检查 HTTPS，防止误用内网 HTTP 地址传输密钥，服务端再校验。已有环境变量仍可作为未保存网页凭证时的回退；网页保存的完整凭证对优先使用，不混合两种来源。

如不使用网页保存，也可以将以下内容**追加**到现有 NAS 项目的环境文件，不要替换原文件，不改数据库卷、登录配置或 Cloudflare Token：

```dotenv
GERPGO_APP_ID=填写你的appId
GERPGO_APP_KEY=填写你的appKey
GERPGO_BASE_URL=https://open.gerpgo.com/api/open
GERPGO_SIGNING_ENABLED=true
GERPGO_TIMEOUT_MS=10000
```

1. 在积加开放平台将 **NAS 实际公网出口 IP** 加入白名单。不是内网 IP、网站域名、DNS 地址或 Cloudflare Tunnel 地址；出口变化后需更新白名单。
2. 使用环境文件模式时，导入本次修改的 Compose，或把其中五个 `GERPGO_*` 环境映射加入现有 `app.environment`。仅在 `.env` 中填写变量不会自动传入容器；只配置应用容器，不配置 cloudflared。重新创建应用容器并保留原有数据卷；仅重启不能应用环境变更。网页保存模式无需新增这些映射。
3. 保存凭证不等于验证通过。凭证有效、店铺可读才表示本次基本检查通过，不代表经营数据已经更新，也不证明销售/广告/库存接口权限全部开通。

签名按实际发送的紧凑 JSON 字节加 appKey 计算小写 MD5；店铺检查仅请求第一页的一条记录。超时、限流、权限和配置错误会明确提示，不显示原始响应。令牌仅在单次检查内存中使用，结束后不持久化；浏览器及 SQLite 只保存安全检查结果。连接检查复用现有数据更新 API 和 SQLite 运行/异常表，10 秒内重复检查会被拒绝。后续业务同步仍需独立验收，现有报告不会被连接检查覆盖。

设计参考 [Apple 布局规范](https://developer.apple.com/design/human-interface-guidelines/layout) 和公开 [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)。采用浅灰导航、白色内容、系统字体、克制的蓝色交互、细分隔和分层展开，不增加装饰性横幅。颜色为 `#f5f5f7`、`#ffffff`、`#1d1d1f`、`#6e6e73`、`#0071e3`，异常保留红/琥珀色。字体优先系统 SF / PingFang，不下载 Apple 字体或复制品牌素材；手机保留三个底部主入口、可见键盘焦点和减少动画设置。

### 积加与 WPS 的数据安排

完整页面安排、运营分析、积加与 WPS 自动同步、利润试算、供应链、部署及验收要求见 [运营工作台完整需求文档](docs/GERPGO_API_INTEGRATION_REQUIREMENTS.md)（v1.0 草案，2026-10-08）。这是目标需求，不表示自动同步已经实现；文档统一替代旧需求中的冲突口径。

| 来源 | 负责的数据 | 展示位置 |
| --- | --- | --- |
| 积加 | 销售额、成交价、广告销售及投入、退货、仓储、已对账利润、FBA 事实 | 总览、单 SKU 简报 |
| WPS 库存规划 | 国内库存、计划/未完成订单、发货及在途、目标覆盖和参考月销 | 业务后台；SKU 卡片只取覆盖背景 |
| WPS 新品资料 | 候选 SKU、采购成本及币种、单件包装、箱规、装箱数、调研备注 | 新品后台、利润试算自动带入 |
| 已确认费率配置 | 市场和类目佣金、包装配送档、头程线路及生效日期 | 利润试算 |

前台按“站点 + SKU”匹配，采集层保留店铺/MSKU、日期、币种和来源，未确认映射不合并。实际经营、当前库存和计划值分别保存；WPS 的参考月销不覆盖积加实际销量，US/CA 共用国内库存不重复相加。API 数据尚未核验前继续用旧 Excel 快照，不混加两个来源的同一月销售额。

数据更新页已增加积加/WPS 来源说明及配置链接入口。部署环境通过 `STORE_OPS_WPS_INVENTORY_URL`、`STORE_OPS_WPS_RESEARCH_URL` 设置 HTTPS 金山文档分享链接；空值为未配置，非法链接不输出，已配置也不会显示已连接或已同步。分享地址不是文件下载地址，不能当作 XLSX 直接读取。

2026-10-07 已在用户确认后登录 WPS，成功下载库存规划并使用现有导入预览识别五个工作表；已放入本地待发布批次 `batch-wps-inventory-20261007`，尚未发布到网站，未修改源表；本地忽略的 `.env.local` 已配置库存分享入口，不提交分享地址。预览行数不等于去重后的有效 SKU 数，下载时间也不等于库存盘点时间。新品文档链接尚未提供。

长期方案优先使用 [金山文档授权下载流程](https://developer.kdocs.cn/server/example/personal-files.html)：服务端 OAuth 授权后获取下载地址，必要时将在线表格导出 XLSX，复用现有导入预览/发布链路。Mac 浏览器登录成功不等于 NAS 获得长期授权；不导出浏览器 Cookie、不硬编码临时下载地址，不要求把表格公开。当前没有实现 WPS OAuth、定时下载或自动发布。

### 利润试算配置

默认 US、广告 15%、退货 1%、税 0%，不计危险品、电池费用。选择产品带入成本、装箱量和包装；输入箱规计算体积头程：`长cm × 宽cm × 高cm / 1,000,000 × 市场币种每m³费用 / 装箱件数`。只适用于按体积计费的路线，最低收费、重量计费、月仓储和其他附加费未包含。

可在部署环境配置 `STORE_OPS_PROFIT_FEE_RULES` 为 JSON 数组，每条包含：

| 字段 | 口径 |
| --- | --- |
| `market`, `category`, `effectiveDate` | 站点、已确认的佣金类目映射、生效日期 YYYY-MM-DD |
| `referralPercent` | 确认后的类目佣金百分比，0–100 |
| `freightPerM3` | 预设体积头程费，使用所选站点币种 |
| `fbaTiers` | 数组，每项 `maxWeightG`, `maxLengthCm`, `maxWidthCm`, `maxHeightCm`, `fee` |

单件包装尺寸由大到小匹配配送档位，必须同时满足重量与尺寸上限；缺少单件包装资料时不自动匹配。取最近已生效的站点/类目配置，允许确认值覆盖；内部产品类目不自动等于 Amazon 类目。配置默认为空，**没有预装未经确认的 Amazon 官方费率**。切换站点清除售价、采购成本和费用覆盖值，防止混币。输入金额/费率无效或缺失时不出结果。

### 验证

`test:e2e` 使用生产构建、独立测试端口 3107，需要先初始化临时账号 SQLite 并设置 `E2E_TEST_DATABASE_URL`，另用初始化后的运营库副本设置 `E2E_TEST_STATE_DB`，不得指向生产库；读取报告仍用现有测试快照。可设置 `E2E_BROWSER_CHANNEL=msedge` 使用已安装浏览器。测试覆盖共用登录、六项指标、卡片搜索/展开、MX 切换、390px 无横向溢出、费用重算及伪造会话拒绝；积加凭证强制为空，新增检查覆盖未配置凭证和未登录拒绝，不接触真实 API。

2026-10-07 本地验证：lint、TypeScript、158 个单元测试（CI 子集 132 项）、53 项自动化测试、生产构建与 standalone 启动通过；7 个浏览器交互测试通过，桌面和手机截图位于 `automation/runtime/reports/ui-review-20261007/`。新增测试覆盖签名原始字节、凭证保护、无效配置、权限部分成功、限流、运行/异常记录及恢复、加密配置更新/回滚、密钥变更/篡改检测、HTTPS/同源保护和网页输入清空/刷新后保留；HTTP 页面在浏览器端拦截并清空密钥，测试验证 fetch 不执行。真实凭证未提供，外部请求均为模拟验证。构建过程仍有非阻断的 JSON 解析诊断，来源尚未定位；standalone 页面测试未复现。镜像通过现有 GitHub Actions 发布，构建状态以对应版本工作流为准；尚未验证 NAS/Cloudflare 线上环境或真实积加授权。

一个本地优先的 Amazon US 选品与运营工作台。当前包含两条主链路：

> 这是独立的 **Measureman Commerce OS**，不属于“接力”项目，也不共享接力的用户、项目、任务、数据库或 NAS 持久化目录。

`关键词输入 -> 候选商品发现 -> 手动选择主商品 / 参考竞品 -> 市场分析 -> Inspiration`

`只读业务表格 -> store-ops 标准 JSON -> 库存看板 -> 75 天补货模拟 -> SKU 决策清单`

## 技术栈

- Next.js App Router + TypeScript + Tailwind CSS
- Prisma + SQLite
- Zod
- Recharts
- Jungle Scout live / mock 双模式
- 模板化 Inspiration 适配器

## 核心路由

- `/` 首页搜索页
- `/search?q=...` 候选商品结果页
- `/product/[asin]?analysisId=...` 分析与 Inspiration 页
- `/product/[asin]/report?analysisId=...` 可分享的完整 HTML 报告
- `/inventory` 运营总览
- `/inventory/brief` 单 SKU 卡片式经营简报
- `/inventory/supply-chain` 业务后台供应链追溯
- `/inventory/calculator` 新品利润试算
- `/inventory/warehouse` 仓库台账（入库、出库、调拨、调整、批次、审核和流水）
- `/inventory/team` 登录后的共享协作空间（成员、SKU 任务、认领与状态）

首次打开 `/inventory` 会跳转到 `/login`。首次部署创建共用账号；已有部署沿用首个账号或配置指定账号，不再创建成员。认证会话写入 SQLite 的 `User` / `Session` 表，协作任务写入同一工作区数据库；不与接力项目共享。

## 库存数据接入

Web 项目不会直接打开或修改 Excel。先从上两级 `automation` 目录生成标准数据：

```powershell
powershell -ExecutionPolicy Bypass -File .\ops.ps1 build-inventory-dashboard-data
```

页面默认读取：

```text
automation/runtime/reports/inventory_dashboard.json
```

也可以通过 `STORE_OPS_DASHBOARD_DATA` 指定另一份兼容 JSON。驾驶舱支持调整船期、销量情景、目标覆盖、安全库存和目标 ACOS，并联动库存及广告动作；所有建议仅为草案。AWD 入库缺少 ETA 时不会计入可用库存，缺日销或装箱量的 SKU 会进入“检查数据”。

## 本地启动

1. 安装 Node 20+
2. 复制环境变量模板

```bash
copy .env.example .env
```

3. 初始化数据库并生成 Prisma Client

```bash
npm run db:push
npm run db:generate
```

4. 启动开发环境

```bash
npm run dev
```

## Jungle Scout 凭证

支持两种方式：

1. 在 `.env` 提供 `JS_API_KEY_NAME` 和 `JS_API_KEY`
2. 在项目根目录放一个 `api.txt`

认证格式必须是：

```text
KEY_NAME:API_KEY
```

如果 `api.txt` 里只有 API Key，也可以：

- `api.txt` 只放 API Key
- 通过页面配置卡片或 `.env` 补 `JS_API_KEY_NAME`

如果凭证不完整，系统会给出明确诊断并自动回退 mock。

## HTML 报告

分析页支持导出完整 HTML 报告：

- 浏览器打开：`/product/[asin]/report?analysisId=...`
- 直接下载：`/product/[asin]/report?analysisId=...&download=1`

这个报告是独立 HTML，带内联样式，不依赖前端运行时，适合：

- 发给同事评审
- 存档
- 打印
- 在离线环境查看

## 构建与发布

`npm run build` 现在会输出 Next standalone 产物，并自动把运行时需要的静态资源和本地数据复制进去。

### 普通运行

```bash
npm run build
npm run start
```

### Standalone 运行

```bash
npm run build
npm run start:standalone
```

也可以直接运行：

```bash
node .next/standalone/server.js
```

适用于 Windows、macOS、Linux。需要时可以通过环境变量指定：

- `PORT`
- `HOSTNAME`
- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`

## NAS Docker Compose 部署

生产环境由两个独立容器组成：`reverse-proxy` 和 `web`。NAS 只拉取 Docker 镜像，不在设备上编译源码；选品数据库、运营状态、标准报表和导出文件均保存在独立的 NAS 目录中，原始业务文件以只读方式挂载。

### 1. 在开发机或 CI 构建镜像

构建上下文必须使用上两级 `automation` 目录：

```bash
cd automation/integrations/amazon-insight
cp .env.nas.example .env
# 将 WEB_IMAGE 改成实际镜像仓库与固定版本
docker compose -f compose.yaml -f compose.build.yaml build web
docker compose -f compose.yaml -f compose.build.yaml push web
```

### 2. 在 NAS 准备独立目录

```bash
mkdir -p /volume1/docker/measureman-commerce/deploy/infrastructure
mkdir -p /volume1/docker/measureman-commerce/data/{app,runtime}
sudo chown -R 1000:1000 /volume1/docker/measureman-commerce/data
```

首次迁移时，把当前 `automation/runtime/` 的内容完整复制到 `RUNTIME_DATA_PATH`，否则容器虽然可以启动，但库存、销量和采购页面没有现有标准数据：

```bash
rsync -a automation/runtime/ /volume1/docker/measureman-commerce/data/runtime/
```

把 `compose.yaml`、`.env.nas.example` 和 `infrastructure/nginx.conf` 复制到部署目录，然后：

```bash
cd /volume1/docker/measureman-commerce/deploy
cp .env.nas.example .env
# 编辑镜像、NAS 地址、数据源目录及 API 凭证
docker compose config
docker compose pull
docker compose up -d
docker compose ps
```

默认访问地址为 `http://NAS_IP:3001`。持久化目录与接力项目完全分开：

- `/volume1/docker/measureman-commerce/data/app`：选品 SQLite 数据库。
- `/volume1/docker/measureman-commerce/data/runtime`：运营状态库、标准 JSON、图片和导出文件。
- `SOURCE_DATA_PATH`：只读业务源文件目录。

容器启动时会先执行 `prisma db push`，因此新 NAS 数据目录会自动创建登录与协作表。HTTP 直连 NAS 时保持 `AUTH_SECURE_COOKIE=false`；如果在上游反代接入 HTTPS，再改为 `true`。

接力项目继续使用自己的 `task-platform/compose.yaml`、容器名、端口和 `/volume1/docker/task-platform/data`，两套 Compose 可以分别升级与重启。

## 常用脚本

```bash
npm run dev
npm run build
npm run start
npm run start:standalone
npm run lint
npm run test
npm run test:e2e
npm run db:push
npm run db:studio
```

`npm run test` 包含依赖 `automation/runtime` 运营快照的本地集成测试；GitHub Actions 使用 `npm run test:ci` 运行不含业务数据的单元测试集合，避免把生产报表提交进仓库。

## 当前限制

- SP-API 仍然只是占位 adapter，不参与主链路
- Inspiration 默认由规则和模板生成，不调用真实 LLM
- Jungle Scout 某些分析接口若返回不完整，会在 UI 中标记 `partial`

## 冠唐云仓库功能复刻规划

项目计划在管理员后台增加轻量仓库管理模块，并逐步接入或替代冠唐云的日常仓库流程。功能边界、数据模型、迁移顺序和验收标准见：

- [冠唐仓库模块 README](./docs/guantang-wms/README.md)
- [冠唐数据联动与新品利润试算方案](./docs/GUANTANG_DATA_LINKAGE_AND_CALCULATOR_AUTOMATION.md)

当前已落地仓库首期账本和成员供应链/利润试算入口。冠唐 API 和市场类目费率表尚未接通，因此仓库数据需要管理员录入，Amazon 佣金、FBA 费和头程需要按当期费率确认后输入；具体边界见模块 README 的“当前实现状态”。

## 本次实施状态与部署增量

本次为需求实施的前三批增量，不是全计划完成或已发布的新镜像。既有账号、人工修改记录、业务后台和数据卷保留；未自动修改 NAS、提交、推送或上线。

### 已实现

- 上传发布、启动补种、报告重建、本地来源更新及回退使用同一报告版本机制：生成 `reports/.versions/<版本>/reports`，校验 JSON 后原子替换 `reports/current.json`。没有版本指针的旧目录仍可读；旧根目录 JSON 不再代表已发布最新版本，不要让外部脚本继续直接覆盖它们。
- 总览、简报、试算的多报告读取固定版本；经营查询按站点、月份、搜索和真实提醒类型筛选。总览最多三张搜索预览，简报每批二十张连续加载，版本改变时要求重新加载，不混接两批。
- 月度利润导入保留历史月份，不再仅保留各站最新月。销售额、来源利润趋势不连接缺失月份，不混币；未核验利润、退货口径、样本不足和过期库存有明确提示。
- 数据更新页可配置站点和单 SKU 提醒，字段级继承单 SKU → 站点 → 初始值，保存操作记录到既有运营库；配置无法读取时暂停提醒。ACOS 不使用统一警报线，试算假设不影响经营提醒。
- 积加采集复用既有服务端凭证和签名模块。全分页校验总数、页码、重复页/记录和缺页；限流最多三次退避重试。初次采集最近六个完整月、当月至今和当前 FBA，先生成差异预览，不直接覆盖报告。
- 重建与积加采集进入现有运营库的任务队列，同镜像 worker 串行执行、心跳与租约校验，重复提交同类型在途任务不重复执行；中断任务要求人工检查后重提，不盲目重放可能已发布的任务。
- 利润试算的产品选择包括现有新品调研（支持只有名称的候选），不会用固定汇率把人民币采购价猜成美元成本；缺少数据仍需输入确认。

### 独立 worker

构建现有根目录 Dockerfile 会包含 worker，未增加第三方依赖。根目录 Compose 的增量模板为 `docker/compose.worker.example.yml`，仅作为合并参考，不自动导入。使用与 app **完全相同的固定镜像版本、SECRET_KEY、运营库、runtime 和只读源文件挂载**。不要另建空运营库；不要替换已有 .env、登录库或 Cloudflare 配置。

worker 跳过网页启动脚本和 Prisma 迁移，命令为 `node /app/worker/worker/data-worker.js`，不监听端口，不使用网站的 HTTP 健康检查。先让 app 完成原有数据库初始化再启动 worker。网页任务持续“已排队”通常表示 worker 尚未运行。暂存证据位于原 runtime 卷的 `incoming/gerpgo/<任务编号>`，仅服务端保存；普通网页不会返回整批原始数据。

升级前备份原 runtime、登录库与现有 .env。版本目录会增长，本批尚未提供自动清理；不要删除当前指针引用的版本，回退功能保留“某次导入前快照”的既有含义。回退代码必须保留版本解析模块，不可直接降到不认识指针的旧镜像。

### 尚未完成与需验收

- 积加真实租户样本、店铺分页总数口径及 SKU/金额对账。已实现文档字段适配、差异预览和人工发布；这不等于实际授权与费用对账通过，FBA V2 响应字段仍未核验。
- 每日经营/四小时 FBA 调度、后续当月和上月增量、首次确认后的自动发布；当前 worker 只执行人工提交，状态不表示自动同步已开启。
- WPS 正式应用授权及 NAS 无人值守下载仍未完成。本轮已使用 Mac 现有浏览器登录态下载库存表，通过下述只读接收命令生成导入批次；不导出 Cookie、不把 Mac 登录态复制到 NAS。新品表按当前要求暂缓。
- 协作记录的基线版本和比较周期复核，以及供应链导入、连续查询、订单构成对账。现有仓库和分配功能保留，本批未将这些增强标为完成。
- API 经营费用以可空契约接入；旧 Excel 库存业务明细仍保留原数值契约，完整兼容迁移及真实在途、AWD 与 FBA 转运对账尚未完成。前台供应覆盖不另加 AWD 转运量；非零在途或 AWD 需快照标记 `inTransitConfirmed` / `awdAvailableConfirmed`，旧报告未确认时显示待核查，不触发供应覆盖判断。
- 官方有效费率、真实 NAS 目录权限和真实授权另行验收；模拟接口与本地构建不能替代。当前仍有历史 Next 构建 JSON 解析诊断，构建退出成功但其原因尚未消除。

### 第二批：经营报告审核发布

- 在原“数据更新”页查看全批差异和每批 20 条 SKU 对账明细，人工确认后交给同一 worker 发布。校验失败禁止发布；完整月销售额或同范围 SKU 数修订超过 10% 显示重点审核，当月累计额增长不触发金额保护。目前每批均人工确认，尚未开启自动发布。
- 经营事实使用产品接口精确 SKU 和店铺 marketId/amazon-us、amazon-ca、amazon-mx 映射；拒绝缺页、重复证据、缺失销售件数/商品销售额、混币或未知映射，不猜测 SKU 别名。父体汇总明确跳过，多个 Listing 汇总至单 SKU；均价用总金额/总件数，不累加 Listing 均价。
- 规范报告 `gerpgo-performance.json` 由已批准的站点/月度范围整批覆盖前台经营事实，未覆盖历史沿用 Excel。费用、退货缺失为 null；来源利润、退货一直标为未核验，不因确认发布自动变成已对账。产品主档人工记录及库存报告不被此次采集覆盖。
- 预览绑定报告内容基线与暂存内容哈希；确认后若数据变化、预览超过七天或 worker 租约失效，会拒绝发布，旧报告保留。同一当前预览重复执行不再次切换版本。回退仍使用既有“导入前快照”，可移除新加的规范报告。
- 新增 `preview-gerpgo` / `publish-gerpgo` 复用既有 Python CLI 和 SQLite 审计；沿用 `STORE_OPS_STATE_DB`（不另建运营库）。前端只收到标准化小批明细和安全摘要，不提供原始接口响应、Token 或密钥。
- 尚未实现自动调度、正式 WPS 下载、费用口径批准、FBA 字段映射或供应链新增联动；不会将测试数据发布到现有 runtime 或 NAS。本次无 Git 提交、镜像推送或 NAS 配置修改。

### 第三批：完整来源采集与 WPS 下载接收

- 积加增加广告、退货、月度仓储接口。广告按官方要求逐站点逐日查询（开始、结束日期相同），退货按退货日期窗口，仓储按年份、月份。覆盖最近六个完整月和当月；其他长期仓储、销售订单、采购等接口尚未加入，不能称为全部开放平台接口接通。
- 官方店铺响应中 rows 为卖家/区域分组，extObj.marketCount 对应站点总数；仅存在该明确计数依据时按子站点数校验。不猜测其他分页结构，重复、漂移或缺页仍拒绝。长任务在令牌有效期的 80% 时续取，凭证和令牌始终留在服务端。
- 单一接口失败不丢弃其他接口已经采集的分页；同接口后续范围标为跳过，避免重复触发权限/服务失败。页面“查看采集明细”分域显示完成、失败、跳过、页数和条数；基础域不完整阻止审核发布，补充域失败明确显示未完成，绝不宣称全部成功。
- 审核发布同时原子保存 gerpgo-performance.json 与仅服务端可用的 gerpgo-source-data.json，后者保留全部成功采集的原始字段、范围及失败清单。原始数据哈希变化会阻止整批发布；未核验的 FBA、费用和产品资料映射不覆盖人工/Excel 业务事实。
- 现有浏览器自动下载后的文件用原解析器接收，源文件不移动、不覆盖，接收过程写现有 SQLite 审计；仅生成待确认批次，不自动发布。命令在 automation 目录执行，路径由当前部署配置决定：

```sh
python -m store_ops.uploaded_data receive-wps \
  --source-file "/path/to/downloaded/库存规划.xlsx" \
  --share-url "https://www.kdocs.cn/l/cg2kkbtoinHk"
```

- 接收批次位于 STORE_OPS_UPLOAD_ROOT 或原 runtime/uploads。使用网站已有上传批次预览和确认发布，不创建新的上传 API。若浏览器在 Mac、网页在 NAS，须通过已有网页上传把文件送到 NAS；Mac 本地批次不会自动变成 NAS 上的批次。下载登录失效需重新登录，当前没有 NAS 浏览器无人值守调度。
- 库存表的“最近月销”与“参考月销”分别存为 planningMonthlySales / referenceMonthlySales，不从文件下载时间推造实际销量月份，不覆盖销售历史或实际日销。无明确业务日期的文件标记 businessDateUnknown / isStale，保留旧业务日期，不能仅因重新下载变成新库存快照。
- 读取有效 SKU、空行、无效 SKU 和重复项；重复 SKU 禁止发布。发布前重新核对文件哈希，损坏文件不能发布。工厂库存与已下订单合计的旧库存字段仍存在口径兼容限制，不能解释为已核验国内现货。

官方参数依据：[店铺](https://open.gerpgo.com/document?id=153)、[广告](https://open.gerpgo.com/document?id=98)、[退货](https://open.gerpgo.com/document?id=9)、[月度仓储](https://open.gerpgo.com/document?id=30)。真实授权和来源对账仍需本地可访问凭证或 NAS 运行验收，单元测试不能替代。
