# NAS 在线部署文件

## 当前交付状态（2026-10-13）

最新已验证镜像为 `ghcr.io/yinghuo202-rgb/amazon-insight:v1.5.0-rc.11`，[Actions 38375784053](https://github.com/yinghuo202-rgb/amazon-insight/actions/runs/38375784053) 全部成功，对应提交 `c75f3cfbc113ce63ca5f00966f634dbf09955dae`；镜像摘要 `sha256:f199e35e18ebfb972cff84fe286640cb11603b38f5e82dde734d1f3abc38f3be`。包含此前费率来源/认证字段脱敏，以及复核闭环和登录/发布安全保护。按最新用户要求，NAS原env仅将 `IMAGE_TAG` 从rc.10改为rc.11，其他字节不变，备份为`_archive/env.before-rc11-20261013`。没有操作容器，实际运行版本仍待用户重建后验收；env备份不是数据库备份。

rc.11的403条网页测试、130条Python测试及双架构实际fresh/worker/resume检查通过，不提升latest。补丁保留业务数据和旧历史，不自动清理历史凭证或更换密钥。成本版本已在rc.12代码实施，但rc.12云端Python门禁失败，镜像未构建，不能部署；新候选为rc.13，全部门禁成功前仍使用rc.11。当前NAS env保持rc.11，不能称整份PRD完成。已有项目沿用用户实际使用的`measureman-commerce-online.yml`、原挂载和账号，不导入新模板；重建app与data-worker，不重建cloudflared。新版本无需增加worker账号库挂载：经营复核协调在app的Node启动入口每30秒有界执行。

rc.13网页61文件/462条通过，Python166条中1条旧测试模拟函数签名失败，docker门禁跳过，无镜像，不能部署。只修测试config参数兼容，原锁内保护断言未改；主代理完整Python166条通过。下一固定候选为rc.14，全部云端门禁成功前仍保持NAS env rc.11，不在构建过程中操作NAS。

### 候选成本版本：迁移与回退限制

候选代码在既有运营库追加`product_cost_versions_v1`，保留原覆盖值，旧数据标记业务生效日未知。新版本按明确UTC日历日选择当前成本，保存/恢复均留历史；截止包含当天，未来不提前应用，失效后不复活前版。恢复从指定日期跟随已发布目录，保存来源成本及报告版本；不会暗中取消更晚的计划。成本编辑不改报告指针或历史实际利润，无需新数据卷、账号库、密钥或worker配置。

升级前备份既有运营库及WAL、账号库、报告版本和原env，沿用下方安全增量流程。原`product_cost_overrides_v1`只是当前值兼容投影，不代表旧镜像理解新的日期/历史语义。回退至rc.11或更旧镜像期间，不进行成本编辑或依赖它作成本决策；不得删除新版本表。跨日不能宣称旧镜像的当前成本仍正确，需重新使用日期语义兼容镜像。真实NAS规模、升级与恢复尚未验收。

最近只读公网检查返回 Cloudflare 1033，完整经营数据发布也未验收成功。下方旧版本号及命令为历史记录，不是当前上线证明。

## v1.5.0-rc.8（历史发布记录，云端与双架构启动检查通过）

固定镜像：`ghcr.io/yinghuo202-rgb/amazon-insight:v1.5.0-rc.8`。[Actions 38353275785](https://github.com/yinghuo202-rgb/amazon-insight/actions/runs/38353275785) 全部成功，对应代码 `e9fbcc02bba8b9713b63986a3d073158b84faa6b`；镜像清单摘要 `sha256:7a37d97f69467a0610fbef9cc6d1daefaf7bab1adab33fcdc2f98105ce0a55b4`，AMD64、ARM64 构建及账号保留、只读就绪、写入保护和 worker 启动检查通过。不提升 `latest`。

包含 rc.7 的页面和经营口径修复，并补充积加网络超时的同页有限重试。传输失败与业务错误分开，最多三次、每次至少 6 秒；业务/权限/分页完整性错误继续拒绝，不能以部分结果覆盖现有报告。

NAS 挂载恢复后先做只读检查：原配置为 rc.6，积加调度启用，WPS 自动同步未启用；保存的两轮采集都有广告范围超时，不能称作自动同步成功。此补丁已完成失败复现、聚焦回归、49 个文件 322 条本地 CI 范围回归、生产构建和云端镜像检查；真实 NAS 超时重试及全量发布仍待更新后的任务验收。

按用户最新指示，只备份并修改 NAS 原 `.env` 的 `IMAGE_TAG=v1.5.0-rc.8`，验证其余字节不变。配置备份不替代完整数据库备份；本轮没有操作容器，用户在原项目中拉取并重新构建 app 和 data-worker，cloudflared 不用重建。尚不能据此称为新版本已上线。

已有 NAS 应沿用**当前实际导入的 Compose**。本轮挂载目录内有 docker-compose.yml 和 measureman-commerce-online.yml，不能仅因两个文件都存在就认定实际运行的是哪一个。原部署已合并 worker 时，不额外叠加历史命名卷 overlay；保持原非 root 用户、账号库、运营库、runtime、密钥及 Tunnel。按下方增量升级说明先备份，把固定标签替换为 **rc.8**，app 和 data-worker 同时拉取并重建。不要用仓库内历史模板替换原 NAS 文件，不提升 latest，不自动部署。

### 费率配置的容器传入

试算页读取 app 容器内的 `STORE_OPS_PROFIT_FEE_RULES`，不是直接读取宿主机 `.env`。使用 `env_file` 的根 Compose 会传入该变量；旧的显式 `environment` NAS 文件未必包含映射，即使填写 `.env` 也可能仍得到空规则。仓库绑定模板和 worker overlay 的 app 映射已补齐；**没有自动修改用户 NAS 的 Compose**。

已有项目需先确认并沿用实际 Compose，在原 `services.app.environment` 中加入这一项，不替换其他配置、不导入命名卷 overlay：

```yaml
STORE_OPS_PROFIT_FEE_RULES: "${STORE_OPS_PROFIT_FEE_RULES:-[]}"
```

只有经确认、同币种且在有效期内的费率才能填入 JSON；默认 `[]` 表示没有预设，继续手工确认。修改 app 的环境配置后重新创建 app，单纯重启不生效。费率不参与 worker 经营提醒，也不能用试算的广告 15% 或退货 1% 替代真实经营阈值。此配置项无需更换账号、密钥、数据路径或 Tunnel。

## v1.5.0-rc.7 发布候选（历史准备记录）

本节以下保留 rc.7 发布前准备记录；rc.7 最终构建也已成功，但未包含后续超时修复。最新交付状态以上方 rc.8 为准。增量操作示例中的 `pre-rc7` 和 `v1.5.0-rc.7` 使用时应替换为新的备份目录和 **v1.5.0-rc.8**，不能覆盖已有备份。

检查日期：2026-10-13。计划候选标签为 `v1.5.0-rc.7`，核对时该标签尚不存在；本节不表示它已创建或镜像已发布。用户已授权本轮提交、推送和云端构建，但不自动部署 NAS。已有 `v1.5.0-rc.6` 对应提交 `399eb8cc69552833ba1745f3bb0e37ab8e6c2254` 的 [Actions 38232017352](https://github.com/yinghuo202-rgb/amazon-insight/actions/runs/38232017352) 已完成构建、双架构发布和隔离启动检查，未提升 `latest`。rc.7 必须在本轮代码最终验证并经同一流程通过后才可使用，不能以旧 rc.6 的成功替代本轮验收。

本轮发布边界保持原共用账号、MEASUREMAN 的 US/CA、WPS 真实库存口径与 90 天库存目标，以及主前台三个入口。MX/AU 不恢复采集或前台展示，历史证据不删除；镜像升级不重新导入账号、覆盖报告或修改密钥。本机没有 Docker，NAS 挂载当前不可访问，公网域名当前返回 Cloudflare 1033，因此这里只完成发布准备，**没有完成 NAS 升级或线上验收**。

本轮已实现供应口径确认与时效保护、广告归因比标签、完整月与当月累计分离、缺月趋势断线、真实图片失败回退、协作备注草稿及冲突保留、供应链服务端分页，以及下方的运行健康分层。未确认或过期供应不会生成确定性的网络覆盖和补货结论；不将广告归因比描述为总销售占比，不将当月累计当作完整月。完整审查与验收边界见[公开审查报告](../../docs/网站审查与优化-20261013.md)。

本地隔离环境最终 CI 范围回归 49 个文件、319 条测试通过，生产构建含类型检查和 ESLint 通过；主要桌面/手机操作已检查，抽样范围见审查报告。新增健康检查专项和 smoke 脚本语法检查通过；rc.7 的云端验证、双架构构建、镜像启动和 NAS 真实业务验收仍未完成。Docker workflow 只在推送 `main`、`v*` 标签或显式手动触发时运行；仅推送候选开发分支不会构建镜像。本轮采用固定 RC 标签触发，不推送 `main`，不提升 `latest`。

### 运行健康分层

- `/health`：公共进程存活检查，仍用于 Docker healthcheck；不查询业务数据，worker 停止不会令网页陷入重启。
- `/health/readiness`：公共只读就绪检查，只返回 `ready` / `not_ready`。账号库、运营库或报告目录缺失、不可读、权限不允许写入时返回 503；不自动初始化数据库、不迁移、不试写文件。
- `/api/system/readiness`：须使用现有共用账号登录，返回经过裁剪的数据库、报告权限和 worker 状态，不输出文件路径、业务行、凭证或原始异常。worker 心跳超过 120 秒时显示 `stale`，网页仍保持就绪；同步停用且无待执行任务时显示 `disabled`，不当作故障。最近任务失败或中断另给警告。

权限检查只能证明当前进程具有文件系统读写权限，不能代替磁盘剩余空间、NAS ACL 实写、真实积加/WPS 权限及首次对账。app 显示 `healthy` 也不能单独证明 worker 已运行、自动同步已完成或新报告已发布。

### 已有项目安全增量升级

不要对已有 worker/命名卷部署执行根目录 `update.sh`：它只停止、拉取和重建 app，只备份绑定目录中的 `selection.db`，会漏掉 worker、运营库、WAL、报告版本与命名卷。使用原项目的 Compose 文件和 env，先确认 app/worker 使用同一账户与运营数据挂载、没有其他容器写同一数据库；不得切换原项目名、卷名、runtime 目录或容器用户。以下命令仅供 NAS 操作者在镜像验证通过后执行，本轮未执行。

示例沿用原 `docker-compose.yml` 与已合并的 `measureman-data-worker.override.yml`；实际文件名不同则明确替换，纯绑定目录项目使用原绑定配置，不能为了套用例子导入新命名卷。执行 `config --quiet`，不要将会展开凭证的完整 `config` 输出粘贴到聊天或日志。

先在旧镜像仍运行时核对与准备；备份目录必须是新的项目内目录：

```sh
set -eu
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml config --quiet
app_container="$(docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml ps -q app)"
test -n "$app_container"
old_image="$(docker inspect --format '{{.Config.Image}}' "$app_container")"
backup_user="$(docker inspect --format '{{.Config.User}}' "$app_container")"
test -n "$backup_user"
backup_dir="./backups/pre-rc7-20261013"
test ! -e "$backup_dir"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
cp .env "$backup_dir/env.before"
cp docker-compose.yml "$backup_dir/compose.before.yml"
cp measureman-data-worker.override.yml "$backup_dir/worker.before.yml"
chmod 600 "$backup_dir/env.before"
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml stop app data-worker
docker run --rm --user "$backup_user" --volumes-from "$app_container:ro" --entrypoint /bin/sh "$old_image" \
  -c 'tar -C /data -cf - app runtime uploads snapshots' > "$backup_dir/persistent-data.tar"
tar -tf "$backup_dir/persistent-data.tar" >/dev/null
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml start app data-worker
```

只读备份 helper 复用旧 app 的现有挂载和容器用户，可同时覆盖绑定目录与命名卷，不创建替代业务卷，也不要求平台额外授予 root。检查得到用户为空或读取权限不足时应暂停并核对原用户/ACL，不能自动改用 root 或改变生产目录权限。示例要求原账号库、运营库与报告位于标准 `/data/app`、`/data/runtime` 挂载；自定义数据库/上传/快照路径须先补齐归档范围。停掉全部写入者后归档整个目录，不能只复制在线 SQLite 主文件或遗漏 `-wal` / `-shm`。若备份失败，先恢复旧 app/worker 运行并查明原因，不继续升级；这是操作方案，不表示已经执行或验真备份。

备份确认后仅在原 env 中修改 `IMAGE_TAG=v1.5.0-rc.7`，保持原 `SECRET_KEY`、账号、调度、Cloudflare、目录和全部连接凭证。不要用示例 env 覆盖原文件。拉取成功后再重建两个服务：

```sh
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml config --quiet
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml pull app data-worker
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml stop app data-worker
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml up -d app data-worker
docker compose --env-file .env -f docker-compose.yml -f measureman-data-worker.override.yml ps
```

只重启不会更新镜像；只更新 app 会造成 worker 与网页代码不一致。原 cloudflared 与其 Token 无需更换；原服务 URL 保持 `http://app:3000`，不自动重新创建 Tunnel。根 `compose.yaml` 的 `latest`/Watchtower 是历史通用模板，本轮固定 RC 升级不使用自动更新。

### NAS 验收与回退

升级后先访问 NAS 本地端口的 `/health` 与 `/health/readiness`，再用原共用账号查看 `/api/system/readiness` 和“业务后台 → 数据更新”。确认原记录、报告版本指针、业务截止日期以及 US/CA 范围保留；启用同步时确认 worker `online`，任务采集覆盖、异常状态和报告发布时间真实变化。业务验收不能以凭证“已配置”或 HTTP 200 替代。公网仍为 1033 时应单独修复/核对原 Tunnel 连接，不能据此假定应用健康或镜像有问题。

失败时先停止新 app/worker，备份升级后的数据和异常证据；不删旧卷，不运行 `down -v`。仅回退镜像时将原 `IMAGE_TAG` 恢复为已验证旧固定标签，设置 `DATABASE_MIGRATE_ON_START=false`，同时重建 app/worker，避免旧 Prisma schema 对新增字段执行破坏性回退。报告回退仍是独立操作，在数据更新页选择已有报告版本。需恢复全部状态时，必须停止所有写入者后，将同一时点的账号库、运营库、reports 版本及指针恢复到**原挂载**；恢复会丢失备份后的变更，不能自动执行。恢复后重新核对登录、readiness、worker 和报告版本；NAS 实机升级与回退仍待验收。

以下章节为历史版本记录；涉及 MX、首次 env 自动发布、root 权限绕过和旧 UI 的描述不能覆盖本节与 rc.6 的当前规则。旧 `DEPLOYMENT_HANDOVER.md` 中“无提交记录”、`v1.0.0` 和 `latest` 自动发布步骤也不适用于当前已有 NAS 项目。

## v1.5.0-rc.6：US/CA 最新数据与统一工作空间

固定构建标签：`ghcr.io/yinghuo202-rgb/amazon-insight:v1.5.0-rc.6`。以该标签对应 Actions、双架构镜像和启动检查全部成功为发布依据，不提升 `latest`。app 与 data-worker 同步更新，保留原项目、数据卷、账号库、运营库和全部密钥；cloudflared 不需要更换。

- 新采集和前台选择器仅纳入一店 MEASUREMAN 的 US、CA；MX、AU 历史保留，不继续采集。销售使用逐站点 listing 接口与原币，广告按日分页、明确 SKU 映射；重复分页只在原始证据证明业务键集合完整且无冲突时恢复。
- 首页销售指标保持选中月份，重点关注独立使用最近完整经营月和当前库存，卡片注明依据日期。SKU 详情使用证据月份，返回保留原筛选和滚动位置。
- UI 沿用现有蓝色品牌与页面流程，统一实体面板、字体、间距、圆角、阴影、键盘焦点和移动端工具栏，不新增依赖或主题切换。
- 当前 WPS 库存经用户明确确认后可按实际库存发布：US 网络合计已包含 AWD，在途不能再次计入 AWD；国内“工厂库存及已下订单”是共享组合供应，不再重复叠加采购数量。采购、发货及经营历史保留。未确认的 WPS 下载仍只更新规划字段，下载时间不能自动成为业务日期。
- env 负责连接和调度，不代替首次对账。自动发布须已有真实 `initialReview`；店铺范围变更、缺页、映射冲突或修订保护触发时保留旧版与预览。

真实业务数据与镜像分开发布，运行库、原始接口证据、WPS 文件和 env 不提交 GitHub、不内置镜像。沿用 `reports/current.json` 原子版本指针；报告回退与镜像回退独立。已有只读权限故障的 NAS 沿用修复后的可写 runtime 挂载和非 root 用户，不换到空目录，也不要删除旧备份。

## v1.5.0-rc.5：新版页面与销售、广告同步

本次构建标签：`ghcr.io/yinghuo202-rgb/amazon-insight:v1.5.0-rc.5`。以下行为不在旧 rc.2 镜像中；以该标签对应 GitHub Actions 构建和双架构启动检查全部成功为可部署依据，不更新 `latest`。rc.3 的旧 UI 断言、rc.4 的广告模拟记录币种字段未通过验证，均未发布镜像，不用于 NAS 部署。rc.5 对齐现有测试资料，不放宽真实采集的币种校验。

运营总览、SKU 卡片、单 SKU 详情和新品利润试算统一采用绿色参考版式，保留后台折叠导航和手机底部导航。总览与 SKU 展示广告花费、广告销售额和 ACOS；当前月份缺失时明确显示最近有数据月份，不用跨月金额计算广告销售占比。重复全局搜索同步更新筛选；切换站点、月份时显示加载状态，不把旧金额放在新筛选标签下。

页面镜像和业务数据分开发布。当前已发布报告版本为 `data-20261010-052208-60dc19538b4d`，销售、广告按各自业务截止日期展示，库存与历史发货仍沿用既有本地来源及快照日期。真实报告、账号库、运营库、env 不上传公开 GitHub，也不内置在镜像中。已有 NAS 沿用当前 `reports/current.json` 和 `.versions`；镜像更新不会自动替换或回退数据。

已有 NAS 将原 env 中 `IMAGE_TAG` 改为 `v1.5.0-rc.5`，保留项目名、账号库、运营库、全部目录挂载及密钥，拉取并重新创建 **app 和 data-worker**，两个服务必须使用同一标签。cloudflared 不用改。不切换到新项目或新空数据卷；不要把原 reports 目录中的旧平铺文件误当成当前版本。下文 rc.2 部署及回退步骤仍适用，但新版本号应使用 rc.5。

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
