# Measureman Commerce OS · 极空间 NAS 部署

本目录是电商运营看板的 Docker 发布根目录。镜像由 GitHub Actions 构建并发布到 GHCR，极空间 NAS 通过 Docker Compose 拉取和运行镜像。接力项目使用独立目录、镜像、端口和数据卷。

## GitHub 自动构建

推送到 `main` 或手动运行工作流，会构建 `linux/amd64` 和 `linux/arm64`，并发布：

```text
ghcr.io/<owner>/<repository>:latest
ghcr.io/<owner>/<repository>:<完整提交 SHA>
ghcr.io/<owner>/<repository>:v1.0.0
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
IMAGE_TAG=v1.0.0
SECRET_KEY=一段足够长的随机字符串
APP_PORT=3001
```

私有 GHCR 仓库只在 NAS 登录，令牌保存在 NAS 的 Docker 配置，不提交 GitHub：

```sh
DOCKER_CONFIG="$PWD/.docker" docker login ghcr.io
docker compose pull app
docker compose up -d app
docker compose ps
docker compose logs -f app
```

停止服务：`docker compose stop app`。首次访问 `http://NAS_IP:3001/login` 创建管理员账户。

## Cloudflare Tunnel（可选）

项目内置了一个独立的 `cloudflare` Compose profile。它不会开放 NAS 管理端口，也不会默认启动；启用后，`cloudflared` 会加入和 `app` 相同的 Docker 网络，Cloudflare Tunnel 的 Published application 应指向 `http://app:3000`。

先在 Cloudflare 控制台创建或轮换 Tunnel Token，再在 NAS 保存到未纳入 Git 的文件：

```sh
cd /docker/measureman-commerce
mkdir -p secrets
vi secrets/cloudflare-token.txt
chmod 600 secrets/cloudflare-token.txt
```

在 Cloudflare Tunnel 路由中设置：

```text
Hostname: ops.example.com
Service:  http://app:3000
```

启动应用和 Tunnel：

```sh
docker compose pull app cloudflared
docker compose --profile cloudflare up -d app cloudflared
docker compose ps
docker compose logs --tail=100 cloudflared
```

停止 Tunnel：`docker compose --profile cloudflare stop cloudflared`。不要把 Token 写入 `.env`、Compose、GitHub 或聊天记录；只保存在 NAS 的 `secrets/cloudflare-token.txt`。

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

生产环境默认固定版本，不建议直接跟随 `latest`。只有确认新版本数据库兼容并接受自动升级风险时，才启用 Watchtower。Compose 只给 `app` 加 Watchtower 标签；完成 NAS GHCR 登录并生成 `.docker/config.json` 后运行：

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
