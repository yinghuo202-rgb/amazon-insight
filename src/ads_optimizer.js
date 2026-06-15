(function () {
  const ADS_DATA_PATH = "./data/ads_optimizer_mock.json";
  const ADS_STATE_KEY = "amazon_growth_console_ads_state_v1";

  const typeLabels = {
    search_term_harvest: "搜索词收割",
    negative_keyword: "否词建议",
    bid_adjustment: "竞价调整",
    product_targeting: "商品投放",
    structure_diagnosis: "结构诊断"
  };

  const actionLabels = {
    add_keyword_exact: "添加精准关键词",
    add_negative_exact: "添加精准否词",
    decrease_keyword_bid: "降低关键词竞价",
    increase_keyword_bid: "提高关键词竞价",
    add_product_target: "添加商品投放",
    increase_product_target_bid: "提高商品投放竞价",
    decrease_product_target_bid: "降低商品投放竞价",
    structure_diagnosis: "结构诊断",
    apply_dayparting_bid_adjustment: "应用分时竞价"
  };

  const statusLabels = {
    pending_review: "待审核",
    approved: "已批准",
    ignored: "已忽略",
    modified: "已修改",
    queued_for_execution: "待执行",
    executed: "已执行",
    rolled_back: "已回滚",
    failed: "失败",
    observing: "观察中",
    effective: "有效",
    ineffective: "无效"
  };

  const riskLabels = {
    low: "低风险",
    medium: "中风险",
    high: "高风险"
  };

  let adsData = null;
  let adsArtifacts = null;
  let adsApiStatus = null;
  let adsSyncMessage = "";
  let adsState = readState();

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ADS_STATE_KEY) || "{}");
      return {
        recommendation_status: parsed.recommendation_status || {},
        local_adjustments: parsed.local_adjustments || [],
        protected_terms: parsed.protected_terms || [],
        blocked_terms: parsed.blocked_terms || [],
        modified_values: parsed.modified_values || {},
        recommendation_filters: {
          search: parsed.recommendation_filters && parsed.recommendation_filters.search || "",
          type: parsed.recommendation_filters && parsed.recommendation_filters.type || "all",
          risk: parsed.recommendation_filters && parsed.recommendation_filters.risk || "all",
          status: parsed.recommendation_filters && parsed.recommendation_filters.status || "all"
        }
      };
    } catch (error) {
      console.warn("Ads state could not be parsed.", error);
      return {
        recommendation_status: {},
        local_adjustments: [],
        protected_terms: [],
        blocked_terms: [],
        modified_values: {},
        recommendation_filters: { search: "", type: "all", risk: "all", status: "all" }
      };
    }
  }

  function writeState() {
    localStorage.setItem(ADS_STATE_KEY, JSON.stringify(adsState));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function hasEnglishWords(value) {
    return /[A-Za-z]{3,}/.test(String(value || ""));
  }

  function displayAdEntity(value, type = "") {
    const text = String(value || "");
    if (!hasEnglishWords(text)) return text || "广告对象";
    if (type === "search_term_harvest") return "可收割搜索词";
    if (type === "negative_keyword") return "待否定搜索词";
    if (type === "bid_adjustment") return "待调价关键词";
    if (type === "product_targeting") return "待投放竞品";
    return "广告结构项";
  }

  function displayCampaign(value) {
    return hasEnglishWords(value) ? "广告活动" : value || "广告活动";
  }

  function displayAdCopy(rec, field) {
    const value = rec[field] || "";
    if (!hasEnglishWords(value)) return value;
    const type = rec.recommendation_type;
    if (field === "current_problem") {
      if (type === "search_term_harvest") return "该搜索词已有转化，但尚未作为独立精准词管理。";
      if (type === "negative_keyword") return "该搜索词消耗较高但没有产生订单，建议降低无效流量。";
      if (type === "bid_adjustment") return "该关键词仍有转化，但广告成本占比高于目标。";
      if (type === "product_targeting") return "该竞品或相邻商品具备投放测试价值。";
      return "当前广告结构存在可优化项。";
    }
    if (field === "reason") return "本地报表聚合结果触发了对应规则，需要结合订单、花费、转化率和目标广告成本占比复核。";
    if (field === "expected_impact") return "将预算集中到更可控的投放对象，并减少无效点击和预算分散。";
    if (field === "deepseek_summary") return "模型摘要认为该建议具备执行价值，但应先按风险等级审批。";
    return value;
  }

  function formatMoney(value) {
    if (value === null || value === undefined || value === "") return "-";
    return `$${Number(value).toFixed(2)}`;
  }

  function formatPct(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
    return `${Math.round(Number(value) * 100)}%`;
  }

  function effectiveRecommendation(item) {
    return {
      ...item,
      status: adsState.recommendation_status[item.recommendation_id] || item.status
    };
  }

  function statusClass(status) {
    if (status === "approved" || status === "executed" || status === "effective") return "fit-high";
    if (status === "ignored" || status === "failed" || status === "ineffective") return "fit-low";
    return "fit-medium";
  }

  function riskClass(risk) {
    if (risk === "low") return "fit-high";
    if (risk === "high") return "fit-low";
    return "fit-medium";
  }

  function metricGrid(metrics) {
    const entries = [
      ["花费", formatMoney(metrics.spend)],
      ["销售额", formatMoney(metrics.sales)],
      ["订单数", metrics.orders],
      ["广告成本占比", formatPct(metrics.acos)],
      ["广告回报率", metrics.roas ? Number(metrics.roas).toFixed(2) : "-"],
      ["单次点击成本", formatMoney(metrics.cpc)],
      ["点击率", formatPct(metrics.ctr)],
      ["转化率", formatPct(metrics.cvr)]
    ];
    return `
      <div class="ads-metric-grid">
        ${entries.map(([label, value]) => `
          <div class="ads-mini-stat">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
        `).join("")}
      </div>
    `;
  }

  function actionPreview(rec, overrideValue) {
    const value = overrideValue ?? adsState.modified_values[rec.recommendation_id] ?? rec.suggested_value ?? rec.suggested_action;
    return [
      "执行方式：本地模拟",
      `建议动作：${actionLabels[rec.suggested_action] || rec.suggested_action}`,
      `广告对象：${displayAdEntity(rec.entity_name, rec.recommendation_type)}`,
      `广告活动：${displayCampaign(rec.campaign)}`,
      `最终值：${value}`,
      `风险等级：${riskLabels[rec.risk_level] || rec.risk_level}`,
      `审批要求：${rec.requires_approval ? "需要审批" : "低风险可自动"}`
    ].join("\n");
  }

  function recommendationMatchesFilters(item) {
    const rec = effectiveRecommendation(item);
    const filters = adsState.recommendation_filters || {};
    const search = String(filters.search || "").trim().toLowerCase();
    const haystack = [
      rec.recommendation_id,
      rec.entity_name,
      rec.campaign,
      rec.current_problem,
      rec.reason,
      rec.expected_impact,
      rec.suggested_action
    ].join(" ").toLowerCase();
    return (
      (!search || haystack.includes(search)) &&
      (!filters.type || filters.type === "all" || rec.recommendation_type === filters.type) &&
      (!filters.risk || filters.risk === "all" || rec.risk_level === filters.risk) &&
      (!filters.status || filters.status === "all" || rec.status === filters.status)
    );
  }

  function filteredRecommendations() {
    return (adsData.recommendations || []).filter(recommendationMatchesFilters);
  }

  function recommendationCard(item) {
    const rec = effectiveRecommendation(item);
    const currentModifyValue = adsState.modified_values[rec.recommendation_id] ?? rec.suggested_value ?? rec.suggested_action;
    return `
      <article class="ads-card" data-ads-rec="${escapeHtml(rec.recommendation_id)}">
        <div class="ads-card-head">
          <div>
            <span class="rank">${escapeHtml(typeLabels[rec.recommendation_type] || rec.recommendation_type)} · ${escapeHtml(rec.recommendation_id)}</span>
            <h3>${escapeHtml(displayAdEntity(rec.entity_name, rec.recommendation_type))}</h3>
            <p>${escapeHtml(displayCampaign(rec.campaign))}</p>
          </div>
          <div class="ads-card-badges">
            <span class="badge ${riskClass(rec.risk_level)}">${escapeHtml(riskLabels[rec.risk_level] || rec.risk_level)}</span>
            <span class="badge ${statusClass(rec.status)}">${escapeHtml(statusLabels[rec.status] || rec.status)}</span>
          </div>
        </div>
        <div class="badge-row">
          <span class="badge source">${escapeHtml(actionLabels[rec.suggested_action] || rec.suggested_action)}</span>
          <span class="badge action">${escapeHtml(rec.data_window)}</span>
          <span class="badge action">${rec.requires_approval ? "需要审批" : "低风险可自动"}</span>
        </div>
        <p class="conclusion">${escapeHtml(displayAdCopy(rec, "current_problem"))}</p>
        <div class="copy-grid">
          <div class="copy-block">
            <h3>建议原因</h3>
            <p>${escapeHtml(displayAdCopy(rec, "reason"))}</p>
          </div>
          <div class="copy-block">
            <h3>预期影响</h3>
            <p>${escapeHtml(displayAdCopy(rec, "expected_impact"))}</p>
          </div>
        </div>
        ${metricGrid(rec.metrics)}
        <div class="ads-evidence" id="evidence-${escapeHtml(rec.recommendation_id)}">
          <strong>模型摘要</strong>
          <p>${escapeHtml(displayAdCopy(rec, "deepseek_summary"))}</p>
          <span>依据文件已记录在本地。</span>
          <pre>${escapeHtml(actionPreview(rec))}</pre>
        </div>
        <div class="ads-modify-panel" id="modify-${escapeHtml(rec.recommendation_id)}">
          <input class="text-input" type="text" data-modify-value="${escapeHtml(rec.recommendation_id)}" value="${escapeHtml(currentModifyValue)}" aria-label="修改后的最终值">
          <input class="text-input" type="text" data-modify-note="${escapeHtml(rec.recommendation_id)}" placeholder="修改说明，例如：先降到 0.84 观察 7 天" aria-label="修改说明">
          <button class="btn primary" type="button" data-ads-action="approve-modified" data-ads-id="${escapeHtml(rec.recommendation_id)}">确认修改并批准</button>
        </div>
        <div class="actions">
          <button class="btn primary" type="button" data-ads-action="approve" data-ads-id="${escapeHtml(rec.recommendation_id)}">批准</button>
          <button class="btn" type="button" data-ads-action="modify" data-ads-id="${escapeHtml(rec.recommendation_id)}">修改后批准</button>
          <button class="btn" type="button" data-ads-action="evidence" data-ads-id="${escapeHtml(rec.recommendation_id)}">查看依据</button>
          <button class="btn" type="button" data-ads-action="protect" data-ads-id="${escapeHtml(rec.recommendation_id)}">保护名单</button>
          <button class="btn danger" type="button" data-ads-action="ignore" data-ads-id="${escapeHtml(rec.recommendation_id)}">忽略</button>
          <span class="status" data-ads-status="${escapeHtml(rec.recommendation_id)}">${escapeHtml(statusLabels[rec.status] || rec.status)}</span>
        </div>
      </article>
    `;
  }

  function renderDashboard() {
    const root = document.getElementById("adsDashboard");
    if (!root || !adsData) return;
    const pending = adsData.recommendations
      .map(effectiveRecommendation)
      .filter(item => item.status === "pending_review").length;
    const high = adsData.recommendations.filter(item => item.priority === "high").length;
    root.innerHTML = `
      <section class="summary-card">
        <h2 class="section-title" style="margin: 0;">广告优化摘要</h2>
        <p>
          本地数据已覆盖广告搜索词收割、否词、竞价调整、商品投放和结构诊断。
        </p>
        <div class="summary-grid">
          <div class="summary-metric"><span class="metric-value">${pending}</span><span class="metric-label">待审批建议</span></div>
          <div class="summary-metric"><span class="metric-value">${high}</span><span class="metric-label">高优先级</span></div>
          <div class="summary-metric"><span class="metric-value">${escapeHtml(adsData.dashboard.data_window)}</span><span class="metric-label">默认窗口</span></div>
          <div class="summary-metric"><span class="metric-value">${formatPct(adsData.dashboard.target_acos)}</span><span class="metric-label">目标广告成本占比</span></div>
          <div class="summary-metric"><span class="metric-value">${formatPct(adsData.dashboard.max_acos)}</span><span class="metric-label">最大广告成本占比</span></div>
          <div class="summary-metric"><span class="metric-value">${adsData.dashboard.recent_executed_actions}</span><span class="metric-label">近期执行</span></div>
        </div>
      </section>
    `;
  }

  function renderOperationSummary() {
    const root = document.getElementById("adsOperationSummary");
    if (!root || !adsData) return;
    const effective = adsData.recommendations.map(effectiveRecommendation);
    const queued = mergedAdjustmentLogs().filter(item => item.execution_status === "queued_for_execution").length;
    const executed = mergedAdjustmentLogs().filter(item => item.execution_status === "executed").length;
    const ignored = effective.filter(item => item.status === "ignored").length;
    const protectedCount = adsState.protected_terms.length;
    root.innerHTML = `
      <div class="summary-grid">
        <div class="summary-metric"><span class="metric-value">${filteredRecommendations().length}</span><span class="metric-label">当前筛选建议</span></div>
        <div class="summary-metric"><span class="metric-value">${queued}</span><span class="metric-label">待执行动作</span></div>
        <div class="summary-metric"><span class="metric-value">${executed}</span><span class="metric-label">已模拟执行</span></div>
        <div class="summary-metric"><span class="metric-value">${ignored}</span><span class="metric-label">已忽略</span></div>
        <div class="summary-metric"><span class="metric-value">${protectedCount}</span><span class="metric-label">保护词</span></div>
      </div>
      <div class="badge-row" style="margin-top: 10px;">
        ${adsState.protected_terms.length
          ? adsState.protected_terms.map(term => `
            <span class="badge action ads-protected-term">
              ${escapeHtml(term)}
              <button type="button" data-ads-action="unprotect" data-protected-term="${escapeHtml(term)}" aria-label="移除保护词 ${escapeHtml(term)}">×</button>
            </span>
          `).join("")
          : `<span class="badge action">暂无保护词</span>`}
      </div>
    `;
  }

  function renderRecommendations() {
    const root = document.getElementById("adsRecommendationGroups");
    if (!root || !adsData) return;
    const visible = filteredRecommendations();
    const groups = visible.reduce((map, item) => {
      const key = item.recommendation_type;
      map[key] = map[key] || [];
      map[key].push(item);
      return map;
    }, {});

    root.innerHTML = visible.length ? Object.entries(groups).map(([type, items]) => `
      <section class="ads-group">
        <div class="section-title">
          <h2>${escapeHtml(typeLabels[type] || type)}</h2>
          <span class="feed-count">${items.length} 条建议</span>
        </div>
        <div class="feed">
          ${items.map(recommendationCard).join("")}
        </div>
      </section>
    `).join("") : `<article class="ads-card"><h3>没有符合筛选条件的广告建议</h3><p>调整关键词、类型、风险或状态筛选后重试。</p></article>`;
  }

  function renderDayparting() {
    const root = document.getElementById("daypartingContent");
    if (!root || !adsData) return;
    root.innerHTML = adsData.dayparting.map(strategy => `
      <article class="ads-card">
        <div class="ads-card-head">
          <div>
            <span class="rank">${escapeHtml(strategy.strategy_id)} · ${escapeHtml(strategy.data_window)} · ${escapeHtml(strategy.timezone)}</span>
            <h3>${escapeHtml(strategy.campaign)}</h3>
            <p>${escapeHtml(strategy.summary)}</p>
          </div>
          <span class="badge ${strategy.should_enable_dayparting ? "fit-high" : "fit-medium"}">
            ${strategy.should_enable_dayparting ? "建议启用" : "暂不启用"}
          </span>
        </div>
        <div class="ads-table-wrap">
          <table class="ads-table">
            <thead>
              <tr>
                <th>时段</th>
                <th>花费</th>
                <th>销售额</th>
                <th>订单数</th>
                <th>广告成本占比</th>
                <th>动作</th>
                <th>风控</th>
              </tr>
            </thead>
            <tbody>
              ${strategy.time_blocks.map(block => `
                <tr>
                  <td>${escapeHtml(block.block)}</td>
                  <td>${formatMoney(block.spend)}</td>
                  <td>${formatMoney(block.sales)}</td>
                  <td>${escapeHtml(block.orders)}</td>
                  <td>${formatPct(block.acos)}</td>
                  <td>${escapeHtml(block.action)} · ${Number(block.bid_multiplier).toFixed(2)}x</td>
                  <td>${escapeHtml(block.risk_control_note)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        <div class="actions">
          <button class="btn primary" type="button" data-ads-action="approve-dayparting" data-ads-id="${escapeHtml(strategy.strategy_id)}">批准分时策略</button>
          <button class="btn" type="button" data-ads-action="ignore-dayparting" data-ads-id="${escapeHtml(strategy.strategy_id)}">暂不应用</button>
          <span class="status" data-ads-status="${escapeHtml(strategy.strategy_id)}">${escapeHtml(statusLabels[strategy.status] || strategy.status)}</span>
        </div>
      </article>
    `).join("");
  }

  function renderProducts() {
    const root = document.getElementById("adsProductsContent");
    if (!root || !adsData) return;
    root.innerHTML = `
      <div class="ads-table-wrap">
        <table class="ads-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>产品</th>
              <th>价格</th>
              <th>单位成本</th>
              <th>盈亏平衡广告成本占比</th>
              <th>目标和最大广告成本占比</th>
              <th>策略</th>
            </tr>
          </thead>
          <tbody>
            ${adsData.products.map(product => `
              <tr>
                <td>${escapeHtml(product.sku)}</td>
                <td><strong>${escapeHtml(product.title)}</strong><br><span>${escapeHtml(product.asin)}</span></td>
                <td>${formatMoney(product.price)}</td>
                <td>${formatMoney(product.unit_cost)}</td>
                <td>${formatPct(product.break_even_acos)}</td>
                <td>${formatPct(product.target_acos)} / ${formatPct(product.max_acos)}</td>
                <td>${escapeHtml(product.strategy)}${product.is_priority_product ? " · 重点品" : ""}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderArtifactTable(title, rows, columns) {
    if (!rows || !rows.length) {
      return `<article class="ads-card"><h3>${escapeHtml(title)}</h3><p>暂无记录。</p></article>`;
    }
    return `
      <article class="ads-card">
        <div class="section-title" style="margin-top: 0;">
          <h2>${escapeHtml(title)}</h2>
          <span class="feed-count">${rows.length} 条记录</span>
        </div>
        <div class="ads-table-wrap">
          <table class="ads-table">
            <thead>
              <tr>${columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  ${columns.map(column => `<td>${escapeHtml(row[column.key] ?? "-")}</td>`).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderReports() {
    const root = document.getElementById("adsReportsContent");
    if (!root) return;
    if (!adsArtifacts) {
      root.innerHTML = `<article class="ads-card"><h3>报表索引加载中</h3></article>`;
      return;
    }
    root.innerHTML = `
      <div class="summary-grid">
        <div class="summary-metric"><span class="metric-value">${adsArtifacts.syncLogs.length}</span><span class="metric-label">同步日志</span></div>
        <div class="summary-metric"><span class="metric-value">${adsArtifacts.rawArchives.length}</span><span class="metric-label">原始报表</span></div>
        <div class="summary-metric"><span class="metric-value">${adsArtifacts.cleanedArchives.length}</span><span class="metric-label">清洗报表</span></div>
        <div class="summary-metric"><span class="metric-value">${adsArtifacts.llmLogs.length}</span><span class="metric-label">模型分析</span></div>
      </div>
      <div class="feed" style="margin-top: 14px;">
        ${renderArtifactTable("同步日志", adsArtifacts.syncLogs, [
          { key: "sync_id", label: "同步编号" },
          { key: "report_type", label: "报表类型" },
          { key: "status", label: "状态" },
          { key: "row_count", label: "行数" },
          { key: "cleaned_report_path", label: "清洗路径" }
        ])}
        ${renderArtifactTable("原始报表存档", adsArtifacts.rawArchives, [
          { key: "report_type", label: "报表类型" },
          { key: "start_date", label: "开始日期" },
          { key: "end_date", label: "结束日期" },
          { key: "row_count", label: "行数" },
          { key: "file_path", label: "文件路径" }
        ])}
        ${renderArtifactTable("清洗报表存档", adsArtifacts.cleanedArchives, [
          { key: "report_type", label: "报表类型" },
          { key: "cleaning_status", label: "状态" },
          { key: "row_count", label: "行数" },
          { key: "file_path", label: "文件路径" }
        ])}
        ${renderArtifactTable("模型分析日志", adsArtifacts.llmLogs, [
          { key: "analysis_type", label: "分析类型" },
          { key: "model", label: "模型" },
          { key: "validation_status", label: "校验状态" },
          { key: "input_summary_path", label: "输入路径" },
          { key: "parsed_json_path", label: "输出路径" }
        ])}
      </div>
    `;
  }

  function mergedAdjustmentLogs() {
    return [...(adsData.adjustment_logs || []), ...adsState.local_adjustments]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  function renderAdjustments() {
    const root = document.getElementById("adjustmentLogContent");
    if (!root || !adsData) return;
    const riskFilter = document.getElementById("adjustmentRiskFilter");
    const statusFilter = document.getElementById("adjustmentStatusFilter");
    const risk = riskFilter ? riskFilter.value : "all";
    const status = statusFilter ? statusFilter.value : "all";
    const rows = mergedAdjustmentLogs().filter(item => (
      (risk === "all" || item.risk_level === risk) &&
      (status === "all" || item.execution_status === status)
    ));

    root.innerHTML = `
      <div class="ads-table-wrap">
        <table class="ads-table">
          <thead>
            <tr>
              <th>调整时间</th>
              <th>动作</th>
              <th>对象</th>
              <th>调整前</th>
              <th>调整后</th>
              <th>风险</th>
              <th>审批</th>
              <th>执行</th>
              <th>复盘</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(item => `
              <tr>
                <td>${escapeHtml(item.executed_at || item.created_at)}</td>
                <td>${escapeHtml(actionLabels[item.action_type] || item.action_type)}</td>
                <td><strong>${escapeHtml(item.entity_name)}</strong><br><span>${escapeHtml(item.entity_type)}</span></td>
                <td>${escapeHtml(item.before_value ?? "-")}</td>
                <td>${escapeHtml(item.final_value ?? item.suggested_value ?? "-")}</td>
                <td>${escapeHtml(riskLabels[item.risk_level] || item.risk_level)}</td>
                <td>${escapeHtml(item.approval_status)}</td>
                <td>${escapeHtml(statusLabels[item.execution_status] || item.execution_status)}</td>
                <td>${escapeHtml(statusLabels[item.review_status] || item.review_status || "reviewing_result")}</td>
                <td>
                  ${item.execution_status === "queued_for_execution" ? `<button class="btn small primary" type="button" data-ads-action="execute-adjustment" data-adjustment-id="${escapeHtml(item.adjustment_id)}">执行</button>` : ""}
                  ${item.execution_status === "executed" && item.rollback_available ? `<button class="btn small danger" type="button" data-ads-action="rollback-adjustment" data-adjustment-id="${escapeHtml(item.adjustment_id)}">回滚</button>` : ""}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderReviews() {
    const root = document.getElementById("reviewContent");
    if (!root || !adsData) return;
    root.innerHTML = `
      <div class="feed">
        ${adsData.reviews.map(review => `
          <article class="ads-card">
            <div class="ads-card-head">
              <div>
                <span class="rank">${escapeHtml(review.action_id)} · ${escapeHtml(review.before_window)} vs ${escapeHtml(review.after_window)}</span>
                <h3>${escapeHtml(review.entity_name)}</h3>
                <p>${escapeHtml(review.summary)}</p>
              </div>
              <span class="badge ${statusClass(review.result_status)}">${escapeHtml(statusLabels[review.result_status] || review.result_status)}</span>
            </div>
            <div class="ads-metric-grid">
              <div class="ads-mini-stat"><span>调整前花费</span><strong>${formatMoney(review.before_spend)}</strong></div>
              <div class="ads-mini-stat"><span>调整后花费</span><strong>${formatMoney(review.after_spend)}</strong></div>
              <div class="ads-mini-stat"><span>调整前广告成本占比</span><strong>${formatPct(review.before_acos)}</strong></div>
              <div class="ads-mini-stat"><span>调整后广告成本占比</span><strong>${formatPct(review.after_acos)}</strong></div>
              <div class="ads-mini-stat"><span>调整前订单</span><strong>${escapeHtml(review.before_orders)}</strong></div>
              <div class="ads-mini-stat"><span>调整后订单</span><strong>${escapeHtml(review.after_orders)}</strong></div>
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderSettings() {
    const root = document.getElementById("adsSettingsContent");
    if (!root || !adsData) return;
    const settings = adsData.settings;
    const apiStatus = adsApiStatus || {
      ready: false,
      enabled: false,
      requestMode: "unknown",
      warnings: ["亚马逊广告状态未加载。"]
    };
    const items = [
      ["亚马逊广告凭证", settings.amazon_ads_credentials_status],
      ["亚马逊广告接口状态", apiStatus.ready ? "已就绪" : "未就绪"],
      ["亚马逊广告请求模式", apiStatus.requestMode || "待确认"],
      ["亚马逊广告账户配置", apiStatus.profileIdPresent ? apiStatus.profileIdMasked : "未配置"],
      ["亚马逊广告写回动作", apiStatus.writeActionsEnabled ? "已启用" : "模拟执行"],
      ["模型服务密钥", settings.deepseek_api_key_status],
      ["本地数据库", settings.database_path],
      ["原始报表", settings.raw_report_archive_path],
      ["清洗报表", settings.cleaned_report_archive_path],
      ["同步频率", settings.sync_frequency],
      ["保存模型请求", settings.save_deepseek_request_log ? "是" : "否"],
      ["保存完整响应", settings.save_deepseek_full_response ? "是" : "否"],
      ["低风险自动执行", settings.allow_low_risk_auto_execute ? "已启用" : "未启用"],
      ["默认目标广告成本占比", formatPct(settings.default_target_acos)],
      ["默认最大广告成本占比", formatPct(settings.default_max_acos)]
    ];
    root.innerHTML = `
      <div class="pref-grid">
        ${items.map(([label, value]) => `<div class="pref-item">${escapeHtml(label)}<br><span>${escapeHtml(value)}</span></div>`).join("")}
      </div>
      <div class="ads-card" style="margin-top: 14px;">
        <div class="ads-card-head">
          <div>
            <span class="rank">亚马逊广告接口</span>
            <h3>本地接口接入状态</h3>
            <p>${apiStatus.ready ? "凭证已就绪，可手动同步账户配置或报表。" : "尚未准备好。请在本地配置文件中配置凭证与接口模式。"}</p>
          </div>
          <span class="badge ${apiStatus.ready ? "fit-high" : "fit-medium"}">${apiStatus.ready ? "已就绪" : "未就绪"}</span>
        </div>
        <div class="copy-grid">
          <div class="copy-block">
            <h3>当前警告</h3>
            <p>${escapeHtml((apiStatus.warnings && apiStatus.warnings.length ? apiStatus.warnings : ["暂无警告"]).join("；"))}</p>
          </div>
          <div class="copy-block">
            <h3>最近同步</h3>
            <p>${escapeHtml(adsSyncMessage || (adsArtifacts && adsArtifacts.amazonAdsSync && adsArtifacts.amazonAdsSync.generated_at ? `${adsArtifacts.amazonAdsSync.generated_at} · 外部请求 ${adsArtifacts.amazonAdsSync.external_requests_made || 0} 次` : "尚未同步"))}</p>
          </div>
        </div>
        <div class="actions">
          <button class="btn primary" type="button" id="syncAmazonAdsProfiles" ${apiStatus.ready ? "" : "disabled"}>同步广告账户配置</button>
        </div>
      </div>
      <p class="empty">敏感配置应写入本地 .env.local 或 config/secrets.local.json，本原型不保存真实密钥；广告写回动作默认保持 dry-run。</p>
    `;
  }

  function makeAdjustmentFromRecommendation(rec, status, options = {}) {
    const now = new Date().toISOString();
    const finalValue = options.finalValue ?? rec.suggested_value ?? rec.suggested_action;
    return {
      adjustment_id: `LOCAL-${rec.recommendation_id}`,
      action_id: `LOCAL-ACT-${rec.recommendation_id}`,
      action_type: rec.suggested_action,
      entity_type: rec.entity_type,
      entity_id: rec.recommendation_id,
      entity_name: rec.entity_name,
      before_value: rec.current_value ?? "not_set",
      suggested_value: rec.suggested_value ?? rec.suggested_action,
      final_value: finalValue,
      reason: options.note ? `${rec.reason} | 本地修改说明：${options.note}` : rec.reason,
      operator_note: options.note || "",
      risk_level: rec.risk_level,
      approval_status: status === "approved" && !rec.requires_approval ? "auto_approved_low_risk" : status,
      execution_status: "queued_for_execution",
      executed_at: "",
      rollback_available: false,
      review_status: "reviewing_result",
      created_at: now
    };
  }

  function upsertLocalAdjustment(rec, status, options = {}) {
    const adjustment = makeAdjustmentFromRecommendation(rec, status, options);
    adsState.local_adjustments = adsState.local_adjustments.filter(item => item.adjustment_id !== adjustment.adjustment_id);
    adsState.local_adjustments.unshift(adjustment);
  }

  function mutateAdjustment(adjustmentId, mutation) {
    adsState.local_adjustments = adsState.local_adjustments.map(item => (
      item.adjustment_id === adjustmentId ? { ...item, ...mutation(item) } : item
    ));
    writeState();
    renderAll();
  }

  function executeAdjustment(adjustmentId) {
    mutateAdjustment(adjustmentId, () => ({
      execution_status: "executed",
      executed_at: new Date().toISOString(),
      rollback_available: true,
      review_status: "observing"
    }));
  }

  function rollbackAdjustment(adjustmentId) {
    mutateAdjustment(adjustmentId, () => ({
      execution_status: "rolled_back",
      rollback_available: false,
      review_status: "ineffective"
    }));
  }

  function executeQueuedAdjustments() {
    const now = new Date().toISOString();
    adsState.local_adjustments = adsState.local_adjustments.map(item => (
      item.execution_status === "queued_for_execution"
        ? { ...item, execution_status: "executed", executed_at: now, rollback_available: true, review_status: "observing" }
        : item
    ));
    writeState();
    renderAll();
  }

  function updateRecommendationStatus(id, status, options = {}) {
    const rec = adsData.recommendations.find(item => item.recommendation_id === id);
    if (!rec) return;
    adsState.recommendation_status[id] = status;
    if (status === "approved" || status === "modified") {
      upsertLocalAdjustment(rec, status, options);
    }
    writeState();
    renderAll();
    const target = document.querySelector(`[data-ads-status="${CSS.escape(id)}"]`);
    if (target) target.textContent = statusLabels[status] || status;
  }

  function handleAdsAction(button) {
    const action = button.dataset.adsAction;
    const id = button.dataset.adsId;
    const adjustmentId = button.dataset.adjustmentId;
    const rec = adsData && adsData.recommendations.find(item => item.recommendation_id === id);

    if (action === "execute-adjustment" && adjustmentId) executeAdjustment(adjustmentId);
    if (action === "rollback-adjustment" && adjustmentId) rollbackAdjustment(adjustmentId);
    if (action === "approve") updateRecommendationStatus(id, "approved");
    if (action === "modify") {
      const panel = document.getElementById(`modify-${id}`);
      if (panel) panel.classList.toggle("open");
    }
    if (action === "approve-modified" && rec) {
      const valueInput = document.querySelector(`[data-modify-value="${CSS.escape(id)}"]`);
      const noteInput = document.querySelector(`[data-modify-note="${CSS.escape(id)}"]`);
      const finalValue = valueInput ? valueInput.value.trim() : "";
      const note = noteInput ? noteInput.value.trim() : "";
      adsState.modified_values[id] = finalValue || rec.suggested_value || rec.suggested_action;
      updateRecommendationStatus(id, "modified", {
        finalValue: adsState.modified_values[id],
        note
      });
    }
    if (action === "ignore") updateRecommendationStatus(id, "ignored");
    if (action === "protect" && rec) {
      adsState.protected_terms = Array.from(new Set([...adsState.protected_terms, rec.entity_name]));
      writeState();
      updateRecommendationStatus(id, "ignored");
    }
    if (action === "unprotect") {
      const term = button.dataset.protectedTerm;
      adsState.protected_terms = adsState.protected_terms.filter(item => item !== term);
      writeState();
      renderAll();
    }
    if (action === "evidence") {
      const evidence = document.getElementById(`evidence-${id}`);
      if (evidence) evidence.classList.toggle("open");
    }
    if (action === "approve-dayparting") {
      const strategy = adsData.dayparting.find(item => item.strategy_id === id);
      if (!strategy) return;
      adsState.local_adjustments = adsState.local_adjustments.filter(item => item.adjustment_id !== `LOCAL-${id}`);
      adsState.local_adjustments.unshift({
        adjustment_id: `LOCAL-${id}`,
        action_id: `LOCAL-ACT-${id}`,
        action_type: "apply_dayparting_bid_adjustment",
        entity_type: "campaign",
        entity_id: id,
        entity_name: strategy.campaign,
        before_value: "no_dayparting",
        suggested_value: "time_block_bid_multipliers",
        final_value: "queued",
        reason: strategy.summary,
        risk_level: "medium",
        approval_status: "approved",
        execution_status: "queued_for_execution",
        executed_at: "",
        rollback_available: false,
        review_status: "reviewing_result",
        created_at: new Date().toISOString()
      });
      writeState();
      renderAdjustments();
      const target = document.querySelector(`[data-ads-status="${CSS.escape(id)}"]`);
      if (target) target.textContent = "已批准";
    }
    if (action === "ignore-dayparting") {
      const target = document.querySelector(`[data-ads-status="${CSS.escape(id)}"]`);
      if (target) target.textContent = "暂不应用";
    }
  }

  function bulkApproveLowRisk() {
    adsData.recommendations
      .filter(item => item.risk_level === "low" && !item.requires_approval)
      .forEach(item => {
        adsState.recommendation_status[item.recommendation_id] = "approved";
        upsertLocalAdjustment(item, "approved");
      });
    writeState();
    renderAll();
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  function exportVisibleRecommendations() {
    const payload = {
      exported_at: new Date().toISOString(),
      source: "local_ads_optimizer_frontend",
      filters: adsState.recommendation_filters,
      recommendations: filteredRecommendations().map(effectiveRecommendation)
    };
    downloadJson(payload, `ads_recommendations_${new Date().toISOString().slice(0, 10)}.json`);
  }

  function exportAdjustmentLogs() {
    const payload = {
      exported_at: new Date().toISOString(),
      source: "local_ads_optimizer_frontend",
      adjustments: mergedAdjustmentLogs()
    };
    downloadJson(payload, `ads_adjustment_logs_${new Date().toISOString().slice(0, 10)}.json`);
  }

  function resetAdsLocalState() {
    localStorage.removeItem(ADS_STATE_KEY);
    adsState = readState();
    renderAll();
  }

  async function syncAmazonAdsProfiles() {
    if (!window.AdsDataProvider || !window.AdsDataProvider.syncAmazonAdsProfiles) return;
    adsSyncMessage = "正在同步广告账户配置...";
    renderSettings();
    try {
      const result = await window.AdsDataProvider.syncAmazonAdsProfiles({ live: true });
      adsSyncMessage = `同步完成：${result.report && result.report.profiles ? result.report.profiles.length : 0} 个 profile，外部请求 ${result.report && result.report.external_requests_made || 0} 次。`;
      if (window.AdsDataProvider.loadAdsArtifacts) {
        adsArtifacts = await window.AdsDataProvider.loadAdsArtifacts();
      }
    } catch (error) {
      adsSyncMessage = `同步失败：${error.message}`;
    }
    renderSettings();
  }

  function syncFilterControls() {
    const filters = adsState.recommendation_filters || { search: "", type: "all", risk: "all", status: "all" };
    const search = document.getElementById("adsSearchInput");
    const type = document.getElementById("adsTypeFilter");
    const risk = document.getElementById("adsRiskFilter");
    const status = document.getElementById("adsStatusFilter");
    if (search) search.value = filters.search || "";
    if (type) type.value = filters.type || "all";
    if (risk) risk.value = filters.risk || "all";
    if (status) status.value = filters.status || "all";
  }

  function renderAll() {
    syncFilterControls();
    renderDashboard();
    renderOperationSummary();
    renderRecommendations();
    renderReports();
    renderDayparting();
    renderProducts();
    renderAdjustments();
    renderReviews();
    renderSettings();
  }

  function initNavigation() {
    document.addEventListener("click", event => {
      const tab = event.target.closest("[data-console-view]");
      if (!tab) return;
      const viewId = tab.dataset.consoleView;
      document.querySelectorAll(".module-tab[data-console-view]").forEach(item => item.classList.toggle("active", item.dataset.consoleView === viewId));
      document.querySelectorAll(".console-view").forEach(view => view.classList.toggle("active", view.id === viewId));
    });
  }

  function initAdsEvents() {
    document.addEventListener("click", event => {
      const button = event.target.closest("[data-ads-action]");
      if (!button || !adsData) return;
      handleAdsAction(button);
    });

    document.addEventListener("change", event => {
      if (event.target.matches("#adjustmentRiskFilter, #adjustmentStatusFilter")) {
        renderAdjustments();
      }
      if (event.target.matches("#adsTypeFilter, #adsRiskFilter, #adsStatusFilter")) {
        adsState.recommendation_filters[event.target.id.replace("ads", "").replace("Filter", "").toLowerCase()] = event.target.value;
        writeState();
        renderOperationSummary();
        renderRecommendations();
      }
    });

    document.addEventListener("input", event => {
      if (event.target.matches("#adsSearchInput")) {
        adsState.recommendation_filters.search = event.target.value;
        writeState();
        renderOperationSummary();
        renderRecommendations();
      }
    });

    const bulkButton = document.getElementById("bulkApproveLowRisk");
    if (bulkButton) bulkButton.addEventListener("click", bulkApproveLowRisk);

    const executeButton = document.getElementById("executeQueuedAdjustments");
    if (executeButton) executeButton.addEventListener("click", executeQueuedAdjustments);

    const exportRecommendationsButton = document.getElementById("exportAdsRecommendations");
    if (exportRecommendationsButton) exportRecommendationsButton.addEventListener("click", exportVisibleRecommendations);

    const exportAdjustmentButton = document.getElementById("exportAdjustmentLogs");
    if (exportAdjustmentButton) exportAdjustmentButton.addEventListener("click", exportAdjustmentLogs);

    const resetStateButton = document.getElementById("resetAdsLocalState");
    if (resetStateButton) resetStateButton.addEventListener("click", resetAdsLocalState);

    document.addEventListener("click", event => {
      if (event.target && event.target.id === "syncAmazonAdsProfiles") {
        void syncAmazonAdsProfiles();
      }
    });

    const resetButton = document.getElementById("resetAdsFilters");
    if (resetButton) {
      resetButton.addEventListener("click", () => {
        adsState.recommendation_filters = { search: "", type: "all", risk: "all", status: "all" };
        writeState();
        syncFilterControls();
        renderOperationSummary();
        renderRecommendations();
      });
    }
  }

  async function loadAdsData() {
    if (window.AdsDataProvider) {
      const providerResult = await window.AdsDataProvider.loadAdsReports();
      adsData = providerResult.mock;
      adsArtifacts = await window.AdsDataProvider.loadAdsArtifacts();
      adsApiStatus = await window.AdsDataProvider.loadAmazonAdsStatus();
    } else {
      const response = await fetch(ADS_DATA_PATH, { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to load ${ADS_DATA_PATH}: ${response.status}`);
      adsData = await response.json();
      adsArtifacts = {
        syncLogs: await tryLoadJson("./data/ads_sync_logs.json"),
        rawArchives: await tryLoadJson("./data/raw_report_archives.json"),
        cleanedArchives: await tryLoadJson("./data/cleaned_report_archives.json"),
        llmLogs: await tryLoadJson("./data/llm_analysis_logs.json")
      };
      adsApiStatus = null;
    }
    renderAll();
  }

  async function tryLoadJson(path) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) return [];
      const payload = await response.json();
      return Array.isArray(payload) ? payload : [];
    } catch {
      return [];
    }
  }

  initNavigation();
  initAdsEvents();
  loadAdsData().catch(error => {
    console.error(error);
    const root = document.getElementById("adsDashboard");
    if (root) {
      root.innerHTML = `<article class="ads-card"><h3>广告模块加载失败</h3><p>${escapeHtml(error.message)}</p></article>`;
    }
  });
})();
