(function () {
  let recommendations = [];

  const feed = document.getElementById("recommendationFeed");
  const watchlistItems = document.getElementById("watchlistItems");
  const watchlistEmpty = document.getElementById("watchlistEmpty");

  const sourceLabels = {
    market_opportunity: "市场机会",
    store_expansion: "店铺扩展",
    seasonal_early_layout: "季节性提前布局",
    jungle_scout_api: "Jungle Scout API",
    jungle_scout_import: "Jungle Scout 导入"
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
          <h2 class="product-title">推荐数据加载失败 / Recommendation data failed to load</h2>
          <p class="category">请确认 data/*.json 和 src/*.js 可通过当前本地静态地址访问。/ Confirm data/*.json and src/*.js are reachable from the current local static URL.</p>
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
      const checklist = (item.validation_checklist || []).map(point => `<li>${escapeHtml(point)}</li>`).join("");
      const sourceText = formatSources(item.recommendation_sources);
      const storeFitText = storeFitLabels[item.store_fit] || item.store_fit;
      const opportunityText = opportunityLabels[item.opportunity_type] || item.opportunity_type;
      const timingText = timingLabels[item.timing_window] || item.timing_window;
      const actionText = actionLabels[item.action_suggestion] || item.action_suggestion;
      const candidateLevelText = item.candidate_level === "product_idea" ? "产品方向 / Product idea" : "具体商品 / ASIN product";
      const latestFeedback = window.Feedback.latestForProduct(item.asin, item.idea_id, `${item.product_type || "unknown"}:${item.title || ""}`);
      const statusText = window.Feedback.statusText(latestFeedback);
      const statusTone = latestFeedback && (latestFeedback.action === "reject" || latestFeedback.action === "rejected") ? "var(--red)" : "var(--green)";
      const amazonLink = amazonUrl(item);

      return `
        <article class="product-card" id="${id}">
          <div class="card-main">
            <div class="card-head">
              <div>
                <span class="rank">排名 / Rank ${index + 1} · Score ${item.total_score}</span>
                <h2 class="product-title">${escapeHtml(item.display_title || item.title)}</h2>
                <p class="category">${escapeHtml(item.category)}</p>
              </div>
              <span class="badge grade ${gradeClass(item.recommendation_grade)}" aria-label="推荐等级 / Recommendation grade ${item.recommendation_grade}">${item.recommendation_grade}</span>
            </div>

            <div class="badge-row">
              <span class="badge source">${escapeHtml(sourceText)}</span>
              <span class="badge action">${escapeHtml(candidateLevelText)}</span>
              <span class="badge ${fitClass(item.store_fit)}">店铺匹配 / Store fit: ${escapeHtml(storeFitText)}</span>
              <span class="badge timing">${escapeHtml(timingText)}</span>
              <span class="badge action">${escapeHtml(actionText)}</span>
            </div>

            <div class="stats-grid">
              <div class="stat">
                <span class="stat-label">代表 ASIN / Representative ASIN</span>
                <span class="stat-value">${escapeHtml(item.asin || item.idea_id || "Product idea")}</span>
              </div>
              <div class="stat">
                <span class="stat-label">参考价格 / Reference price</span>
                <span class="stat-value">${formatPrice(item.reference_price)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">预估月销量 / Estimated monthly sales</span>
                <span class="stat-value">${escapeHtml(formatSales(item.estimated_monthly_sales, item.timing_window, item.estimated_monthly_sales_range, item.sales_confidence))}</span>
              </div>
              <div class="stat">
                <span class="stat-label">机会类型 / Opportunity type</span>
                <span class="stat-value">${escapeHtml(opportunityText)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">季节属性 / Seasonal attribute</span>
                <span class="stat-value">${escapeHtml(item.seasonal_attribute)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">行动建议 / Action suggestion</span>
                <span class="stat-value">${escapeHtml(actionText)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">店铺匹配 / Store fit</span>
                <span class="stat-value">${escapeHtml(storeFitText)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">推荐来源 / Recommendation source</span>
                <span class="stat-value">${escapeHtml(sourceText)}</span>
              </div>
            </div>

            <p class="conclusion">${escapeHtml(item.why_recommended)}</p>

            <div class="copy-grid">
              <div class="copy-block">
                <h3>市场情况 / Market situation</h3>
                <p>${escapeHtml(item.market_situation)}</p>
              </div>
              <div class="copy-block">
                <h3>使用场景 / Use case</h3>
                <p>${escapeHtml(item.use_case)}</p>
              </div>
              <div class="copy-block">
                <h3>推荐原因 / Why recommended</h3>
                <p>${escapeHtml(item.why_recommended)}</p>
              </div>
              <div class="copy-block">
                <h3>主要风险 / Main risks</h3>
                <p>${escapeHtml(item.main_risks)}</p>
              </div>
              <div class="copy-block">
                <h3>下一步 / Next step</h3>
                <p>${escapeHtml(item.next_step)}</p>
              </div>
            </div>

            <div class="actions">
              <button class="btn primary" type="button" data-action="interested" data-index="${index}">感兴趣 / Interested</button>
              <button class="btn" type="button" data-action="watchlist" data-index="${index}">加入观察 / Add to Watchlist</button>
              <button class="btn danger" type="button" data-action="reject" data-index="${index}">拒绝 / Reject</button>
              <button class="btn" type="button" data-action="details" data-index="${index}" aria-expanded="false" aria-controls="${id}-details">查看详情 / View Details</button>
              ${amazonLink ? `<a class="btn amazon" href="${escapeHtml(amazonLink)}" data-action="open-amazon" data-index="${index}" aria-label="打开亚马逊前台页面：${escapeHtml(item.asin)}">打开亚马逊</a>` : `<button class="btn amazon" type="button" disabled>无 ASIN</button>`}
              <span class="status" data-status="${index}" aria-live="polite" style="color: ${statusTone};">${escapeHtml(statusText)}</span>
              <div class="feedback-row" data-reject-row="${index}">
                <select class="reason-select" data-reason-select="${index}" aria-label="Reject reason">
                  ${renderReasonOptions()}
                </select>
                <button class="btn danger" type="button" data-action="confirm-reject" data-index="${index}">确认拒绝 / Confirm Reject</button>
              </div>
            </div>
          </div>

          <div class="details" id="${id}-details">
            <div class="detail-grid">
              <div class="detail-panel">
                <h4>竞争备注 / Competitive notes</h4>
                <p>${escapeHtml(item.competitive_notes)}</p>
              </div>
              <div class="detail-panel">
                <h4>季节性备注 / Seasonality notes</h4>
                <p>${escapeHtml(item.seasonality_notes)}</p>
              </div>
              <div class="detail-panel">
                <h4>店铺扩展逻辑 / Store expansion logic</h4>
                <p>${escapeHtml(item.store_expansion_logic)}</p>
              </div>
              <div class="detail-panel">
                <h4>验证清单 / Validation checklist</h4>
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
          <span>${escapeHtml(record.category)} | ${formatPrice(record.reference_price)} | ${escapeHtml(statusText)}${record.next_check_date ? ` | Re-check: ${escapeHtml(record.next_check_date)}` : ""}</span>
        </div>
        <div class="watchlist-actions">
          <span class="badge action">${escapeHtml(statusText)}</span>
          <button class="btn small danger" type="button" data-action="remove-watchlist" data-watch-key="${escapeHtml(key)}">删除 / Delete</button>
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
    button.textContent = isOpen ? "收起详情 / Hide Details" : "查看详情 / View Details";
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
