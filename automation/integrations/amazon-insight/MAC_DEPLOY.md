# Measureman Ops · macOS 调试说明

此压缩包是当前运营系统的便携调试快照，包含网页源码、自动化代码、结构化报表、产品图片、状态数据库及历史导出文件。原始 Excel 业务文件未打包，也不会被网页修改。

## 首次启动

1. 将压缩包复制到 Mac 后解压，建议放在英文路径，例如 `~/Projects/measureman-ops-mac`。
2. 安装 Node.js 22 LTS；若需要使用“一键重建数据”，同时确保系统有 Python 3.10 或更高版本。
3. 打开“终端”，进入解压后的网页目录：

```bash
cd ~/Projects/measureman-ops-mac/automation/integrations/amazon-insight
chmod +x scripts/start-mac.command
./scripts/start-mac.command
```

脚本首次执行会安装 Mac 对应架构的 Node 依赖，初始化 Prisma 数据库，并在浏览器打开：

```text
http://localhost:3000/login
```

首次进入先创建管理员账户；后续从“团队协作”页面添加成员。登录会话和共享任务保存在本地 Prisma SQLite 数据库中。

以后再次调试只需重新执行 `./scripts/start-mac.command`。

## 当前快照边界

- 库存、销量、采购、广告、产品图片和下载中心使用打包时的结构化快照。
- 压缩包不包含约 18GB 的原始 Excel、采购订单和历史发货源文件。
- 因为缺少原始源文件，“数据更新”页面会显示源文件缺失，不能在 Mac 上完整重建业务数据；这不影响库存、采购、广告、SKU 和下载页面调试。
- 如需在 Mac 上继续测试完整导入流程，应保持压缩包目录结构不变，再将原始数据目录复制到压缩包根目录，或通过 `STORE_OPS_AUTOMATION_ROOT`、配置文件和 NAS 挂载路径重新映射。

## 常用命令

```bash
# 启动开发服务器
npm run dev -- --hostname 0.0.0.0

# 代码检查和测试
npm run lint
npm run test

# 生产构建
npm run build
npm run start:standalone
```

不要将 Jungle Scout、OpenAI 或 Amazon 的密钥写入源码。需要时复制 `.env.example` 为 `.env`，只在 Mac 本地填写。
