# Amazon Selection Workbench Web V1

## 当前页面口径（2026-10-07）

本节覆盖历史设计文档中的成员角色、前台供应链入口和 PDF 简报要求。

- 所有人共用一个已有账号登录，无管理员/成员功能差异。不删除旧账号、任务或工作区；默认沿用最早创建的账号，也可通过 `SHARED_LOGIN_EMAIL` 指定已有账号。其他账号旧会话不能继续访问运营功能。各设备可同时登录，退出仅影响当前会话。
- 主导航仅为运营总览、SKU 经营简报、利润试算。库存、采购、发货、仓库、供应链、协作和数据更新折叠到业务后台；保留原有路由和数据链路。
- 总览按站点、月份显示销售额、实际利润、利润率、广告销售占比、退货率、库存覆盖。支持 US/CA，MX 有经营报告时也可查看，但不猜测 MX 库存。金额不跨币种相加，经营指标不与库存快照混为同一周期。
- 所有前台经营展示以 SKU 为单位，不按父体汇总，不提供父体筛选；总览移除“五条建议”。总览默认不列 SKU，输入名称、SKU 或 ASIN 后最多预览三张卡片；简报默认 20 张，支持问题类型筛选及按需加载。单卡保留简短建议，可展开历史均价、六个月件数、广告投入、退货、仓储、季节性和库存日期。
- 库存新鲜度按当前日期重新计算，未提供数据用 `—` 表示。仅一个月销售额时不生成伪趋势；历史件数不等于历史金额。广告投入比例不代替广告销售占比。季节性仅为历史件数规律，不承诺未来增长。
- PDF 经营简报取消；保留网页卡片。旧选品 HTML 报告不是经营 PDF，不受影响。

### 积加依据与边界

2026-10-07 重新读取积加公开文档：[鉴权](https://open.gerpgo.com/document?id=596)、[产品表现](https://open.gerpgo.com/document?id=131)、[产品列表](https://open.gerpgo.com/document?id=53)。页面指标按 `orderProductSales`、`averagePrice`、`sellingPrice`、`adsSales`、`adsSpend`、`returnsRate`、`storageFee`、`salesNetProfit` 的事实维度重新组织。

当前仍使用现有标准化 Excel 快照。已实现服务端凭证申请和只读店铺权限检查，**尚未实现业务分页拉取、定时同步与字段转换，也未用真实凭证验证授权**。标准利润报告新增兼容性可选字段 `advertisingSales`、`averagePrice`、`asin`、`msku`、`sourceKind`；旧报告不必重建。不得把积加销售净毛利未经对账直接认定为本站实际利润。

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

详细字段、同步与验收设计见 [积加接入需求的当前实施口径](docs/GERPGO_API_INTEGRATION_REQUIREMENTS.md#0-当前实施口径2026-10-07)。这是接入设计，不表示自动同步已经实现。

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
