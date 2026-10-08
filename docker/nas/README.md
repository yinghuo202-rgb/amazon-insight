# NAS 在线部署文件

## v1.4.0 增量更新（已有 NAS 项目）

镜像：`ghcr.io/yinghuo202-rgb/amazon-insight:v1.4.0`。发布完成以 GitHub Actions 成功和镜像清单存在为准。应用和 data-worker 必须使用同一个固定版本。

默认只处理积加店铺 `MEASUREMAN`，站点根据实际授权自动识别，目前为 US、CA、MX、AU。`GERPGO_STORE_NAME=MEASUREMAN` 可追加到原 env；不要更换 SECRET_KEY、账号数据库或 Cloudflare Token。不跨币种合计销售额。

已有部署使用 `operations_data`、`runtime_output` 命名卷时，把本目录 `measureman-data-worker.override.yml` **合并**到当前 Compose 项目，不要用新项目名导入，也不要以新模板替换原账号数据库挂载。该文件保留原配置，只扩展 writable reports、incoming、uploads、snapshots 和 worker。旧 reports 作为只读启动导入源保留。若原来全部使用 runtime 目录绑定，应沿用原挂载并参考 `../compose.worker.example.yml`，不要混用本覆盖文件。

```sh
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml config --quiet
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml pull app data-worker
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml up -d app data-worker
```

导入界面只接受一个 yml 时，将覆盖文件的 app 字段、data-worker 服务及新增 volumes 合并到原文件。保持原 `name`、`app` 的账户库挂载和 `operations_data` 卷名；不能只修改镜像后点击重启。这里不修改 NAS 文件，也不自动上线。

重建后在“业务后台 → 数据更新”测试积加连接，先“拉取核心预览”（最近六个完整月、当月、当前 FBA）；需要费用明细时选择“全量采集（含费用明细）”。部分接口不支持店铺筛选，必须全分页后过滤，耗时较长；接口返回数不是一店有效记录数。预览人工确认后才发布，利润/退货仍标为待核验。定时同步尚未启用。

升级前备份原 Compose、env 和已有账号/运营数据库；不可删除旧卷。更改站点范围后旧 ERP 报告不会被当作新范围继续使用。回退应用镜像不会自动回退报告，在数据更新页选择已保存的报告版本进行回退。

以下为历史全新部署说明，不适用于直接替换已有项目数据卷。

把本目录中的 `measureman-commerce-online.yml` 和 `measureman-commerce-online.env` 放在 NAS 同一个目录，例如 `/docker/measureman-commerce/`。

```sh
cd /docker/measureman-commerce
mkdir -p data/app data/runtime data/sources logs
```

编辑 `measureman-commerce-online.env`，至少替换：

- `PUBLIC_APP_URL`：Cloudflare 的公开域名，当前配置为 `https://measureman.online`
- `SECRET_KEY`：文件中已生成一枚随机密钥；如需重置可自行替换
- `IMAGE_TAG`：需要部署的镜像提交 SHA
- `CLOUDFLARE_TUNNEL_TOKEN`：先在 Cloudflare 控制台轮换旧 Token，再粘贴新 Token

Cloudflare Tunnel 的 Published application 设置为：

```text
Service URL: http://app:3000
```

如果 GHCR 镜像是私有的，先登录：

```sh
mkdir -p .docker
DOCKER_CONFIG="$PWD/.docker" docker login ghcr.io
```

启动：

```sh
docker compose --env-file measureman-commerce-online.env \
  -f measureman-commerce-online.yml config

docker compose --env-file measureman-commerce-online.env \
  -f measureman-commerce-online.yml pull

docker compose --env-file measureman-commerce-online.env \
  -f measureman-commerce-online.yml up -d
```

如果网页日志出现 `attempt to write a readonly database`，说明 NAS 的 `data/runtime/db` 或 `data/app` 权限不允许容器用户写入。请在 NAS 文件管理器中给项目目录下的 `data` 和 `logs` 文件夹授予 Docker/Container Manager 读写权限，并确认 `data/runtime/db/operations.sqlite3` 不是只读文件。修复权限后重新部署：

本 yml 已为 `app` 服务设置 `user: "0:0"`，在 NAS 无法修改共享文件夹 ACL 时可直接绕过容器内用户权限限制。若 NAS 的共享文件夹策略连 root 也禁止写入，则必须改用 NAS 的 Docker 权限设置或命名卷。

```sh
docker compose --env-file measureman-commerce-online.env \
  -f measureman-commerce-online.yml up -d --force-recreate
```

检查：

```sh
docker compose --env-file measureman-commerce-online.env \
  -f measureman-commerce-online.yml ps

docker compose --env-file measureman-commerce-online.env \
  -f measureman-commerce-online.yml logs --tail=100 cloudflared
```

Cloudflare Token 会放在 env 文件中，因此导入后请立即将该文件权限设为 `600`，并不要提交 GitHub 或转发给他人。旧 Token 已泄露，不能继续使用。
