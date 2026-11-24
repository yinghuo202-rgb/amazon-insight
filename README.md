# Measureman Commerce OS · 极空间 NAS 部署

本目录是电商运营看板的 Docker 发布根目录。镜像由 GitHub Actions 构建并发布到 GHCR，极空间 NAS 通过 Docker Compose 拉取和运行镜像。接力项目使用独立目录、镜像、端口和数据卷。

## GitHub 自动构建

推送到 `main` 或手动运行工作流，会构建 `linux/amd64` 和 `linux/arm64`，并发布：

```text
ghcr.io/<owner>/<repository>:latest
ghcr.io/<owner>/<repository>:<完整提交 SHA>
```

工作流使用 GitHub 内置 `GITHUB_TOKEN`，不会把 GHCR 密码写入仓库。

## NAS 初始化

```sh
cd /docker/measureman-commerce
mkdir -p data/app data/runtime data/sources logs backups .docker
cp .env.example .env
```

编辑 `.env`：

```env
IMAGE_REPOSITORY=ghcr.io/你的用户名/你的仓库名
IMAGE_TAG=latest
SECRET_KEY=一段足够长的随机字符串
APP_PORT=3000
```

私有 GHCR 仓库只在 NAS 登录，令牌保存在 NAS 的 Docker 配置，不提交 GitHub：

```sh
DOCKER_CONFIG="$PWD/.docker" docker login ghcr.io
docker compose pull app
docker compose up -d app
docker compose ps
docker compose logs -f app
```

停止服务：`docker compose stop app`。首次访问 `http://NAS_IP:3000/login` 创建管理员账户。

## 持久化与健康检查

- `data/app`：SQLite 数据库，包括登录、用户、协作和选品数据。
- `data/runtime`：运营标准 JSON、运行状态和导出文件。
- `data/sources`：原始业务源文件，只读挂载。
- `logs`：日志挂载目录；容器日志同时输出到 stdout。
- `backups`：更新脚本自动保存数据库副本。

容器使用 `restart: unless-stopped`，`GET /health` 返回 `{"status":"ok"}`。启动时会同步 Prisma 数据库结构，业务数据始终位于挂载目录。

## 手动更新和回滚

```sh
./update.sh
./update.sh <完整提交 SHA>
```

脚本会先备份 `data/app/selection.db`，再拉取镜像、只更新应用容器并清理无引用镜像。回滚时指定旧提交 SHA 即可：

```sh
./update.sh <旧提交 SHA>
```

涉及数据库结构变化时，先确认 `backups/` 有可用备份；恢复时停止容器，将备份复制回 `data/app/selection.db` 后重新启动。

## Watchtower 自动更新

Compose 只给 `app` 加 Watchtower 标签。完成 NAS GHCR 登录并生成 `.docker/config.json` 后运行：

```sh
docker compose --profile watchtower up -d watchtower
docker compose logs -f watchtower
```

Watchtower 只更新带指定标签的业务容器，发现 `latest` 新镜像后自动更新并清理旧镜像；停止自动更新：`docker compose --profile watchtower stop watchtower`。

## 本地检查

生产 Compose 使用 `image`，NAS 不编译源码。提交前可执行：

```sh
docker build --platform linux/amd64 -t measureman-commerce:local .
```

`.env`、`.docker/config.json`、数据库、业务数据和日志已排除；只有 `.env.example` 提交到 GitHub。前端和自动化说明见 [`automation/README.md`](automation/README.md)。

## 积加 ERP（GerpGo）与网页悬浮销售胶囊

系统内置轻量化网页悬浮销售胶囊，连接积加开放平台后可在页面角落实时展示今日销售额、店铺明细及订单/退款/Review 动态事件，并支持拖动、收起和演示模式：

- 在 `.env` 中配置 `GERPGO_APP_ID`、`GERPGO_APP_KEY`（可选 `GERPGO_BASE_URL`），或登录后访问 `/settings` 在“积加 ERP 销售接入”卡片加密保存。
- 网页右下角胶囊通过 `/api/sales-bubble` 自动同步并按店铺时区汇总当日业绩；首次同步会建立基线游标，避免历史订单刷屏。

## 亚马逊 / 1688 爬虫数据接入

外部爬虫脚本可使用 `.env` 中的 `CRAWLER_INGEST_TOKEN`（通过请求头 `Authorization: Bearer <token>`）向以下端点推送采集结果：

- `POST /api/crawlers/ingest/amazon`：接收亚马逊商品快照（`items[]` 含 `asin`、`marketplace`、`title`、`price`、`rating`、`reviews`、`bsrRank`、`monthlySalesEst` 等，设置 `syncToPool: true` 可同步写入选品池）。
- `POST /api/crawlers/ingest/1688`：接收 1688 供应商报价（`items[]` 含 `offerId`、`title`、`unitPriceRmb`、`moq`、`leadTimeDays`、`linkedAsin`、`linkedSku` 等）。
- `GET /api/crawlers/ingest/amazon` 与 `GET /api/crawlers/ingest/1688`：支持按 `asin` / `sku` / `marketplace` 查询最近入库的采集记录。
