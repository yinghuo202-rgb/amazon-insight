import type { AnalysisPageData, DataSourceStatus, TrendPoint } from "@/lib/contracts";
import {
  escapeHtml,
  formatCompactNumber,
  formatCurrency,
  formatDateTime,
  levelLabel,
  modeLabel,
  stageLabel,
} from "@/lib/utils";

function renderMetric(label: string, value: string, hint?: string) {
  return `
    <div class="metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${hint ? `<div class="metric-hint">${escapeHtml(hint)}</div>` : ""}
    </div>
  `;
}

function renderList(title: string, items: string[]) {
  if (items.length === 0) {
    return "";
  }

  return `
    <section class="subcard">
      <h3>${escapeHtml(title)}</h3>
      <ul>
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function renderDataSources(sources: DataSourceStatus[]) {
  return sources
    .map(
      (source) => `
        <section class="source-card">
          <div class="source-header">
            <strong>${escapeHtml(source.label)}</strong>
            <span>${escapeHtml(modeLabel(source.mode))}</span>
            <span>${escapeHtml(source.status)}</span>
          </div>
          <p>${escapeHtml(source.freshness)}</p>
          <ul>
            ${source.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}
          </ul>
        </section>
      `,
    )
    .join("");
}

function renderTrendSvg(series: TrendPoint[]) {
  if (series.length < 2) {
    return "";
  }

  const width = 960;
  const height = 280;
  const paddingX = 26;
  const paddingY = 18;
  const values = series.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const stepX = (width - paddingX * 2) / Math.max(series.length - 1, 1);

  const points = series.map((item, index) => {
    const x = paddingX + stepX * index;
    const y = height - paddingY - ((item.value - min) / range) * (height - paddingY * 2);
    return { x, y };
  });

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${path} L ${points[points.length - 1]?.x.toFixed(2)} ${height - paddingY} L ${points[0]?.x.toFixed(2)} ${height - paddingY} Z`;

  return `
    <svg viewBox="0 0 ${width} ${height}" class="trend-svg" role="img" aria-label="搜索趋势图">
      <defs>
        <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1c584a" stop-opacity="0.28"></stop>
          <stop offset="100%" stop-color="#1c584a" stop-opacity="0.04"></stop>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#trendGradient)"></path>
      <path d="${path}" fill="none" stroke="#1c584a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
      ${points
        .map((point) => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4" fill="#1c584a"></circle>`)
        .join("")}
    </svg>
    <div class="trend-labels">
      <span>${escapeHtml(series[0]?.label ?? "")}</span>
      <span>${escapeHtml(series[Math.floor(series.length / 2)]?.label ?? "")}</span>
      <span>${escapeHtml(series[series.length - 1]?.label ?? "")}</span>
    </div>
  `;
}

export function renderAnalysisHtmlReport(input: {
  data: AnalysisPageData;
  pageUrl: string;
  exportedAt?: Date;
}) {
  const { data, pageUrl } = input;
  const exportedAt = input.exportedAt ?? new Date();
  const { analysis, product, compareProducts, latestInspiration } = data;

  const pageTitle = `${product.title} - Amazon 选品分析`;
  const summaryText = `${analysis.summary} ${analysis.recommendation}`.trim();
  const productImage =
    product.imageUrl && (product.imageUrl.startsWith("http") || product.imageUrl.startsWith("data:image"))
      ? product.imageUrl
      : null;

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(summaryText)}" />
    <meta name="robots" content="noindex, nofollow" />
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f1e8;
        --surface: #fffdf8;
        --surface-alt: #f8f2e7;
        --text: #18332d;
        --muted: #5c6a65;
        --line: rgba(24, 51, 45, 0.12);
        --accent: #1c584a;
        --accent-soft: rgba(28, 88, 74, 0.12);
        --warn-soft: rgba(193, 140, 70, 0.16);
        --shadow: 0 24px 72px rgba(22, 37, 31, 0.08);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font:
          16px/1.65 "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui,
          sans-serif;
      }
      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 20px 56px;
      }
      h1, h2, h3, h4, strong {
        font-family:
          "Plus Jakarta Sans", "Noto Sans SC", "PingFang SC", system-ui, sans-serif;
      }
      h1, h2, h3, h4, p, ul { margin: 0; }
      a { color: inherit; }
      .hero,
      .card,
      .subcard,
      .source-card,
      .metric,
      .note {
        border: 1px solid var(--line);
        border-radius: 24px;
        background: rgba(255, 253, 248, 0.96);
        box-shadow: var(--shadow);
      }
      .hero {
        padding: 28px;
      }
      .hero-top,
      .row,
      .source-header,
      .trend-labels {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
      }
      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: var(--muted);
        font-weight: 700;
      }
      .hero-grid,
      .grid-2,
      .grid-3,
      .metric-grid {
        display: grid;
        gap: 18px;
      }
      .hero-grid {
        margin-top: 18px;
        grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
      }
      .metric-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .grid-2 {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .grid-3 {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .stack {
        display: grid;
        gap: 18px;
        margin-top: 18px;
      }
      .card,
      .subcard,
      .source-card,
      .note {
        padding: 22px;
      }
      .metric {
        padding: 18px;
        background: var(--surface);
      }
      .metric-label {
        font-size: 12px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--muted);
        font-weight: 700;
      }
      .metric-value {
        margin-top: 10px;
        font-size: 28px;
        font-weight: 700;
        letter-spacing: -0.03em;
      }
      .metric-hint,
      .muted {
        margin-top: 8px;
        color: var(--muted);
        font-size: 14px;
      }
      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        border: 1px solid var(--line);
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 600;
        background: var(--accent-soft);
        color: var(--accent);
      }
      .badge.alt {
        background: var(--surface-alt);
        color: var(--muted);
      }
      .badge.warn {
        background: var(--warn-soft);
        color: #855a20;
      }
      .cover {
        display: grid;
        gap: 18px;
      }
      .cover-image {
        aspect-ratio: 1 / 1;
        border-radius: 24px;
        background: var(--surface-alt);
        border: 1px solid var(--line);
        overflow: hidden;
      }
      .cover-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .section-title {
        margin-bottom: 14px;
      }
      .section-title h2 {
        font-size: 24px;
        line-height: 1.2;
      }
      .section-title p {
        margin-top: 6px;
        color: var(--muted);
      }
      ul {
        padding-left: 20px;
      }
      li + li {
        margin-top: 8px;
      }
      .trend-svg {
        display: block;
        width: 100%;
        height: auto;
      }
      .trend-labels {
        margin-top: 10px;
        color: var(--muted);
        font-size: 13px;
      }
      .footer-note {
        margin-top: 8px;
        color: var(--muted);
        font-size: 13px;
      }
      @media (max-width: 980px) {
        .hero-grid,
        .grid-2,
        .grid-3,
        .metric-grid {
          grid-template-columns: 1fr;
        }
      }
      @media print {
        body { background: #fff; }
        main { padding: 0; max-width: none; }
        .hero,
        .card,
        .subcard,
        .source-card,
        .metric,
        .note {
          box-shadow: none;
          background: #fff;
          break-inside: avoid;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero-top">
          <div>
            <div class="eyebrow">Amazon Selection Workbench</div>
            <h1>${escapeHtml(product.title)}</h1>
            <p class="muted" style="margin-top: 12px;">${escapeHtml(summaryText)}</p>
          </div>
          <div class="badges">
            <span class="badge">ASIN ${escapeHtml(product.asin)}</span>
            <span class="badge alt">${escapeHtml(modeLabel(analysis.mode))}</span>
            <span class="badge alt">${escapeHtml(stageLabel(analysis.lifecycle.stage))}</span>
          </div>
        </div>

        <div class="hero-grid">
          <div class="metric-grid">
            ${renderMetric("生命周期", stageLabel(analysis.lifecycle.stage), `置信度 ${levelLabel(analysis.lifecycle.confidence)}`)}
            ${renderMetric("竞争强度", levelLabel(analysis.competition.level))}
            ${renderMetric("机会等级", levelLabel(analysis.marketOverview.opportunityLevel))}
            ${renderMetric("价格", formatCurrency(product.price))}
            ${renderMetric("月销量", formatCompactNumber(product.monthlyUnits))}
            ${renderMetric("月销售额", formatCurrency(product.monthlyRevenue))}
            ${renderMetric("评分", product.rating?.toFixed(1) ?? "-")}
            ${renderMetric("评论量", formatCompactNumber(product.reviews))}
          </div>
          <div class="cover">
            ${productImage ? `<div class="cover-image"><img src="${escapeHtml(productImage)}" alt="${escapeHtml(product.title)}" /></div>` : ""}
            <div class="note">
              <strong>商品信息</strong>
              <div class="footer-note">品牌：${escapeHtml(product.brand ?? "-")}</div>
              <div class="footer-note">类目：${escapeHtml(product.category ?? "-")}</div>
              <div class="footer-note">页面：<a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a></div>
              <div class="footer-note">导出时间：${escapeHtml(formatDateTime(exportedAt))}</div>
            </div>
          </div>
        </div>
      </section>

      <div class="stack">
        <section class="card">
          <div class="section-title">
            <div class="eyebrow">Market Summary</div>
            <h2>市场判断</h2>
            <p>保留现有规则分析结果，并输出可分享的静态 HTML 报告。</p>
          </div>
          <div class="grid-3">
            <div class="subcard">
              <h3>进入建议</h3>
              <p class="muted" style="margin-top: 10px;">${escapeHtml(analysis.recommendation)}</p>
            </div>
            <div class="subcard">
              <h3>竞争结构</h3>
              <ul>
                ${analysis.competition.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
              </ul>
            </div>
            <div class="subcard">
              <h3>生命周期证据</h3>
              <ul>
                ${analysis.lifecycle.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
              </ul>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="section-title">
            <div class="eyebrow">Trend</div>
            <h2>搜索趋势</h2>
            <p>导出版使用内联 SVG，便于离线查看和打印。</p>
          </div>
          ${renderTrendSvg(analysis.trendSeries)}
        </section>

        <section class="card">
          <div class="section-title">
            <div class="eyebrow">Signals</div>
            <h2>商品、Listing 与评论信号</h2>
            <p>保留现有前后端工作流，并额外提供适合汇报和归档的静态结构。</p>
          </div>
          <div class="grid-3">
            <div class="subcard">
              <h3>商品快照</h3>
              ${
                analysis.productSnapshot
                  ? `
                    <ul>
                      <li>卖家类型：${escapeHtml(analysis.productSnapshot.sellerType ?? "-")}</li>
                      <li>卖家数量：${escapeHtml(String(analysis.productSnapshot.sellerCount ?? "-"))}</li>
                      <li>变体数量：${escapeHtml(String(analysis.productSnapshot.variantCount ?? "-"))}</li>
                      <li>价格位置：${escapeHtml(analysis.productSnapshot.pricePositioning)}</li>
                    </ul>
                    ${analysis.productSnapshot.flags.length > 0 ? `<p class="footer-note">${escapeHtml(analysis.productSnapshot.flags.join("；"))}</p>` : ""}
                  `
                  : `<p class="muted">暂无商品快照。</p>`
              }
            </div>
            <div class="subcard">
              <h3>Listing 分析</h3>
              ${
                analysis.listingAnalysis
                  ? `
                    <p class="muted">${escapeHtml(analysis.listingAnalysis.summary)}</p>
                    ${renderList("优势", analysis.listingAnalysis.strengths)}
                    ${renderList("缺口", analysis.listingAnalysis.gaps)}
                    ${renderList("风险", analysis.listingAnalysis.warnings)}
                  `
                  : `<p class="muted">暂无 Listing 分析。</p>`
              }
            </div>
            <div class="subcard">
              <h3>评论分析</h3>
              ${
                analysis.reviewAnalysis
                  ? `
                    <p class="muted">${escapeHtml(analysis.reviewAnalysis.summary)}</p>
                    ${renderList("痛点", analysis.reviewAnalysis.painPoints)}
                    ${renderList("购买驱动", analysis.reviewAnalysis.purchaseDrivers)}
                    ${renderList("风险", analysis.reviewAnalysis.risks)}
                    ${renderList("备注", analysis.reviewAnalysis.notes)}
                  `
                  : `<p class="muted">暂无评论分析。</p>`
              }
            </div>
          </div>
        </section>

        ${
          compareProducts.length > 0
            ? `
              <section class="card">
                <div class="section-title">
                  <div class="eyebrow">Compare</div>
                  <h2>参考竞品</h2>
                  <p>保留人工选品流程，不把结果伪装成自动找爆品。</p>
                </div>
                <div class="grid-2">
                  ${compareProducts
                    .map(
                      (item) => `
                        <div class="subcard">
                          <h3>${escapeHtml(item.title)}</h3>
                          <p class="footer-note">ASIN ${escapeHtml(item.asin)}</p>
                          <p class="footer-note">价格 ${escapeHtml(formatCurrency(item.price))} / 评论 ${escapeHtml(formatCompactNumber(item.reviews))}</p>
                          <p class="footer-note">月销售额 ${escapeHtml(formatCurrency(item.monthlyRevenue))}</p>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              </section>
            `
            : ""
        }

        ${
          latestInspiration
            ? `
              <section class="card">
                <div class="section-title">
                  <div class="eyebrow">Inspiration</div>
                  <h2>Listing Inspiration</h2>
                  <p>导出已有的结构化灵感结果，保持与页面逻辑一致。</p>
                </div>
                <div class="grid-2">
                  <div class="subcard">
                    <h3>Audience</h3>
                    <p class="muted">${escapeHtml(latestInspiration.audience)}</p>
                    ${renderList("Purchase Drivers", latestInspiration.purchaseDrivers)}
                    ${renderList("Value Props", latestInspiration.valueProps)}
                  </div>
                  <div class="subcard">
                    <h3>方向建议</h3>
                    ${renderList("Pain Points", latestInspiration.painPoints)}
                    ${renderList("Differentiation Ideas", latestInspiration.differentiationIdeas)}
                    ${renderList("Listing Angles", latestInspiration.listingAngles)}
                    ${renderList("Visual Angles", latestInspiration.visualAngles)}
                  </div>
                </div>
              </section>
            `
            : ""
        }

        <section class="card">
          <div class="section-title">
            <div class="eyebrow">Sources</div>
            <h2>数据来源与解释</h2>
            <p>方便在不同系统、浏览器、终端和离线场景里复用同一份分析结果。</p>
          </div>
          <div class="grid-2">
            <div>
              ${renderDataSources(analysis.dataSources)}
            </div>
            <div>
              ${renderDataSources([data.spApiStatus])}
              <section class="source-card" style="margin-top: 18px;">
                <div class="source-header">
                  <strong>Explainability</strong>
                  <span>${analysis.explanationMeta.ruleBased ? "rule-based" : "manual"}</span>
                </div>
                <p>生成时间：${escapeHtml(formatDateTime(analysis.explanationMeta.generatedAt))}</p>
                <ul>
                  ${analysis.explanationMeta.notes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                  ${analysis.missingData.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                </ul>
              </section>
            </div>
          </div>
        </section>
      </div>
    </main>
  </body>
</html>`;
}
