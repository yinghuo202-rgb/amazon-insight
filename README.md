# Amazon Selection Workbench Web V1

一个本地优先的 Amazon US 选品工作台。当前保留这条主链路：

`关键词输入 -> 候选商品发现 -> 手动选择主商品 / 参考竞品 -> 市场分析 -> Inspiration`

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

## 当前限制

- SP-API 仍然只是占位 adapter，不参与主链路
- Inspiration 默认由规则和模板生成，不调用真实 LLM
- Jungle Scout 某些分析接口若返回不完整，会在 UI 中标记 `partial`
