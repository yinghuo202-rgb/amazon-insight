# Measureman Commerce OS · 在线部署交接单

交接日期：2026-08-07  
目标仓库：[yinghuo202-rgb/amazon-insight](https://github.com/yinghuo202-rgb/amazon-insight)  
目标镜像：`ghcr.io/yinghuo202-rgb/amazon-insight`

## 已交付

- 根目录多阶段 Dockerfile，构建后运行 Next standalone 和 Store Operations Python 运行时。
- `compose.yaml`，生产环境只使用 `image`，支持数据、运行状态、源文件和日志挂载。
- `.github/workflows/docker-image.yml`，推送 `main` 或手动触发后构建并发布 `linux/amd64`、`linux/arm64`。
- `update.sh`，更新前备份 SQLite、按 `latest` 或提交 SHA 更新应用、清理无引用镜像。
- 可选 Watchtower profile，只更新带指定标签的 `app` 容器。
- `GET /health` 健康检查接口。
- 登录、管理员初始化、多用户协作、SKU 订单明细和 NAS 持久化已包含在前端代码中。

## GitHub 接管步骤

当前本地目录没有远程仓库、没有提交记录，也没有可用的 GitHub CLI 登录状态，因此本包没有自动推送代码。授权后在本包根目录执行：

```sh
git init
git branch -M main
git remote add origin https://github.com/yinghuo202-rgb/amazon-insight.git
git add .
git commit -m "Prepare Docker deployment handover"
git push -u origin main
```

如果目标仓库已有内容，请先确认是否需要合并，再执行 `git pull --rebase origin main`，不要直接覆盖远程分支。

## GHCR / GitHub Actions

推送成功后，Actions 会发布：

```text
ghcr.io/yinghuo202-rgb/amazon-insight:latest
ghcr.io/yinghuo202-rgb/amazon-insight:<完整提交 SHA>
```

目标仓库需要允许 Actions 写入 Packages。若 GHCR 包为私有，NAS 端使用拥有 `read:packages` 权限的令牌登录，不要把令牌写入 `.env`、Compose 或 GitHub 文件。

## 极空间 NAS 首次部署

```sh
mkdir -p /docker/amazon-insight/data/app /docker/amazon-insight/data/runtime /docker/amazon-insight/data/sources /docker/amazon-insight/logs /docker/amazon-insight/backups /docker/amazon-insight/.docker
cd /docker/amazon-insight
cp .env.example .env
```

至少编辑 `.env`：

```env
IMAGE_REPOSITORY=ghcr.io/yinghuo202-rgb/amazon-insight
IMAGE_TAG=v1.0.0
SECRET_KEY=生成一段足够长的随机字符串
APP_PORT=3001
```

私有 GHCR 镜像：

```sh
DOCKER_CONFIG="$PWD/.docker" docker login ghcr.io
```

启动：

```sh
docker compose pull app
docker compose up -d app
docker compose ps
docker compose logs -f app
```

首次打开 `http://NAS_IP:3001/login` 创建管理员账户。

## 数据迁移与备份

- `data/app/selection.db`：登录、协作、选品和本地业务数据库。
- `data/runtime/`：运营 JSON、运行状态、导出文件。
- `data/sources/`：原始业务源文件，只读挂载。
- `logs/`：日志目录。
- 更新脚本默认在 `backups/` 保存数据库副本。

迁移现有数据时，只复制已确认的 `automation/runtime/` 业务快照到 NAS 的 `data/runtime/`；原始工作簿不要写入镜像。数据库结构变化前先停止容器并备份 `selection.db`。

## 验收记录

- 前端 lint 通过。
- 17 个测试文件、71 个测试通过（SQLite 并发锁场景已用单 worker 复验）。
- Next production build 通过。
- standalone `GET /health` 返回 HTTP 200。
- 无 Cookie 访问业务页面跳转 `/login`，受保护 API 返回 401。
- 当前机器未安装 Docker CLI，尚未在本机执行 `docker build`、`docker compose` 或 GHCR 推送。

## 交接后的操作边界

- GitHub：代码、Dockerfile、Compose、Actions 和文档。
- GHCR：版本化应用镜像。
- 极空间 NAS：`.env`、Docker 登录配置、数据库、业务数据、运行数据和备份。
- 任何密码、Token、原始业务文件和生产数据库都不得提交到 GitHub。
