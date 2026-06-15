(function () {
  let recommendations = [];

  const feed = document.getElementById("recommendationFeed");
  const watchlistItems = document.getElementById("watchlistItems");
  const watchlistEmpty = document.getElementById("watchlistEmpty");

  const sourceLabels = {
    market_opportunity: "市场机会",
    store_expansion: "店铺扩展",
    seasonal_early_layout: "季节性提前布局",
    jungle_scout_api: "第三方实时数据",
    jungle_scout_import: "第三方导入数据"
  };

  const storeFitLabels = {
    high: "高",
    medium: "中",
    low: "低"
  };

  const opportunityLabels = {
    current_opportunity: "当前机会",
    near_term_opening: "近期开口",
    future_seasonal_opportunity: "未来季节机会",
    store_adjacent: "店铺相邻机会",
    market_import: "市场导入机会"
  };

  const timingLabels = {
    current_opportunity: "当前机会",
    near_term_opening: "近期开口",
    early_layout: "提前布局",
    off_season_observation: "淡季观察",
    not_seasonal: "非明显季节品",
    unknown: "待确认"
  };

  const actionLabels = {
    review_negative_reviews: "查看差评",
    add_to_watchlist: "加入观察清单",
    hold: "暂缓",
    recheck_later: "稍后复查",
    reject: "拒绝"
  };

  const watchStatusLabels = {
    watching: "观察中",
    shortlisted: "已入短名单",
    review_analysis: "差评复核",
    sample_requested: "样品待测",
    developing: "开发中",
    checking_supplier: "待复核"
  };

  const categoryLabels = {
    "Patio, Lawn & Garden": "庭院、草坪与花园",
    "Automotive": "汽车配件",
    "Tools & Home Improvement": "工具与家居改善",
    "Sports & Outdoors": "户外运动",
    "Office Products": "办公用品",
    "RV Accessories": "房车配件",
    "Garden Hose & Irrigation": "花园水管与灌溉",
    "Garage Hardware": "车库五金"
  };

  function hasEnglishWords(value) {
    return /[A-Za-z]{3,}/.test(String(value || ""));
  }

  function chineseProductName(product) {
    const text = [product.display_title, product.title, product.product_type, product.sub_scenario, product.category, ...(product.keywords || [])]
      .join(" ")
      .toLowerCase();
    if (text.includes("faucet") || text.includes("spigot") || text.includes("freeze")) return "户外水龙头防冻保护罩";
    if (text.includes("hose storage") || text.includes("storage bag")) return text.includes("rv") ? "房车水管收纳袋" : "花园水管收纳袋";
    if (text.includes("door edge") || text.includes("edge guard")) return "汽车车门边缘防护条";
    if (text.includes("sewer hose support")) return "房车排污管支架";
    if (text.includes("water pressure regulator") || text.includes("pressure reducer")) return "房车水压调节阀";
    if (text.includes("inline water filter") || text.includes("water filter")) return "房车水路过滤器";
    if (text.includes("quick connect") || text.includes("connector")) return "花园水管快接套装";
    if (text.includes("wheel chock")) return "拖车轮挡";
    if (text.includes("wall hook") || text.includes("hook")) return "重型车库挂钩";
    return product.asin ? `商品机会 ${product.asin}` : "产品机会";
  }

  function displayTitle(product) {
    const title = product.display_title || product.title || "";
    return hasEnglishWords(title) ? chineseProductName(product) : title || chineseProductName(product);
  }

  function displayCategory(value) {
    return categoryLabels[value] || value || "未分类";
  }

  function displaySeasonality(product) {
    const text = String(product.seasonal_attribute || "").toLowerCase();
    if (!text) return "待确认";
    if (text.includes("freeze") || text.includes("winter")) return "冬季防冻场景，适合提前布局或淡季观察";
    if (text.includes("spring") || text.includes("outdoor")) return "春季户外维护场景";
    if (text.includes("current")) return "当前可观察机会";
    return hasEnglishWords(product.seasonal_attribute) ? "季节窗口需结合搜索趋势复核" : product.seasonal_attribute;
  }

  function displayDecisionCopy(product, field) {
    const value = product[field] || "";
    if (!hasEnglishWords(value)) return value;
    const name = displayTitle(product);
    const copies = {
      market_situation: `围绕${name}已有可观察需求，但仍需核验销量、价格带、评论门槛和同类竞争强度。`,
      use_case: `${name}面向亚马逊美国站用户的维护、收纳或替换场景，适合做轻量机会初筛。`,
      why_recommended: `该机会来自候选池的需求、价格和店铺扩展信号，值得进入供应商成本和差评验证。`,
      main_risks: "接口字段可能不完整，需要重点核验供应商成本、差评问题、尺寸包装和与店铺现有产品的相似度。",
      next_step: "先完成重复过滤、供应商报价、前台差评抽样和到岸利润测算。"
    };
    return copies[field] || value;
  }

  function displayDetailCopy(product, field) {
    const value = product[field] || "";
    if (!hasEnglishWords(value)) return value;
    const copies = {
      competitive_notes: "检查前台头部竞品的价格带、评论门槛、变体数量和卖点差异。",
      seasonality_notes: "结合季节窗口、搜索趋势和备货周期判断是否现在进入。",
      store_expansion_logic: "与店铺既有方向相邻，但需确认不会和已有核心产品重复。",
      validation_checklist: "核验供应商报价、包装尺寸、配送费用、差评痛点和同类竞品。"
    };
    return copies[field] || value;
  }

  function safeId(index) {
    return `product-${index + 1}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatPrice(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function formatSales(value, timingWindow, range = "", confidence = "") {
    const confidenceLabels = { high: "高", medium: "中", low: "低", mock: "模拟" };
    const suffix = timingWindow === "early_layout" ? "；季节目标 75+" : "";
    const displayRange = range || `${Number(value || 0)} 预估件`;
    const confidenceText = confidence ? `；置信度：${confidenceLabels[confidence] || confidence}` : "";
    return `${displayRange}${confidenceText}${suffix}`;
  }

  function formatSources(sources) {
    return (sources || []).map(source => sourceLabels[source] || source).join(" + ");
  }

  function gradeClass(grade) {
    return String(grade || "C").toLowerCase().replace("+", "-plus");
  }

  function fitClass(fit) {
    return `fit-${fit || "medium"}`;
  }

  function amazonUrl(product) {
    const asin = String(product && product.asin ? product.asin : "").trim().toUpperCase();
    return /^[A-Z0-9]{10}$/.test(asin) ? `https://www.amazon.com/dp/${encodeURIComponent(asin)}` : "";
  }

  function setStatus(index, message, tone = "positive") {
    const status = document.querySelector(`[data-status="${index}"]`);
    if (!status) return;
    status.textContent = message;
    status.style.color = tone === "negative" ? "var(--red)" : "var(--green)";
  }

  function persistFeedback(index, action, reason = "") {
    const product = recommendations[index];
    const record = window.Feedback.addRecord(product, action, reason);
    if (action === "interested" && window.Watchlist) {
      window.Watchlist.add(product, { reason_added: "interested", status: "shortlisted" });
    }
    if (action === "add_to_watchlist" && window.Watchlist) {
      window.Watchlist.add(product, { reason_added: "user_action", status: "watching" });
    }
    const tone = action === "reject" || action === "rejected" ? "negative" : "positive";
    setStatus(index, window.Feedback.statusText(record), tone);
    renderWatchlist();
    return record;
  }

  function renderError(error) {
    feed.innerHTML = `
      <article class="product-card">
        <div class="card-main">
          <h2 class="product-title">推荐数据加载失败</h2>
          <p class="category">请确认本地数据文件和脚本可通过当前静态地址访问。</p>
          <p class="conclusion">${escapeHtml(error.message)}</p>
        </div>
      </article>
    `;
  }

  function renderReasonOptions() {
    return window.Feedback.rejectionReasons.map(reason => (
      `<option value="${escapeHtml(reason.value)}">${escapeHtml(reason.label)}</option>`
    )).join("");
  }

  function renderRecommendations() {
    feed.innerHTML = recommendations.map((item, index) => {
      const id = safeId(index);
      const checklistPoints = (item.validation_checklist || []);
      const checklist = (checklistPoints.length ? checklistPoints : [displayDetailCopy(item, "validation_checklist")])
        .map(point => `<li>${escapeHtml(hasEnglishWords(point) ? displayDetailCopy(item, "validation_checklist") : point)}</li>`)
        .join("");
      const sourceText = formatSources(item.recommendation_sources);
      const storeFitText = storeFitLabels[item.store_fit] || item.store_fit;
      const opportunityText = opportunityLabels[item.opportunity_type] || item.opportunity_type;
      const timingText = timingLabels[item.timing_window] || item.timing_window;
      const actionText = actionLabels[item.action_suggestion] || item.action_suggestion;
      const candidateLevelText = item.candidate_level === "product_idea" ? "产品方向" : "具体商品";
      const latestFeedback = window.Feedback.latestForProduct(item.asin, item.idea_id, `${item.product_type || "unknown"}:${item.title || ""}`);
      const statusText = window.Feedback.statusText(latestFeedback);
      const statusTone = latestFeedback && (latestFeedback.action === "reject" || latestFeedback.action === "rejected") ? "var(--red)" : "var(--green)";
      const amazonLink = amazonUrl(item);
      const titleText = displayTitle(item);
      const categoryText = displayCategory(item.category);
      const seasonalText = displaySeasonality(item);
      const marketText = displayDecisionCopy(item, "market_situation");
      const useCaseText = displayDecisionCopy(item, "use_case");
      const whyText = displayDecisionCopy(item, "why_recommended");
      const riskText = displayDecisionCopy(item, "main_risks");
      const nextText = displayDecisionCopy(item, "next_step");

      return `
        <article class="product-card" id="${id}">
          <div class="card-main">
            <div class="card-head">
              <div>
                <span class="rank">排名 ${index + 1} · 分数 ${item.total_score}</span>
                <h2 class="product-title">${escapeHtml(titleText)}</h2>
                <p class="category">${escapeHtml(categoryText)}</p>
              </div>
              <span class="badge grade ${gradeClass(item.recommendation_grade)}" aria-label="推荐等级 ${item.recommendation_grade}">${item.recommendation_grade}</span>
            </div>

            <div class="badge-row">
              <span class="badge source">${escapeHtml(sourceText)}</span>
              <span class="badge action">${escapeHtml(candidateLevelText)}</span>
              <span class="badge ${fitClass(item.store_fit)}">店铺匹配：${escapeHtml(storeFitText)}</span>
              <span class="badge timing">${escapeHtml(timingText)}</span>
              <span class="badge action">${escapeHtml(actionText)}</span>
            </div>

            <div class="stats-grid">
              <div class="stat">
                <span class="stat-label">代表商品编号</span>
                <span class="stat-value">${escapeHtml(item.asin || item.idea_id || "产品方向")}</span>
              </div>
              <div class="stat">
                <span class="stat-label">参考价格</span>
                <span class="stat-value">${formatPrice(item.reference_price)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">预估月销量</span>
                <span class="stat-value">${escapeHtml(formatSales(item.estimated_monthly_sales, item.timing_window, item.estimated_monthly_sales_range, item.sales_confidence))}</span>
              </div>
              <div class="stat">
                <span class="stat-label">机会类型</span>
                <span class="stat-value">${escapeHtml(opportunityText)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">季节属性</span>
                <span class="stat-value">${escapeHtml(seasonalText)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">行动建议</span>
                <span class="stat-value">${escapeHtml(actionText)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">店铺匹配</span>
                <span class="stat-value">${escapeHtml(storeFitText)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">推荐来源</span>
                <span class="stat-value">${escapeHtml(sourceText)}</span>
              </div>
            </div>

            <p class="conclusion">${escapeHtml(whyText)}</p>

            <div class="copy-grid">
              <div class="copy-block">
                <h3>市场情况</h3>
                <p>${escapeHtml(marketText)}</p>
              </div>
              <div class="copy-block">
                <h3>使用场景</h3>
                <p>${escapeHtml(useCaseText)}</p>
              </div>
              <div class="copy-block">
                <h3>推荐原因</h3>
                <p>${escapeHtml(whyText)}</p>
              </div>
              <div class="copy-block">
                <h3>主要风险</h3>
                <p>${escapeHtml(riskText)}</p>
              </div>
              <div class="copy-block">
                <h3>下一步</h3>
                <p>${escapeHtml(nextText)}</p>
              </div>
            </div>

            <div class="actions">
              <button class="btn primary" type="button" data-action="interested" data-index="${index}">感兴趣</button>
              <button class="btn" type="button" data-action="watchlist" data-index="${index}">加入观察</button>
              <button class="btn danger" type="button" data-action="reject" data-index="${index}">拒绝</button>
              <button class="btn" type="button" data-action="details" data-index="${index}" aria-expanded="false" aria-controls="${id}-details">查看详情</button>
              ${amazonLink ? `<a class="btn amazon" href="${escapeHtml(amazonLink)}" data-action="open-amazon" data-index="${index}" aria-label="打开亚马逊前台页面：${escapeHtml(item.asin)}">打开亚马逊</a>` : `<button class="btn amazon" type="button" disabled>无商品编号</button>`}
              <span class="status" data-status="${index}" aria-live="polite" style="color: ${statusTone};">${escapeHtml(statusText)}</span>
              <div class="feedback-row" data-reject-row="${index}">
                <select class="reason-select" data-reason-select="${index}" aria-label="拒绝原因">
                  ${renderReasonOptions()}
                </select>
                <button class="btn danger" type="button" data-action="confirm-reject" data-index="${index}">确认拒绝</button>
              </div>
            </div>
          </div>

          <div class="details" id="${id}-details">
            <div class="detail-grid">
              <div class="detail-panel">
                <h4>竞争备注</h4>
                <p>${escapeHtml(displayDetailCopy(item, "competitive_notes"))}</p>
              </div>
              <div class="detail-panel">
                <h4>季节性备注</h4>
                <p>${escapeHtml(displayDetailCopy(item, "seasonality_notes"))}</p>
              </div>
              <div class="detail-panel">
                <h4>店铺扩展逻辑</h4>
                <p>${escapeHtml(displayDetailCopy(item, "store_expansion_logic"))}</p>
              </div>
              <div class="detail-panel">
                <h4>验证清单</h4>
                <ul>${checklist}</ul>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderWatchlist() {
    const records = window.Watchlist ? window.Watchlist.getActive() : window.Feedback.getWatchlist();
    watchlistEmpty.style.display = records.length ? "none" : "block";
    watchlistItems.innerHTML = records.map(record => {
      const key = window.Watchlist ? window.Watchlist.productKey(record) : (record.asin || record.idea_id || `${record.product_type || "unknown"}:${record.title || ""}`);
      const rawStatus = record.status || record.action || "watching";
      const statusText = watchStatusLabels[rawStatus] || rawStatus.replace(/_/g, " ");
      return `
      <div class="watchlist-row">
        <div>
          <strong>${escapeHtml(record.title)}</strong>
          <span>${escapeHtml(record.category)} | ${formatPrice(record.reference_price)} | ${escapeHtml(statusText)}${record.next_check_date ? ` | 下次复查：${escapeHtml(record.next_check_date)}` : ""}</span>
        </div>
        <div class="watchlist-actions">
          <span class="badge action">${escapeHtml(statusText)}</span>
          <button class="btn small danger" type="button" data-action="remove-watchlist" data-watch-key="${escapeHtml(key)}">删除</button>
        </div>
      </div>
    `;
    }).join("");
  }

  function removeWatchlistItem(key) {
    if (!window.Watchlist || !key) return;
    window.Watchlist.remove(key);
    renderWatchlist();
    if (window.reloadRecommendations) window.reloadRecommendations();
  }

  function showRejectReasons(index) {
    const row = document.querySelector(`[data-reject-row="${index}"]`);
    if (row) row.classList.toggle("open");
  }

  function confirmReject(index) {
    const select = document.querySelector(`[data-reason-select="${index}"]`);
    const reason = select ? select.value : "other";
    persistFeedback(index, "reject", reason);
    const row = document.querySelector(`[data-reject-row="${index}"]`);
    if (row) row.classList.remove("open");
  }

  function toggleDetails(index, button) {
    const details = document.getElementById(`${safeId(index)}-details`);
    const isOpen = details.classList.toggle("open");
    button.textContent = isOpen ? "收起详情" : "查看详情";
    button.setAttribute("aria-expanded", String(isOpen));
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    if (action === "remove-watchlist") {
      removeWatchlistItem(button.dataset.watchKey);
      return;
    }

    const index = Number(button.dataset.index);
    if (!Number.isFinite(index)) return;

    if (action === "interested") persistFeedback(index, "interested");
    if (action === "watchlist") persistFeedback(index, "add_to_watchlist");
    if (action === "reject") showRejectReasons(index);
    if (action === "confirm-reject") confirmReject(index);
    if (action === "details") toggleDetails(index, button);
  });

  document.getElementById("todayDate").textContent = `日期：${new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(new Date())}`;

  window.reloadRecommendations = function reloadRecommendations() {
    return window.MockApi.getRecommendations()
      .then(result => {
        recommendations = result.recommendations;
        window.recommendationDiagnostics = result.diagnostics;
        renderRecommendations();
        renderWatchlist();
      })
      .catch(error => {
        console.error(error);
        renderError(error);
      });
  };

  window.reloadRecommendations();
})();
