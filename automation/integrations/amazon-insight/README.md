# Amazon Selection Workbench Web V1

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
- `/inventory` 经营、广告、FBA / AWD 库存、参数模拟和运营待处理清单
- `/inventory/team` 登录后的共享协作空间（成员、SKU 任务、认领与状态）

首次打开 `/inventory` 会跳转到 `/login`。首次部署先创建管理员，之后管理员可在“团队协作”页面创建成员账户。认证会话写入 SQLite 的 `User` / `Session` 表，协作任务写入同一工作区数据库；不与接力项目共享。

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
