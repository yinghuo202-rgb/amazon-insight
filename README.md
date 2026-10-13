# Measureman Commerce OS · 极空间 NAS 部署

本目录是电商运营看板的 Docker 发布根目录。镜像由 GitHub Actions 构建并发布到 GHCR，极空间 NAS 通过 Docker Compose 拉取和运行镜像。接力项目使用独立目录、镜像、端口和数据卷。

## 当前交付与操作入口（2026-10-13）

已验证镜像：`ghcr.io/yinghuo202-rgb/amazon-insight:v1.5.0-rc.14`，代码提交 `59068c6fee0fb91541d21b5228de6aa260c23b50`。[构建记录](https://github.com/yinghuo202-rgb/amazon-insight/actions/runs/38392637697) 的61文件/462条网页、166条Python、AMD64/ARM64发布及fresh/worker/resume实际启动检查全部通过。镜像摘要 `sha256:e9699a332f50d27130b494cd24d74a9acc108b43f9fc8bda2f7d5abf150515dc`，不提升 `latest`。**构建成功不是 NAS 上线或经营数据自动同步成功的证明。**

按用户“只改env、自己重建”的要求，全门禁通过后已备份NAS原配置，仅将`IMAGE_TAG`从rc.11更新至rc.14；备份`_archive/env.before-rc14-20261013`，逐字节确认其余不变。原项目app和data-worker均引用同一镜像变量，容器由用户重新创建，cloudflared不动。当前报告仍为今天08:25发布的旧批，最新公网检查仍为HTTP530/Cloudflare1033；不称新版已上线。以下rc.10—rc.13是同日历史记录，不覆盖本段当前状态。

rc.10 包含认证字段脱敏补丁：清理新生成的积加证据和来源报告副本，不自动清理历史文件或吊销凭证。云端 50 个文件、333 条网页测试和 123 条 Python 测试通过；镜像摘要 `sha256:0b15784b99e057c412d4c23150e81ed9bdc132f378d3efc9dee7427d61bc86ca`。按用户要求备份并仅更新 NAS env 至 rc.10，不自动操作容器。

rc.11 已按[核心闭环计划](docs/superpowers/plans/2026-10-13-prd-core-closure.md)实现复核重新触发、证据历史、连续查询、登录限流以及发布/回退二次验证。云端57个文件/403条网页测试、130条Python测试及双架构fresh/worker/resume检查通过，新生产instrumentation自动协调也实际通过。镜像摘要 `sha256:f199e35e18ebfb972cff84fe286640cb11603b38f5e82dde734d1f3abc38f3be`。NAS原env已按用户要求仅更新为rc.11，备份为`_archive/env.before-rc11-20261013`，其余字节不变；容器仍由用户重建，不表示已上线。

rc.12代码已补齐[成本版本](docs/superpowers/plans/2026-10-13-cost-version-closure.md)：明确生效/截止日、不可变历史、恢复留痕、批量版本冲突保护和连续历史；同价续期可单独保存，不重算已发布历史利润。45条聚焦测试、相关ESLint、生产构建及桌面/手机合成组件检查通过。但[Actions 38384259350](https://github.com/yinghuo202-rgb/amazon-insight/actions/runs/38384259350)在130条Python测试中有1条worker审计状态失败，虽448条网页测试通过，镜像仍未构建，**不要部署rc.12**。失败标签不覆盖；rc.13继续修复worker原子审计、Excel月报完整性及[指标口径版本](docs/superpowers/plans/2026-10-13-metric-contract-closure.md)，完成前不称可交付。

新成本能力不在rc.11内，NAS不自动升级到候选。旧镜像不理解新成本日期，回退时保留新表且停止成本编辑/决策，详见NAS说明。

rc.13固定代码`02ec8bc1e960d8be25973f2624ca149bb687d0f3`的[Actions 38391811216](https://github.com/yinghuo202-rgb/amazon-insight/actions/runs/38391811216)网页61文件/462条通过，Python166条中1条测试模拟函数不接受新增config参数而失败，镜像未构建，**不要部署rc.13**。该测试签名已在rc.14修正，锁内再次校验/并发变化拒绝断言不变，主代理完整Python166条通过，最终云端全门禁亦通过。不覆盖失败标签，不自动重建NAS容器。

- 前台仅保留运营总览、SKU 简报、利润试算；后台分组折叠。所有使用者沿用既有共用账号，仍校验登录会话与敏感写操作。
- 新采集和经营展示仅纳入一店 MEASUREMAN 的 US/CA。MX/AU 历史保留但不恢复采集，不跨币种合计，不按父体展示。
- 积加完整 env 凭证由 app 与独立 data-worker 使用，销售、广告按既有调度采集；网页无需重新保存凭证。任务全范围校验通过后才能发布，异常保留原报告，不能把“已配置”解释为“已同步”。
- 库存继续使用已确认的 WPS 来源，历史发货保留本地来源。WPS OAuth、令牌刷新、下载校验及调度链路已实现，但生产长期自动下载仍需要正式应用与文件授权；不导出浏览器 Cookie。
- 利润试算已支持市场、类目、有效期、单件包装和毛重匹配，以及外箱体积头程。没有预装未经确认的官方费率；配置/确认不足时不输出完整利润。费率配置是否传入 app 也须核对，单独填写 `.env` 不保证 Compose 会注入所有变量。

当前部署、备份、健康诊断及回退的唯一操作依据是 [NAS 增量说明](docker/nas/README.md)；审查结果与验收边界见 [网站审查与优化](docs/网站审查与优化-20261013.md)。原项目必须保留 Compose、原用户、账号库、运营库、runtime、全部密钥与 Tunnel。**app 与 data-worker 同时拉取并重新创建；只重启或只升级 app 不够。** 不用初始化模板覆盖已有 `.env`，不换到空数据卷。

下方 `update.sh` 只更新 app、备份单个账号库，不适用于当前已有 worker 的项目；Watchtower 的 app-only 自动更新也不用于本次固定候选升级。备份数据库必须先停止全部写入者并包含 WAL、报告版本与相关持久化目录，不能把 env 副本称作完整数据备份。

健康检查分层：`/health` 为进程存活，`/health/readiness` 为公共就绪，登录后的 `/api/system/readiness` 为运行诊断。worker 状态和任务发布需另外核验。公网出现 Cloudflare 1033 时，先检查原 Tunnel 是否有健康连接；它不能证明 app 自身崩溃。

GitHub 工作流在推送 `main`、`v*` 标签或手动触发时运行；普通候选分支推送不构建镜像。固定版本以对应提交、Actions 成功及镜像摘要为准，不覆盖已发布标签。

## 历史部署参考

以下保留旧版初始化与部署记录；版本号、网页凭证优先级、app-only 更新和 Token 保存方式不可覆盖上方当前交付说明。已有 NAS 项目不要直接执行这些初始化或回退步骤。

## v1.3.11：网页配置积加凭证

目标镜像：`ghcr.io/yinghuo202-rgb/amazon-insight:v1.3.11`（以构建成功及镜像存在为准）。在 NAS 将 `IMAGE_TAG` 改为 `v1.3.11`，拉取新镜像并重新创建 `app`，保留原有数据卷和 `SECRET_KEY`。通过 HTTPS 登录后进入“业务后台 → 数据更新”，填写 appId、appKey，点击“保存积加凭证”，然后测试连接。相较 v1.3.10 增加浏览器发送前的 HTTPS 拦截，防止误用 NAS HTTP 地址传送密钥。

凭证加密保存在已有运营数据库，更新无需重新填写；不必在环境文件中加入积加 Key。NAS 原有 `SECRET_KEY` 至少 32 字符且必须保持不变；备份需同时保存运营库与该密钥。还需在积加设置 NAS 公网出口 IP 白名单。当前只验证基础授权与店铺读取，尚不自动同步经营数据。详见 [授权配置说明](automation/integrations/amazon-insight/README.md#nas-积加授权配置)。

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
