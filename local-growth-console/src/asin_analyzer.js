(function () {
  const DATA_PATHS = ["./data/mock/asin_screening.mock.json", "./data/asin_analysis_mock.json"];
  const RECENT_KEY = "amazon_growth_console_recent_asins_v1";
  const ENRICHMENT_QUEUE_KEY = "amazon_growth_console_enrichment_queue_v1";
  const LIVE_CACHE_KEY = "amazon_growth_console_live_asin_cache_v1";

  let asinData = { samples: [], cases: {} };
  let candidateProducts = [];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatMoney(value) {
    if (value === null || value === undefined || value === "") return "-";
    return `$${Number(value).toFixed(2)}`;
  }

  function formatNumber(value) {
    if (value === null || value === undefined || value === "") return "-";
    return new Intl.NumberFormat("en-US").format(Number(value));
  }

  function normalizeAsin(value) {
    return String(value || "").trim().toUpperCase();
  }

  function isValidAsin(value) {
    return /^[A-Z0-9]{10}$/.test(value);
  }

  function extractAsins(text) {
    const matches = String(text || "").toUpperCase().match(/[A-Z0-9]{10}/g) || [];
    return Array.from(new Set(matches.filter(isValidAsin)));
  }

  async function loadFirst(paths, fallback) {
    for (const path of paths) {
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (response.ok) return response.json();
      } catch {
        continue;
      }
    }
    return fallback;
  }

  function readJsonState(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveRecent(asin) {
    const recent = readJsonState(RECENT_KEY).filter(item => item !== asin);
    recent.unshift(asin);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 8)));
  }

  function readQueue() {
    return readJsonState(ENRICHMENT_QUEUE_KEY);
  }

  function writeQueue(records) {
    localStorage.setItem(ENRICHMENT_QUEUE_KEY, JSON.stringify(records));
  }

  function readLiveCache() {
    return readJsonState(LIVE_CACHE_KEY);
  }

  function writeLiveCache(records) {
    localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(records.slice(0, 50)));
  }

  function cacheLiveCandidate(candidate) {
    if (!candidate || !candidate.asin) return;
    const records = readLiveCache().filter(item => item.asin !== candidate.asin);
    records.unshift({ ...candidate, cached_at: new Date().toISOString() });
    writeLiveCache(records);
  }

  function enqueueMissingAsin(asin) {
    const now = new Date().toISOString();
    const queue = readQueue();
    const existing = queue.find(item => item.asin === asin);
    if (existing) {
      existing.updated_at = now;
      writeQueue(queue);
      return existing;
    }
    const record = {
      asin,
      source: "asin_screening",
      status: "pending",
      created_at: now,
      updated_at: now,
      notes: "Data missing in local candidate pool.",
      attempt_count: 0,
      last_error: ""
    };
    queue.push(record);
    writeQueue(queue);
    return record;
  }

  function levelClass(value) {
    if (value === "high" || value === "advance") return "fit-high";
    if (value === "low" || value === "hold") return "fit-low";
    return "fit-medium";
  }

  function levelText(value) {
    const labels = { high: "高 / High", medium: "中 / Medium", low: "低 / Low" };
    return labels[value] || value || "-";
  }

  function stageText(value) {
    const labels = {
      introduction: "导入期 / Introduction",
      growth: "增长期 / Growth",
      maturity: "成熟期 / Maturity",
      decline: "衰退期 / Decline",
      uncertain: "待确认 / Uncertain"
    };
    return labels[value] || value || "-";
  }

  function listItems(items) {
    if (!items || !items.length) return `<p class="empty">暂无信号 / No signal yet.</p>`;
    return `<ul class="signal-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function renderTrend(values = []) {
    if (!values.length) return `<p class="empty">暂无趋势数据 / No trend data.</p>`;
    const max = Math.max(...values, 1);
    return `
      <div class="trend-bars" aria-label="12 month trend">
        ${values.map((value, index) => `
          <span style="height: ${Math.max(12, Math.round((value / max) * 92))}%;" title="M${index + 1}: ${escapeHtml(value)}"></span>
        `).join("")}
      </div>
    `;
  }

  function renderCompare(products = []) {
    if (!products.length) return `<p class="empty">暂无参考竞品 / No compare products supplied.</p>`;
    return `
      <div class="ads-table-wrap">
        <table class="ads-table">
          <thead>
            <tr>
              <th>ASIN</th>
              <th>产品 / Product</th>
              <th>Price</th>
              <th>Rating</th>
              <th>Reviews</th>
              <th>Monthly Units</th>
            </tr>
          </thead>
          <tbody>
            ${products.map(product => `
              <tr>
                <td>${escapeHtml(product.asin)}</td>
                <td><strong>${escapeHtml(product.title)}</strong><br><span>${escapeHtml(product.brand || "")}</span></td>
                <td>${formatMoney(product.price)}</td>
                <td>${escapeHtml(product.rating ?? "-")}</td>
                <td>${formatNumber(product.reviews)}</td>
                <td>${formatNumber(product.monthly_units)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function candidateCase(candidate, options = {}) {
    const asin = normalizeAsin(candidate.asin);
    const score = Number(candidate.total_score || candidate.market_score || 68);
    const opportunity = score >= 75 ? "high" : score >= 60 ? "medium" : "low";
    const competitionLevel = Number(candidate.review_count || 0) > 1000 ? "high" : Number(candidate.review_count || 0) > 300 ? "medium" : "low";
    return {
      mode: options.mode || "local_candidate_pool",
      label: options.label || "本地候选池 / Local candidate",
      source_details: options.sourceDetails || null,
      product: {
        asin,
        title: candidate.title || candidate.display_title || `Candidate ${asin}`,
        brand: candidate.brand || "Unknown",
        category: candidate.category || "Amazon US",
        price: candidate.reference_price,
        rating: candidate.rating,
        reviews: candidate.review_count,
        monthly_units: candidate.estimated_monthly_sales,
        monthly_revenue: Number(((candidate.estimated_monthly_sales || 0) * (candidate.reference_price || 0)).toFixed(2))
      },
      compare_products: [],
      trend_series: [420, 450, 480, 520, 560, 590, 620, 650, 680, 710, 740, 760],
      analysis: {
        summary: candidate.one_sentence_conclusion || candidate.market_situation || "该 ASIN 命中本地候选池，可基于标准化候选字段做初步判断。",
        recommendation: candidate.why_recommended || "继续核验真实销量、评论痛点、成本和是否与店铺已有产品重复。",
        decision: opportunity === "high" ? "advance" : "watch",
        decision_label: opportunity === "high" ? "推进 / Advance" : "继续观察 / Watch",
        score,
        lifecycle: {
          stage: candidate.timing_window === "early_layout" ? "introduction" : "growth",
          confidence: candidate.sales_confidence === "high" ? "high" : "medium",
          evidence: [
            candidate.seasonal_attribute || "本地候选池存在该 ASIN。",
            `推荐来源：${(candidate.recommendation_sources || []).join(", ") || "local"}`,
            `时间窗口：${candidate.timing_window || "unknown"}`
          ]
        },
        competition: {
          level: competitionLevel,
          entry_difficulty: competitionLevel,
          differentiation_room: opportunity,
          evidence: [
            candidate.competitive_notes || "使用本地候选字段进行竞争判断。",
            candidate.main_risks || "仍需补充真实评论和竞品数据。"
          ]
        },
        market_overview: {
          opportunity_level: opportunity,
          entry_barrier: competitionLevel,
          search_trend_delta: 0.12,
          sales_trend_delta: 0.1,
          brand_concentration: 48,
          review_barrier: candidate.review_count || 0,
          price_spread: 0.2
        },
        product_snapshot: {
          seller_type: "local candidate",
          seller_count: null,
          variant_count: null,
          listing_quality_score: null,
          price_positioning: candidate.reference_price >= 20 && candidate.reference_price <= 80 ? "focus range" : "outside focus range",
          age_months: null,
          dimensions_summary: candidate.size_risk || "-",
          flags: [
            `产品类型：${candidate.product_type || "-"}`,
            `子场景：${candidate.sub_scenario || "-"}`,
            `店铺匹配：${candidate.store_fit || "-"}`
          ]
        },
        listing_analysis: {
          confidence: "medium",
          summary: candidate.market_situation || "Listing 文本仍需人工或 API 补全。",
          strengths: [candidate.why_recommended].filter(Boolean),
          gaps: ["补充标题、五点、图片、A+ 和真实 Review 摘要。"],
          warnings: [candidate.main_risks || "不要仅凭本地候选字段下采购决策。"]
        },
        review_analysis: {
          confidence: candidate.review_count ? "medium" : "low",
          coverage: "candidate_fields",
          summary: "本地候选字段没有完整评论文本，仅能做初筛。",
          pain_points: candidate.pain_points || [],
          purchase_drivers: candidate.purchase_drivers || [],
          risks: [candidate.main_risks || "需导入评论摘要后再判断退货和质量风险。"]
        },
        next_steps: [
          candidate.next_step || "补充真实 Keepa / 评论 / 竞品数据。",
          "检查是否与店铺已有产品近似重复。",
          "确认供应商成本和包装尺寸。"
        ]
      }
    };
  }

  function dataMissingCase(asin) {
    const queueRecord = enqueueMissingAsin(asin);
    return {
      mode: "data_missing",
      label: "数据缺失 / Data missing",
      queue_record: queueRecord,
      product: {
        asin,
        title: `ASIN ${asin}`,
        brand: "",
        category: "Unknown",
        price: null,
        rating: null,
        reviews: null,
        monthly_units: null,
        monthly_revenue: null
      },
      compare_products: [],
      trend_series: [],
      analysis: {
        summary: "数据缺失：该 ASIN 暂未在本地候选池中。",
        recommendation: "已加入待补全队列，后续可通过 Keepa、手工导入或第三方数据补充后再判断。",
        decision: "hold",
        decision_label: "待补全 / Data Missing",
        score: 0,
        lifecycle: { stage: "uncertain", confidence: "low", evidence: ["本地候选池未命中。"] },
        competition: { level: "low", evidence: ["暂无竞争数据。"] },
        market_overview: { opportunity_level: "low" }
      }
    };
  }

  function getLocalCase(asin) {
    if (asinData.cases && asinData.cases[asin]) return asinData.cases[asin];
    const candidate = candidateProducts.find(item => normalizeAsin(item.asin) === asin);
    if (candidate) return candidateCase(candidate);
    const cached = readLiveCache().find(item => normalizeAsin(item.asin) === asin);
    if (cached) {
      return candidateCase(cached, {
        mode: "jungle_scout_api_cached",
        label: "Jungle Scout API 缓存 / Cached API result",
        sourceDetails: { cached_at: cached.cached_at || "" }
      });
    }
    return null;
  }

  async function fetchLiveAsinCase(asin) {
    try {
      const response = await fetch(`./api/jungle-scout/asin?asin=${encodeURIComponent(asin)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `Jungle Scout API returned HTTP ${response.status}`);
        error.details = payload.details || null;
        throw error;
      }
      if (!payload.candidate || !payload.candidate.asin) {
        throw new Error("Jungle Scout API returned no usable candidate.");
      }
      cacheLiveCandidate(payload.candidate);
      candidateProducts = [
        payload.candidate,
        ...candidateProducts.filter(item => normalizeAsin(item.asin) !== normalizeAsin(payload.candidate.asin))
      ];
      return candidateCase(payload.candidate, {
        mode: "jungle_scout_api_live",
        label: "Jungle Scout API 实时 / Live API result",
        sourceDetails: payload.provider || null
      });
    } catch (error) {
      const missing = dataMissingCase(asin);
      missing.mode = "api_error";
      missing.label = "实时 API 失败 / API error";
      missing.analysis.summary = `实时 API 调用失败：${error.message}`;
      missing.analysis.recommendation = "已加入待补全队列。请确认本地服务由 npm start 启动，并检查 Jungle Scout API key 是否有效。";
      missing.analysis.next_steps = [
        "确认当前页面地址由本地 API 代理服务提供。",
        "运行 npm run check:jungle-scout-api 检查凭据状态。",
        "稍后重试该 ASIN，或先用已导入候选池数据判断。"
      ];
      if (missing.queue_record) missing.queue_record.last_error = error.message;
      return missing;
    }
  }

  async function getCase(asin, options = {}) {
    const localCase = options.forceRemote ? null : getLocalCase(asin);
    if (localCase) return localCase;
    if (options.allowRemote === false) return dataMissingCase(asin);
    return fetchLiveAsinCase(asin);
  }

  function renderBatchResults(records) {
    const root = document.getElementById("asinBatchResults");
    if (!root) return;
    if (!records.length) {
      root.innerHTML = "";
      return;
    }
    root.innerHTML = `
      <article class="ads-card">
        <div class="section-title" style="margin-top: 0;">
          <h2>批量判断结果 / Batch Results</h2>
          <span class="feed-count">${records.length} ASINs</span>
        </div>
        <div class="batch-results">
          ${records.map(record => `
            <div class="batch-row">
              <div>
                <strong>${escapeHtml(record.product.asin)}</strong>
                <span>${escapeHtml(record.mode)}</span>
              </div>
              <div>
                <strong>${escapeHtml(record.product.title)}</strong>
                <span>Score ${escapeHtml(record.analysis.score)} · Opportunity ${escapeHtml(levelText(record.analysis.market_overview.opportunity_level))}</span>
              </div>
              <div class="actions" style="margin-top: 0;">
                <span class="badge ${levelClass(record.analysis.decision)}">${escapeHtml(record.analysis.decision_label)}</span>
                <button class="btn small" type="button" data-asin-sample="${escapeHtml(record.product.asin)}">查看详情 / View</button>
              </div>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }

  function renderMissingAnalysis(record) {
    const root = document.getElementById("asinAnalysisContent");
    if (!root) return;
    root.innerHTML = `
      <article class="ads-card asin-result-card">
        <div class="ads-card-head">
          <div>
            <span class="rank">${escapeHtml(record.label)} · ${escapeHtml(record.mode)}</span>
            <h3>${escapeHtml(record.product.title)}</h3>
            <p>ASIN ${escapeHtml(record.product.asin)} · enrichment queue</p>
          </div>
          <div class="ads-card-badges">
            <span class="badge fit-low">待补全 / Data Missing</span>
          </div>
        </div>
        <p class="conclusion">
          数据缺失：该 ASIN 暂未在本地候选池中。已加入待补全队列，后续可通过 Keepa 或手工导入补充数据。
          / Data missing: this ASIN is not in the local candidate pool. It has been added to the enrichment queue.
        </p>
        <div class="ads-metric-grid">
          <div class="ads-mini-stat"><span>Queue Status</span><strong>${escapeHtml(record.queue_record.status)}</strong></div>
          <div class="ads-mini-stat"><span>Source</span><strong>${escapeHtml(record.queue_record.source)}</strong></div>
          <div class="ads-mini-stat"><span>Attempts</span><strong>${escapeHtml(record.queue_record.attempt_count)}</strong></div>
          <div class="ads-mini-stat"><span>Updated</span><strong>${escapeHtml(record.queue_record.updated_at.slice(0, 10))}</strong></div>
        </div>
      </article>
    `;
  }

  function renderAnalysis(record) {
    if (record.mode === "data_missing") {
      renderMissingAnalysis(record);
      return;
    }
    const root = document.getElementById("asinAnalysisContent");
    const product = record.product;
    const analysis = record.analysis;
    const overview = analysis.market_overview || {};
    const snapshot = analysis.product_snapshot || {};

    root.innerHTML = `
      <article class="ads-card asin-result-card">
        <div class="ads-card-head">
          <div>
            <span class="rank">${escapeHtml(record.label)} · ${escapeHtml(record.mode)}</span>
            <h3>${escapeHtml(product.title)}</h3>
            <p>${escapeHtml(product.category)} · ASIN ${escapeHtml(product.asin)} · ${escapeHtml(product.brand || "Unknown")}</p>
          </div>
          <div class="ads-card-badges">
            <span class="badge ${levelClass(analysis.decision)}">${escapeHtml(analysis.decision_label)}</span>
            <span class="badge ${levelClass(overview.opportunity_level)}">机会 ${escapeHtml(levelText(overview.opportunity_level))}</span>
          </div>
        </div>
        <div class="asin-score-row">
          <div class="asin-score">
            <span>Opportunity Score</span>
            <strong>${escapeHtml(analysis.score)}</strong>
            <div class="score-track"><i style="width: ${Math.max(5, Math.min(100, Number(analysis.score || 0)))}%;"></i></div>
          </div>
          <p class="conclusion">${escapeHtml(analysis.summary)} ${escapeHtml(analysis.recommendation)}</p>
        </div>
        <div class="ads-metric-grid">
          <div class="ads-mini-stat"><span>Price</span><strong>${formatMoney(product.price)}</strong></div>
          <div class="ads-mini-stat"><span>Rating</span><strong>${escapeHtml(product.rating ?? "-")}</strong></div>
          <div class="ads-mini-stat"><span>Reviews</span><strong>${formatNumber(product.reviews)}</strong></div>
          <div class="ads-mini-stat"><span>Monthly Units</span><strong>${formatNumber(product.monthly_units)}</strong></div>
          <div class="ads-mini-stat"><span>Monthly Revenue</span><strong>${formatMoney(product.monthly_revenue)}</strong></div>
          <div class="ads-mini-stat"><span>Lifecycle</span><strong>${escapeHtml(stageText(analysis.lifecycle && analysis.lifecycle.stage))}</strong></div>
          <div class="ads-mini-stat"><span>Competition</span><strong>${escapeHtml(levelText(analysis.competition && analysis.competition.level))}</strong></div>
          <div class="ads-mini-stat"><span>Entry Barrier</span><strong>${escapeHtml(levelText(overview.entry_barrier))}</strong></div>
        </div>
      </article>
      <div class="module-grid">
        <article class="ads-card">
          <div class="section-title" style="margin-top: 0;">
            <h2>市场阶段 / Lifecycle</h2>
            <span class="badge ${levelClass(analysis.lifecycle && analysis.lifecycle.confidence)}">${escapeHtml(levelText(analysis.lifecycle && analysis.lifecycle.confidence))}</span>
          </div>
          ${listItems(analysis.lifecycle && analysis.lifecycle.evidence)}
        </article>
        <article class="ads-card">
          <div class="section-title" style="margin-top: 0;">
            <h2>竞争格局 / Competition</h2>
            <span class="badge ${levelClass(analysis.competition && analysis.competition.level)}">${escapeHtml(levelText(analysis.competition && analysis.competition.level))}</span>
          </div>
          ${listItems(analysis.competition && analysis.competition.evidence)}
        </article>
      </div>
      <article class="ads-card">
        <div class="section-title" style="margin-top: 0;">
          <h2>趋势和市场指标 / Trend and Market Metrics</h2>
          <span class="feed-count">12 months local series</span>
        </div>
        ${renderTrend(record.trend_series)}
      </article>
      <div class="module-grid">
        <article class="ads-card">
          <h2 style="margin-top: 0;">商品快照 / Product Snapshot</h2>
          <div class="ads-metric-grid">
            <div class="ads-mini-stat"><span>Seller Type</span><strong>${escapeHtml(snapshot.seller_type || "-")}</strong></div>
            <div class="ads-mini-stat"><span>Seller Count</span><strong>${escapeHtml(snapshot.seller_count ?? "-")}</strong></div>
            <div class="ads-mini-stat"><span>Variants</span><strong>${escapeHtml(snapshot.variant_count ?? "-")}</strong></div>
            <div class="ads-mini-stat"><span>Listing Score</span><strong>${escapeHtml(snapshot.listing_quality_score ?? "-")}</strong></div>
            <div class="ads-mini-stat"><span>Price Position</span><strong>${escapeHtml(snapshot.price_positioning || "-")}</strong></div>
            <div class="ads-mini-stat"><span>Age</span><strong>${snapshot.age_months === null || snapshot.age_months === undefined ? "-" : `${escapeHtml(snapshot.age_months)} mo`}</strong></div>
          </div>
          ${listItems(snapshot.flags)}
        </article>
        <article class="ads-card">
          <h2 style="margin-top: 0;">下一步 / Next Steps</h2>
          ${listItems(analysis.next_steps)}
        </article>
      </div>
      <div class="module-grid">
        <article class="ads-card">
          <div class="section-title" style="margin-top: 0;">
            <h2>Listing 评估 / Listing Review</h2>
            <span class="badge ${levelClass(analysis.listing_analysis && analysis.listing_analysis.confidence)}">${escapeHtml(levelText(analysis.listing_analysis && analysis.listing_analysis.confidence))}</span>
          </div>
          <p>${escapeHtml(analysis.listing_analysis && analysis.listing_analysis.summary)}</p>
          <div class="copy-grid">
            <div class="copy-block"><h3>优势 / Strengths</h3>${listItems(analysis.listing_analysis && analysis.listing_analysis.strengths)}</div>
            <div class="copy-block"><h3>缺口 / Gaps</h3>${listItems(analysis.listing_analysis && analysis.listing_analysis.gaps)}</div>
            <div class="copy-block"><h3>风险 / Warnings</h3>${listItems(analysis.listing_analysis && analysis.listing_analysis.warnings)}</div>
          </div>
        </article>
        <article class="ads-card">
          <div class="section-title" style="margin-top: 0;">
            <h2>评论信号 / Review Signals</h2>
            <span class="badge ${levelClass(analysis.review_analysis && analysis.review_analysis.confidence)}">${escapeHtml(levelText(analysis.review_analysis && analysis.review_analysis.confidence))}</span>
          </div>
          <p>${escapeHtml(analysis.review_analysis && analysis.review_analysis.summary)}</p>
          <div class="copy-grid">
            <div class="copy-block"><h3>痛点 / Pain Points</h3>${listItems(analysis.review_analysis && analysis.review_analysis.pain_points)}</div>
            <div class="copy-block"><h3>购买驱动 / Drivers</h3>${listItems(analysis.review_analysis && analysis.review_analysis.purchase_drivers)}</div>
            <div class="copy-block"><h3>风险 / Risks</h3>${listItems(analysis.review_analysis && analysis.review_analysis.risks)}</div>
          </div>
        </article>
      </div>
      <article class="ads-card">
        <div class="section-title" style="margin-top: 0;">
          <h2>参考竞品 / Compare Products</h2>
          <span class="feed-count">${(record.compare_products || []).length} ASINs</span>
        </div>
        ${renderCompare(record.compare_products)}
      </article>
    `;
  }

  function renderRecent() {
    const root = document.getElementById("recentAsins");
    if (!root) return;
    const items = readJsonState(RECENT_KEY);
    root.innerHTML = items.length
      ? items.map(asin => `<button class="btn small" type="button" data-asin-sample="${escapeHtml(asin)}">${escapeHtml(asin)}</button>`).join("")
      : `<span class="empty">暂无历史 ASIN / No recent ASINs.</span>`;
  }

  async function analyzeAsin(value, options = {}) {
    const asin = normalizeAsin(value);
    const status = document.getElementById("asinAnalyzerStatus");
    const input = document.getElementById("asinInput");
    if (!isValidAsin(asin)) {
      if (status) status.textContent = "请输入 10 位 ASIN。/ Enter a 10-character ASIN.";
      return;
    }
    if (input) input.value = asin;
    saveRecent(asin);
    renderRecent();
    const localCase = options.forceRemote ? null : getLocalCase(asin);
    if (status) {
      status.textContent = localCase
        ? "正在读取本地 ASIN 判断数据。/ Loading local ASIN analysis."
        : "正在实时调用 Jungle Scout API。/ Querying Jungle Scout API.";
    }
    const record = localCase || await getCase(asin, { forceRemote: Boolean(options.forceRemote) });
    renderAnalysis(record);
    if (!status) return;
    if (record.mode === "data_missing") {
      status.textContent = "数据缺失：该 ASIN 暂未在本地候选池中，已加入待补全队列。/ Data missing; added to enrichment queue.";
    } else if (record.mode === "local_candidate_pool") {
      status.textContent = "已命中本地候选池。/ Loaded from local candidate pool.";
    } else if (record.mode === "jungle_scout_api_live") {
      status.textContent = "已实时调用 Jungle Scout API 并缓存该 ASIN。/ Loaded live from Jungle Scout API and cached.";
    } else if (record.mode === "jungle_scout_api_cached") {
      status.textContent = "已命中 Jungle Scout API 本地缓存。/ Loaded from cached API result.";
    } else if (record.mode === "api_error") {
      status.textContent = "实时 API 调用失败，已加入待补全队列。/ Live API failed; added to enrichment queue.";
    } else {
      status.textContent = "已加载本地样例分析。/ Loaded local sample analysis.";
    }
  }

  async function analyzeBatch(text) {
    const status = document.getElementById("asinAnalyzerStatus");
    const asins = extractAsins(text);
    if (!asins.length) {
      renderBatchResults([]);
      if (status) status.textContent = "未识别到有效 ASIN。/ No valid ASINs found.";
      return;
    }
    if (status) status.textContent = `正在判断 ${asins.length} 个 ASIN；本地未命中项会实时调用 Jungle Scout API。`;
    const records = await Promise.all(asins.map(asin => getCase(asin)));
    asins.forEach(saveRecent);
    renderRecent();
    renderBatchResults(records);
    renderAnalysis(records[0]);
    const input = document.getElementById("asinInput");
    if (input) input.value = records[0].product.asin;
    if (status) {
      const liveCount = records.filter(record => record.mode === "jungle_scout_api_live").length;
      const cachedCount = records.filter(record => record.mode === "jungle_scout_api_cached").length;
      const failedCount = records.filter(record => record.mode === "api_error").length;
      status.textContent = `已完成 ${asins.length} 个 ASIN 判断；实时 API ${liveCount} 个，缓存 ${cachedCount} 个，失败 ${failedCount} 个。`;
    }
  }

  function clearBatch() {
    const input = document.getElementById("asinBatchInput");
    const file = document.getElementById("asinBatchFile");
    if (input) input.value = "";
    if (file) file.value = "";
    renderBatchResults([]);
    const status = document.getElementById("asinAnalyzerStatus");
    if (status) status.textContent = "批量输入已清空。/ Batch input cleared.";
  }

  async function init() {
    asinData = await loadFirst(DATA_PATHS, { samples: [], cases: {} });
    candidateProducts = window.ProductCandidateProvider
      ? await window.ProductCandidateProvider.loadCandidateProducts()
      : await loadFirst(["./data/product_research/candidate_products.json", "./data/candidate_products.json"], []);

    const form = document.getElementById("asinAnalyzerForm");
    if (form) {
      form.addEventListener("submit", event => {
        event.preventDefault();
        void analyzeAsin(document.getElementById("asinInput").value);
      });
    }

    document.addEventListener("click", event => {
      const button = event.target.closest("[data-asin-action]");
      if (!button) return;
      const action = button.dataset.asinAction;
      if (action === "analyze-batch") void analyzeBatch(document.getElementById("asinBatchInput").value);
      if (action === "refresh-live") void analyzeAsin(document.getElementById("asinInput").value, { forceRemote: true });
      if (action === "clear-batch") clearBatch();
    });

    const fileInput = document.getElementById("asinBatchFile");
    if (fileInput) {
      fileInput.addEventListener("change", event => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || "");
          const input = document.getElementById("asinBatchInput");
          if (input) input.value = text;
          void analyzeBatch(text);
        };
        reader.readAsText(file);
      });
    }

    document.addEventListener("click", event => {
      const sample = event.target.closest("[data-asin-sample]");
      if (!sample) return;
      void analyzeAsin(sample.dataset.asinSample);
    });

    renderRecent();
    await analyzeAsin((asinData.samples && asinData.samples[0]) || "B0CGXQL7NK");
  }

  init().catch(error => {
    console.error(error);
    const root = document.getElementById("asinAnalysisContent");
    if (root) {
      root.innerHTML = `<article class="ads-card"><h3>ASIN 判断模块加载失败</h3><p>${escapeHtml(error.message)}</p></article>`;
    }
  });
})();
