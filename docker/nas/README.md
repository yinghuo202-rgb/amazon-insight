# NAS 在线部署文件

## v1.5.0-rc.4：新版页面与销售、广告同步

本次构建标签：`ghcr.io/yinghuo202-rgb/amazon-insight:v1.5.0-rc.4`。以下行为不在旧 rc.2 镜像中；以该标签对应 GitHub Actions 构建和双架构启动检查全部成功为可部署依据，不更新 `latest`。rc.3 因两条未更新的 UI 口径测试断言未通过而停止，未发布镜像，不用于 NAS 部署。

运营总览、SKU 卡片、单 SKU 详情和新品利润试算统一采用绿色参考版式，保留后台折叠导航和手机底部导航。总览与 SKU 展示广告花费、广告销售额和 ACOS；当前月份缺失时明确显示最近有数据月份，不用跨月金额计算广告销售占比。重复全局搜索同步更新筛选；切换站点、月份时显示加载状态，不把旧金额放在新筛选标签下。

页面镜像和业务数据分开发布。当前已发布报告版本为 `data-20261010-052208-60dc19538b4d`，销售、广告按各自业务截止日期展示，库存与历史发货仍沿用既有本地来源及快照日期。真实报告、账号库、运营库、env 不上传公开 GitHub，也不内置在镜像中。已有 NAS 沿用当前 `reports/current.json` 和 `.versions`；镜像更新不会自动替换或回退数据。

已有 NAS 将原 env 中 `IMAGE_TAG` 改为 `v1.5.0-rc.4`，保留项目名、账号库、运营库、全部目录挂载及密钥，拉取并重新创建 **app 和 data-worker**，两个服务必须使用同一标签。cloudflared 不用改。不切换到新项目或新空数据卷；不要把原 reports 目录中的旧平铺文件误当成当前版本。下文 rc.2 部署及回退步骤仍适用，但新版本号应使用 rc.4。

### 直接用 env 自动接入积加

完整的 `GERPGO_APP_ID` / `GERPGO_APP_KEY` 现在优先于数据库中的旧网页凭证，不依赖其解密结果，也不需要网页保存。app 和 data-worker 都必须注入同一 env，并保留原数据库及报告挂载。单独将 env 放在 NAS 目录并不会自动传入容器；合并本目录的 worker 覆盖文件以注入变量。修改后重新创建 app/data-worker，cloudflared 不用改。

可在原 env 中追加以下非敏感配置（不要覆盖既有密钥或凭证）：

```dotenv
GERPGO_STORE_NAME=MEASUREMAN
GERPGO_AUTO_SYNC=true
GERPGO_SYNC_INTERVAL_MINUTES=1440
GERPGO_SYNC_SUPPLEMENTAL=true
```

完整 env 凭证默认开启上述模式；无凭证仍保持原来的暂停配置和网页配置兼容。worker 首次启动立即排队，采集近六个完整月和当月的销售、广告；店铺及产品接口只用于确认身份和 SKU 映射。后续采集上月、当月，并保留旧历史。`GERPGO_SYNC_SUPPLEMENTAL=true` 现在仅表示纳入逐日逐站点广告，不再采集 FBA、退货明细、仓储明细或历史发货。本地文件尚在下载时不启动发货重建，也不覆盖现有本地记录。全量初始广告采集可能较慢。

广告接口按[官方 ASIN 分析文档](https://open.gerpgo.com/document?id=98)要求逐日、逐站点、最多 100 条/页采集。真实空结果 `total=0、rows=null` 仅在该广告接口的第一页规范为 `rows=[]`；非零总数缺行、未知结构、总数变化或重复页仍失败。一个站点的限流/权限问题不再跳过其他站点；非授权、限流类单日异常不会封锁后续所有日期。自动销售及广告批次要求所有应采日期/站点完整，失败保留旧报告，不能把部分广告标为采集完成。

通过校验、范围明确且未触发修订保护的首次数据可由 env 策略授权自动发布，审计标为 environment-policy 而非人工对账。缺页、映射歧义、混币、店铺范围变化或完整月金额/SKU 数修订超过 10% 时保留旧数据及异常证据。普通失败一小时后重试；待核查或中断按下一周期重新采集，不重放旧发布请求，不自动批准异常预览。暂停使用 `GERPGO_AUTO_SYNC=false` 后重新创建容器。

网页 env 模式只显示连接诊断和任务状态，隐藏凭证输入及手动拉取入口，频率由 env 管理。网页“已配置”不代表积加白名单、权限已通过或数据已发布；查看任务采集覆盖及发布时间确认。

## v1.5.0-rc.2 NAS 试用版

镜像：`ghcr.io/yinghuo202-rgb/amazon-insight:v1.5.0-rc.2`。这是固定标签的试用版，不更新 `latest`。只有该标签对应 GitHub Actions 全部成功，且双架构镜像启动检查通过后，才用于 NAS 升级。适配 `linux/amd64` 和 `linux/arm64`；不自动修改或上线 NAS。

不要使用 `v1.5.0-rc.1`：实际镜像检查发现 worker 缺失 Zod 运行依赖，本地项目目录曾掩盖这个问题。rc.2 补齐独立 worker 的依赖，并在项目目录外验证打包结果。rc.1 曾因镜像元数据默认行为误更新 `latest`，已恢复到稳定版 `v1.4.1`；流程改为正式默认分支构建通过启动检查后才能提升 `latest`，试用标签不再提升它。

本版包含运营总览、SKU 简报、SKU 三栏详情及复核记录、三售价利润试算、定时同步和 WPS 正式授权读取。只展示一店 MEASUREMAN 的 US/CA/MX，不展示父体、五条建议或 PDF。API 凭证已保存不代表费用已对账或数据已发布；WPS 分享链接不代表已获服务端下载授权。

### 已有 NAS 项目的更新步骤

1. 停止 app 和 data-worker，备份现有 Compose、env、账号库、运营库及报告目录，再启动旧版本；备份不能只复制一个正在写入的 SQLite 主文件而忽略 WAL。保留原项目名、目录和全部数据卷。
2. 在原 env 中仅将 `IMAGE_TAG` 改为 `v1.5.0-rc.2`，保留原 `SECRET_KEY`、域名、积加凭证、Cloudflare Token 和目录。不要直接用示例 env 覆盖原文件。
3. 原来已有 worker 时，确认 app 和 data-worker 使用同一标签，运营库、reports、incoming、uploads、snapshots 挂载一致。尚无 worker 时，参考本目录 `measureman-data-worker.override.yml` 合并到原项目；全目录绑定部署使用 `../compose.worker.example.yml`，不要切换原有卷类型。
4. 在 NAS Docker 项目界面拉取新镜像并重新创建 app 和 data-worker；只点击“重启”不会更新镜像。cloudflared 无需重新创建，服务 URL 保持 `http://app:3000`（以原 Compose 服务名为准）。
5. 用既有共用账号登录，检查运营总览、SKU 详情、已有记录和“业务后台 → 数据更新”。确认 worker 显示在线，再手动拉取积加预览、核对范围与金额并确认发布。全新定时配置默认暂停，原来已经启用的配置会保留，不会被重置。

启动使用现有 Prisma 迁移机制补充复核字段，并幂等补齐运营任务表，不重新生成账号或清空库。CI 使用隔离数据检查两种架构的启动、Prisma 登录、旧运营库补表、记录保留、写入保护和独立 worker 心跳；不能替代真实 NAS 权限、挂载和业务对账验收。

### 回退注意

报告回退仍在数据更新页选择已保存版本；镜像回退不会自动回退报告或数据库。旧版启动会按旧 schema 执行 `db push`，可能要求删除新增字段：不要接受数据丢失提示。需紧急回退代码时先备份升级后的库，使用原固定版本并设置 `DATABASE_MIGRATE_ON_START=false`，保留新增字段；旧界面不保证识别新增复核状态。需要完整恢复升级前状态时，应停止 app/worker 后恢复同一时点的数据库与报告备份，并明确会丢失备份之后的变更。NAS 实机回退尚未验收。

## 定时同步增量

这一节适用于 v1.5.0-rc.2；**旧 v1.4.1 不包含定时调度和 WPS 官方自动下载**。app、data-worker 必须同时升级到同一经过验证的新版本；不更换现有账号库、运营库、SECRET_KEY 或 Cloudflare 配置。覆盖文件要求显式填写 `IMAGE_TAG`，不可将旧镜像当作新功能部署。

### 部署与开启

沿用下方的 Compose 增量合并方式。app 和 data-worker 必须共享同一个运营库、reports、incoming、uploads、snapshots，并使用相同 SECRET_KEY。不要创建另一个 Compose 项目或删除旧数据卷。纯绑定目录部署使用 `../compose.worker.example.yml` 并保持 app 的相同挂载；自定义上传/快照目录也必须共享。

“业务后台 → 数据更新 → 定时同步”配置保存在现有运营数据库中，容器重启仍保留。两个来源默认暂停：积加 1440 分钟、WPS 库存 240 分钟；可设为 60～10080 分钟，启用后首次任务立即排队。页面显示配置、worker 心跳、下一次运行及最近状态，不将凭证已保存误显示成已同步。

- 积加范围保持一店 MEASUREMAN 的 US/CA/MX；AU 排除。首次拉近六个完整月和当月；人工发布一次后，定时重拉上月和当月、保留历史，完整月销售额或同范围有效 SKU 数变化超过 10% 时重新审核。
- 定时核心采集同时保存产品、店铺与 FBA 原始分页；FBA 映射未对账时不写入库存事实，广告/退货/仓储明细仍需手动全量采集，不声称这些数据已自动完整接入。
- WPS 每次下载并校验原文件后走现有库存解析、预览和整批发布。第一次必须人工确认；同来源后续批次在结构、映射、数值和 SKU 数校验通过时可自动发布。新品表暂不启用。
- 关闭“通过校验后自动发布”后保留草稿。待审核或中断的任务暂停后续排队；审核发布后继续调度。中断后先核对现有版本，再点“确认后重新拉取”，不直接重放可能已发布的任务。普通失败一小时后重试，旧报告保留。

### WPS 授权准备

现有 WPS 登录态可完成授权页面登录，但**分享链接本身不能让 NAS 永久自动下载**。需创建并获批金山文档开放平台应用，取得 APPID/APPKEY、开通 `download_personal_files` 权限，并取得库存文件 `file_token`（不是 `cg2kkbtoinHk` 分享短码）。注册准确回调地址：

```text
https://measureman.online/api/inventory/data-refresh?wps_callback=1
```

在现有数据页面展开“配置金山文档应用和库存文件”，填写应用凭证、file_token 和库存链接 `https://www.kdocs.cn/l/cg2kkbtoinHk`，保存后点“授权库存表”。使用当前 WPS 登录账号授予该文件下载权限，回到网站后先“立即同步 WPS”，检查上传批次并确认发布，再开启定时同步。

也可在 env 中预留 `STORE_OPS_WPS_APP_ID`、`STORE_OPS_WPS_APP_KEY`、`STORE_OPS_WPS_INVENTORY_FILE_TOKEN`、`STORE_OPS_WPS_INVENTORY_URL`，但仍须网页授权。env 不保存浏览器 Cookie。网页配置和刷新令牌加密保存在运营库中，不回显密钥；SECRET_KEY 必须保持原值且至少 32 字符。应用和 worker 都须可连接官方授权服务与 WPS 文件存储。重新保存 WPS 应用或文件配置会暂停该来源的定时任务，使旧任务失去自动发布权限；重新授权、审核并开启后再继续。

下载只接受校验通过的 Excel 文件。在线智能表若返回非 XLSX 格式会停止并要求处理，不伪造成功。WPS 更新规划月销和国内供应合计，不覆盖 ERP 海外库存；国内供应合计含订单时不重复加总。下载时间不冒充业务截止日期。首次真实授权、表结构和业务口径仍需实际验收。

官方依据：[Web 授权及令牌刷新](https://developer.kdocs.cn/common/authorization/web.html)、[个人文件下载](https://developer.kdocs.cn/server/personal/download.html)。

## v1.4.1 增量更新（已有 NAS 项目）

镜像：`ghcr.io/yinghuo202-rgb/amazon-insight:v1.4.1`。发布完成以 GitHub Actions 成功和镜像清单存在为准。应用和 data-worker 必须使用同一个固定版本。

只处理积加店铺 `MEASUREMAN` 的 US、CA、MX；AU 不纳入。站点 ID 仍根据实际授权识别。`GERPGO_STORE_NAME=MEASUREMAN` 可追加到原 env；不要更换 SECRET_KEY、账号数据库或 Cloudflare Token。不跨币种合计销售额。旧版本澳洲数据保留在原始证据和历史归档中，但不出现在页面、查询或新发布报告；包含 AU 的旧预览必须重新拉取，不能直接确认发布。

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
