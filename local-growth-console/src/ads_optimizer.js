(function () {
  const ADS_DATA_PATH = "./data/ads_optimizer_mock.json";
  const ADS_STATE_KEY = "amazon_growth_console_ads_state_v1";

  const typeLabels = {
    search_term_harvest: "Search Term 收割",
    negative_keyword: "否词建议",
    bid_adjustment: "Bid 调整",
    product_targeting: "商品投放",
    structure_diagnosis: "结构诊断"
  };

  const actionLabels = {
    add_keyword_exact: "添加 Exact 关键词",
    add_negative_exact: "添加 Negative Exact",
    decrease_keyword_bid: "降低关键词 Bid",
    increase_keyword_bid: "提高关键词 Bid",
    add_product_target: "添加商品投放",
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
  let adsState = readState();

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ADS_STATE_KEY) || "{}");
      return {
        recommendation_status: parsed.recommendation_status || {},
        local_adjustments: parsed.local_adjustments || [],
        protected_terms: parsed.protected_terms || [],
        blocked_terms: parsed.blocked_terms || []
      };
    } catch (error) {
      console.warn("Ads state could not be parsed.", error);
      return {
        recommendation_status: {},
        local_adjustments: [],
        protected_terms: [],
        blocked_terms: []
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
      ["Spend", formatMoney(metrics.spend)],
      ["Sales", formatMoney(metrics.sales)],
      ["Orders", metrics.orders],
      ["ACOS", formatPct(metrics.acos)],
      ["ROAS", metrics.roas ? Number(metrics.roas).toFixed(2) : "-"],
      ["CPC", formatMoney(metrics.cpc)],
      ["CTR", formatPct(metrics.ctr)],
      ["CVR", formatPct(metrics.cvr)]
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

  function recommendationCard(item) {
    const rec = effectiveRecommendation(item);
    return `
      <article class="ads-card" data-ads-rec="${escapeHtml(rec.recommendation_id)}">
        <div class="ads-card-head">
          <div>
            <span class="rank">${escapeHtml(typeLabels[rec.recommendation_type] || rec.recommendation_type)} · ${escapeHtml(rec.recommendation_id)}</span>
            <h3>${escapeHtml(rec.entity_name)}</h3>
            <p>${escapeHtml(rec.campaign)}</p>
          </div>
          <div class="ads-card-badges">
            <span class="badge ${riskClass(rec.risk_level)}">${escapeHtml(riskLabels[rec.risk_level] || rec.risk_level)}</span>
            <span class="badge ${statusClass(rec.status)}">${escapeHtml(statusLabels[rec.status] || rec.status)}</span>
          </div>
        </div>
        <div class="badge-row">
          <span class="badge source">${escapeHtml(actionLabels[rec.suggested_action] || rec.suggested_action)}</span>
          <span class="badge action">${escapeHtml(rec.data_window)}</span>
          <span class="badge action">${rec.requires_approval ? "需要审批 / Approval required" : "低风险可自动 / Low-risk eligible"}</span>
        </div>
        <p class="conclusion">${escapeHtml(rec.current_problem)}</p>
        <div class="copy-grid">
          <div class="copy-block">
            <h3>建议原因 / Reason</h3>
            <p>${escapeHtml(rec.reason)}</p>
          </div>
          <div class="copy-block">
            <h3>预期影响 / Expected impact</h3>
            <p>${escapeHtml(rec.expected_impact)}</p>
          </div>
        </div>
        ${metricGrid(rec.metrics)}
        <div class="ads-evidence" id="evidence-${escapeHtml(rec.recommendation_id)}">
          <strong>DeepSeek 摘要 / DeepSeek summary</strong>
          <p>${escapeHtml(rec.deepseek_summary)}</p>
          <span>${escapeHtml(rec.evidence_path)}</span>
        </div>
        <div class="actions">
          <button class="btn primary" type="button" data-ads-action="approve" data-ads-id="${escapeHtml(rec.recommendation_id)}">批准 / Approve</button>
          <button class="btn" type="button" data-ads-action="modify" data-ads-id="${escapeHtml(rec.recommendation_id)}">修改后批准 / Modify</button>
          <button class="btn" type="button" data-ads-action="evidence" data-ads-id="${escapeHtml(rec.recommendation_id)}">查看依据 / Evidence</button>
          <button class="btn" type="button" data-ads-action="protect" data-ads-id="${escapeHtml(rec.recommendation_id)}">保护名单 / Protect</button>
          <button class="btn danger" type="button" data-ads-action="ignore" data-ads-id="${escapeHtml(rec.recommendation_id)}">忽略 / Ignore</button>
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
        <h2 class="section-title" style="margin: 0;">广告优化摘要 / Ads Optimization Summary</h2>
        <p>
          本地 Mock 数据已覆盖 Sponsored Products 的搜索词收割、否词、Bid 调整、商品投放和结构诊断。
          / Local mock data covers Sponsored Products harvesting, negatives, bid changes, product targeting, and structure diagnostics.
        </p>
        <div class="summary-grid">
          <div class="summary-metric"><span class="metric-value">${pending}</span><span class="metric-label">待审批建议 / Pending</span></div>
          <div class="summary-metric"><span class="metric-value">${high}</span><span class="metric-label">高优先级 / High priority</span></div>
          <div class="summary-metric"><span class="metric-value">${escapeHtml(adsData.dashboard.data_window)}</span><span class="metric-label">默认窗口 / Data window</span></div>
          <div class="summary-metric"><span class="metric-value">${formatPct(adsData.dashboard.target_acos)}</span><span class="metric-label">目标 ACOS / Target ACOS</span></div>
          <div class="summary-metric"><span class="metric-value">${formatPct(adsData.dashboard.max_acos)}</span><span class="metric-label">最大 ACOS / Max ACOS</span></div>
          <div class="summary-metric"><span class="metric-value">${adsData.dashboard.recent_executed_actions}</span><span class="metric-label">近期执行 / Executed</span></div>
        </div>
      </section>
    `;
  }

  function renderRecommendations() {
    const root = document.getElementById("adsRecommendationGroups");
    if (!root || !adsData) return;
    const groups = adsData.recommendations.reduce((map, item) => {
      const key = item.recommendation_type;
      map[key] = map[key] || [];
      map[key].push(item);
      return map;
    }, {});

    root.innerHTML = Object.entries(groups).map(([type, items]) => `
      <section class="ads-group">
        <div class="section-title">
          <h2>${escapeHtml(typeLabels[type] || type)}</h2>
          <span class="feed-count">${items.length} 条建议 / recommendations</span>
        </div>
        <div class="feed">
          ${items.map(recommendationCard).join("")}
        </div>
      </section>
    `).join("");
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
            ${strategy.should_enable_dayparting ? "建议启用 / Enable" : "暂不启用 / Hold"}
          </span>
        </div>
        <div class="ads-table-wrap">
          <table class="ads-table">
            <thead>
              <tr>
                <th>时段 / Block</th>
                <th>Spend</th>
                <th>Sales</th>
                <th>Orders</th>
                <th>ACOS</th>
                <th>Action</th>
                <th>风控 / Risk control</th>
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
          <button class="btn primary" type="button" data-ads-action="approve-dayparting" data-ads-id="${escapeHtml(strategy.strategy_id)}">批准分时策略 / Approve Strategy</button>
          <button class="btn" type="button" data-ads-action="ignore-dayparting" data-ads-id="${escapeHtml(strategy.strategy_id)}">暂不应用 / Hold</button>
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
              <th>产品 / Product</th>
              <th>Price</th>
              <th>Unit Cost</th>
              <th>Break-even ACOS</th>
              <th>Target / Max ACOS</th>
              <th>策略 / Strategy</th>
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
      return `<article class="ads-card"><h3>${escapeHtml(title)}</h3><p>暂无记录 / No records yet.</p></article>`;
    }
    return `
      <article class="ads-card">
        <div class="section-title" style="margin-top: 0;">
          <h2>${escapeHtml(title)}</h2>
          <span class="feed-count">${rows.length} records</span>
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
      root.innerHTML = `<article class="ads-card"><h3>报表索引加载中 / Loading report indexes</h3></article>`;
      return;
    }
    root.innerHTML = `
      <div class="summary-grid">
        <div class="summary-metric"><span class="metric-value">${adsArtifacts.syncLogs.length}</span><span class="metric-label">同步日志 / Sync logs</span></div>
        <div class="summary-metric"><span class="metric-value">${adsArtifacts.rawArchives.length}</span><span class="metric-label">原始报表 / Raw reports</span></div>
        <div class="summary-metric"><span class="metric-value">${adsArtifacts.cleanedArchives.length}</span><span class="metric-label">清洗报表 / Cleaned reports</span></div>
        <div class="summary-metric"><span class="metric-value">${adsArtifacts.llmLogs.length}</span><span class="metric-label">LLM 分析 / LLM logs</span></div>
      </div>
      <div class="feed" style="margin-top: 14px;">
        ${renderArtifactTable("同步日志 / Sync Logs", adsArtifacts.syncLogs, [
          { key: "sync_id", label: "Sync ID" },
          { key: "report_type", label: "Report Type" },
          { key: "status", label: "Status" },
          { key: "row_count", label: "Rows" },
          { key: "cleaned_report_path", label: "Cleaned Path" }
        ])}
        ${renderArtifactTable("原始报表 / Raw Report Archives", adsArtifacts.rawArchives, [
          { key: "report_type", label: "Report Type" },
          { key: "start_date", label: "Start" },
          { key: "end_date", label: "End" },
          { key: "row_count", label: "Rows" },
          { key: "file_path", label: "File Path" }
        ])}
        ${renderArtifactTable("清洗报表 / Cleaned Report Archives", adsArtifacts.cleanedArchives, [
          { key: "report_type", label: "Report Type" },
          { key: "cleaning_status", label: "Status" },
          { key: "row_count", label: "Rows" },
          { key: "file_path", label: "File Path" }
        ])}
        ${renderArtifactTable("DeepSeek / LLM Analysis Logs", adsArtifacts.llmLogs, [
          { key: "analysis_type", label: "Analysis Type" },
          { key: "model", label: "Model" },
          { key: "validation_status", label: "Validation" },
          { key: "input_summary_path", label: "Input Path" },
          { key: "parsed_json_path", label: "Output Path" }
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
              <th>调整时间 / Time</th>
              <th>动作 / Action</th>
              <th>对象 / Entity</th>
              <th>调整前 / Before</th>
              <th>调整后 / After</th>
              <th>风险 / Risk</th>
              <th>审批 / Approval</th>
              <th>执行 / Execution</th>
              <th>复盘 / Review</th>
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
              <div class="ads-mini-stat"><span>Before Spend</span><strong>${formatMoney(review.before_spend)}</strong></div>
              <div class="ads-mini-stat"><span>After Spend</span><strong>${formatMoney(review.after_spend)}</strong></div>
              <div class="ads-mini-stat"><span>Before ACOS</span><strong>${formatPct(review.before_acos)}</strong></div>
              <div class="ads-mini-stat"><span>After ACOS</span><strong>${formatPct(review.after_acos)}</strong></div>
              <div class="ads-mini-stat"><span>Before Orders</span><strong>${escapeHtml(review.before_orders)}</strong></div>
              <div class="ads-mini-stat"><span>After Orders</span><strong>${escapeHtml(review.after_orders)}</strong></div>
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
    const items = [
      ["Amazon Ads 凭证 / Credentials", settings.amazon_ads_credentials_status],
      ["DeepSeek API Key", settings.deepseek_api_key_status],
      ["本地数据库 / Database", settings.database_path],
      ["原始报表 / Raw reports", settings.raw_report_archive_path],
      ["清洗报表 / Cleaned reports", settings.cleaned_report_archive_path],
      ["同步频率 / Sync frequency", settings.sync_frequency],
      ["保存 DeepSeek 请求 / Save request log", settings.save_deepseek_request_log ? "yes" : "no"],
      ["保存完整响应 / Save full response", settings.save_deepseek_full_response ? "yes" : "no"],
      ["低风险自动执行 / Low-risk auto execute", settings.allow_low_risk_auto_execute ? "enabled" : "disabled"],
      ["默认 Target ACOS", formatPct(settings.default_target_acos)],
      ["默认 Max ACOS", formatPct(settings.default_max_acos)]
    ];
    root.innerHTML = `
      <div class="pref-grid">
        ${items.map(([label, value]) => `<div class="pref-item">${escapeHtml(label)}<br><span>${escapeHtml(value)}</span></div>`).join("")}
      </div>
      <p class="empty">敏感配置应写入本地 .env.local 或 config/secrets.local.json，本原型不保存真实密钥。/ Secrets should live in local config, not in frontend code.</p>
    `;
  }

  function makeAdjustmentFromRecommendation(rec, status) {
    const now = new Date().toISOString();
    return {
      adjustment_id: `LOCAL-${rec.recommendation_id}`,
      action_id: `LOCAL-ACT-${rec.recommendation_id}`,
      action_type: rec.suggested_action,
      entity_type: rec.entity_type,
      entity_id: rec.recommendation_id,
      entity_name: rec.entity_name,
      before_value: rec.current_value ?? "not_set",
      suggested_value: rec.suggested_value ?? rec.suggested_action,
      final_value: rec.suggested_value ?? rec.suggested_action,
      reason: rec.reason,
      risk_level: rec.risk_level,
      approval_status: status === "approved" && !rec.requires_approval ? "auto_approved_low_risk" : status,
      execution_status: "queued_for_execution",
      executed_at: "",
      rollback_available: false,
      review_status: "reviewing_result",
      created_at: now
    };
  }

  function upsertLocalAdjustment(rec, status) {
    const adjustment = makeAdjustmentFromRecommendation(rec, status);
    adsState.local_adjustments = adsState.local_adjustments.filter(item => item.adjustment_id !== adjustment.adjustment_id);
    adsState.local_adjustments.unshift(adjustment);
  }

  function updateRecommendationStatus(id, status) {
    const rec = adsData.recommendations.find(item => item.recommendation_id === id);
    if (!rec) return;
    adsState.recommendation_status[id] = status;
    if (status === "approved" || status === "modified") {
      upsertLocalAdjustment(rec, status);
    }
    writeState();
    renderAll();
    const target = document.querySelector(`[data-ads-status="${CSS.escape(id)}"]`);
    if (target) target.textContent = statusLabels[status] || status;
  }

  function handleAdsAction(button) {
    const action = button.dataset.adsAction;
    const id = button.dataset.adsId;
    const rec = adsData && adsData.recommendations.find(item => item.recommendation_id === id);

    if (action === "approve") updateRecommendationStatus(id, "approved");
    if (action === "modify") updateRecommendationStatus(id, "modified");
    if (action === "ignore") updateRecommendationStatus(id, "ignored");
    if (action === "protect" && rec) {
      adsState.protected_terms = Array.from(new Set([...adsState.protected_terms, rec.entity_name]));
      writeState();
      updateRecommendationStatus(id, "ignored");
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

  function renderAll() {
    renderDashboard();
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
    });

    const bulkButton = document.getElementById("bulkApproveLowRisk");
    if (bulkButton) bulkButton.addEventListener("click", bulkApproveLowRisk);
  }

  async function loadAdsData() {
    if (window.AdsDataProvider) {
      const providerResult = await window.AdsDataProvider.loadAdsReports();
      adsData = providerResult.mock;
      adsArtifacts = await window.AdsDataProvider.loadAdsArtifacts();
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
      root.innerHTML = `<article class="ads-card"><h3>广告模块加载失败 / Ads module failed to load</h3><p>${escapeHtml(error.message)}</p></article>`;
    }
  });
})();
