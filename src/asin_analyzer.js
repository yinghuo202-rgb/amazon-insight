(function () {
  const DATA_PATHS = ["./data/mock/asin_screening.mock.json", "./data/asin_analysis_mock.json"];
  const RECENT_KEY = "amazon_growth_console_recent_asins_v1";
  const ENRICHMENT_QUEUE_KEY = "amazon_growth_console_enrichment_queue_v1";
  const LIVE_CACHE_KEY = "amazon_growth_console_live_asin_cache_v1";
  const MARKET_KEY = "amazon_growth_console_asin_market_v1";

  let asinData = { samples: [], cases: {} };
  let candidateProducts = [];
  let reviewPainPointRecords = [];
  let currentRecord = null;
  let selectedMarketplace = localStorage.getItem(MARKET_KEY) || "US";

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
      notes: "本地候选池缺少数据。",
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
    const labels = { high: "高", medium: "中", low: "低" };
    return labels[value] || value || "-";
  }

  function stageText(value) {
    const labels = {
      introduction: "导入期",
      growth: "增长期",
      maturity: "成熟期",
      decline: "衰退期",
      uncertain: "待确认"
    };
    return labels[value] || value || "-";
  }

  function listItems(items) {
    if (!items || !items.length) return `<p class="empty">暂无信号。</p>`;
    return `<ul class="signal-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function renderTrend(values = []) {
    if (!values.length) return `<p class="empty">暂无趋势数据。</p>`;
    const max = Math.max(...values, 1);
    return `
      <div class="trend-bars" aria-label="12 month trend">
        ${values.map((value, index) => `
          <span style="height: ${Math.max(12, Math.round((value / max) * 92))}%;" title="M${index + 1}: ${escapeHtml(value)}"></span>
        `).join("")}
      </div>
    `;
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/[$,%\s,]/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function rawAttrs(candidate) {
    return candidate && candidate.raw_fields && candidate.raw_fields.attributes ? candidate.raw_fields.attributes : {};
  }

  function firstValue(...values) {
    return values.find(value => value !== null && value !== undefined && value !== "");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value || 0)));
  }

  function ageMonths(dateValue) {
    if (!dateValue) return null;
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;
    const now = new Date();
    return Math.max(0, (now.getUTCFullYear() - date.getUTCFullYear()) * 12 + now.getUTCMonth() - date.getUTCMonth());
  }

  function listingQualityScore(value) {
    const score = toNumber(value);
    if (score === null) return null;
    return score <= 10 ? Math.round(score * 10) : Math.round(score);
  }

  function words(value) {
    return String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2);
  }

  function overlapScore(a, b) {
    const left = new Set(words([a.title, a.category, a.product_type, a.sub_scenario, ...(a.keywords || [])].join(" ")));
    const right = new Set(words([b.title, b.category, b.product_type, b.sub_scenario, ...(b.keywords || [])].join(" ")));
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    left.forEach(token => {
      if (right.has(token)) overlap += 1;
    });
    return overlap / Math.max(left.size, right.size);
  }

  function sameSegment(a, b) {
    return (
      a.product_type && a.product_type === b.product_type ||
      a.sub_scenario && a.sub_scenario === b.sub_scenario ||
      overlapScore(a, b) >= 0.18
    );
  }

  function peerProducts(candidate, limit = 5) {
    return candidateProducts
      .filter(item => normalizeAsin(item.asin) && normalizeAsin(item.asin) !== normalizeAsin(candidate.asin))
      .filter(item => sameSegment(candidate, item))
      .map(item => ({ item, score: overlapScore(candidate, item) + (item.product_type === candidate.product_type ? 0.35 : 0) + (item.sub_scenario === candidate.sub_scenario ? 0.25 : 0) }))
      .sort((a, b) => b.score - a.score || Number(b.item.estimated_monthly_sales || 0) - Number(a.item.estimated_monthly_sales || 0))
      .slice(0, limit)
      .map(({ item }) => item);
  }

  function median(values) {
    const nums = values.map(toNumber).filter(value => value !== null).sort((a, b) => a - b);
    if (!nums.length) return null;
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  }

  function marketHeat(monthlyUnits, monthlyRevenue, peerCount) {
    if (monthlyUnits >= 500 || monthlyRevenue >= 20000 || peerCount >= 5) return "high";
    if (monthlyUnits >= 100 || monthlyRevenue >= 5000 || peerCount >= 2) return "medium";
    return "low";
  }

  function inferOpportunity(candidate, score, competitionLevel, marketLevel) {
    if (score >= 75 && competitionLevel !== "high") return "high";
    if (marketLevel === "high" && competitionLevel === "low") return "high";
    if (score >= 58 || marketLevel === "medium") return "medium";
    return "low";
  }

  function estimateTrendSeries(candidate) {
    const base = Math.max(20, Number(candidate.estimated_monthly_sales || rawAttrs(candidate).approximate_30_day_units_sold || 80));
    const rawTrend = String(candidate.bsr_30d_trend || "").toLowerCase();
    const slope = rawTrend.includes("improv") ? 0.18 : rawTrend.includes("wors") ? -0.14 : Number(candidate.review_30d_growth || 0) > 10 ? 0.12 : 0.06;
    return Array.from({ length: 12 }, (_, index) => {
      const seasonalWave = 1 + Math.sin((index / 12) * Math.PI * 2) * 0.08;
      const growth = 1 + slope * ((index - 5.5) / 5.5);
      return Math.max(5, Math.round(base * seasonalWave * growth));
    });
  }

  function pricePosition(price, peerPrices) {
    if (!price) return "-";
    const peerMedian = median(peerPrices);
    if (!peerMedian) return price >= 20 && price <= 80 ? "重点价格带内" : "重点价格带外";
    if (price < peerMedian * 0.85) return "低于同类中位价";
    if (price > peerMedian * 1.15) return "高于同类中位价";
    return "接近同类中位价";
  }

  function hasEnglishWords(value) {
    return /[A-Za-z]{3,}/.test(String(value || ""));
  }

  function displayCategory(value) {
    const labels = {
      "Office Products": "办公用品",
      "Patio, Lawn & Garden": "庭院、草坪与花园",
      "Automotive": "汽车配件",
      "Tools & Home Improvement": "工具与家居改善",
      "Amazon US": "亚马逊美国站"
    };
    return labels[value] || value || "未分类";
  }

  function displayProductTitle(product) {
    const title = String(product && product.title || "");
    const text = title.toLowerCase();
    if (!hasEnglishWords(title)) return title;
    if (text.includes("label maker")) return "蓝牙标签打印机";
    if (text.includes("faucet") || text.includes("spigot") || text.includes("freeze")) return "户外水龙头防冻保护罩";
    if (text.includes("hose storage") || text.includes("storage bag")) return "房车水管收纳袋";
    if (text.includes("door edge") || text.includes("edge guard")) return "汽车车门边缘防护条";
    if (text.includes("water pressure")) return "水压调节或测量配件";
    return product && product.asin ? `商品编号 ${product.asin}` : "商品机会";
  }

  function marketLabel(code) {
    const markets = window.AsinResearchEnrichment && window.AsinResearchEnrichment.MARKETS;
    return markets && markets[code] ? markets[code].label : code || "美国";
  }

  function riskClassByLevel(level) {
    if (level === "高") return "fit-low";
    if (level === "低") return "fit-high";
    return "fit-medium";
  }

  function normalizePainPointText(items = []) {
    return (items || []).map(item => {
      if (typeof item === "string") return item;
      return [item.theme, item.frequency, item.example_summary || item.improvement_angle].filter(Boolean).join("：");
    }).filter(Boolean);
  }

  function reviewSignalFor(candidate) {
    const exact = reviewPainPointRecords.find(item => normalizeAsin(item.asin) === normalizeAsin(candidate.asin));
    if (exact) return exact;
    const embedded = candidate.review_pain_points || candidate.pain_points;
    if (embedded && embedded.length) {
      return {
        asin: candidate.asin,
        pain_points: embedded,
        risk_notes: normalizePainPointText(embedded),
        opportunity_notes: []
      };
    }
    const peers = peerProducts(candidate, 8);
    return peers.map(peer => reviewPainPointRecords.find(item => normalizeAsin(item.asin) === normalizeAsin(peer.asin))).find(Boolean) || null;
  }

  function buildCompareProducts(candidate, peers) {
    return peers.map(item => ({
      asin: item.asin,
      title: item.title || item.display_title || "-",
      brand: item.brand || rawAttrs(item).brand || "",
      price: firstValue(item.reference_price, rawAttrs(item).price),
      rating: firstValue(item.rating, rawAttrs(item).rating),
      reviews: firstValue(item.review_count, rawAttrs(item).reviews),
      monthly_units: firstValue(item.estimated_monthly_sales, rawAttrs(item).approximate_30_day_units_sold),
      bsr: firstValue(item.bsr, rawAttrs(item).product_rank)
    }));
  }

  function buildListingAnalysis(candidate, attrs, peers) {
    const title = candidate.title || "";
    const quality = listingQualityScore(firstValue(attrs.listing_quality_score, candidate.listing_quality_score));
    const strengths = [
      candidate.brand || attrs.brand ? `品牌字段明确：${candidate.brand || attrs.brand}` : "",
      title.length >= 80 ? "标题覆盖较多核心词和使用场景。" : "",
      attrs.image_url ? "接口返回主图，可用于基础商品识别。" : "",
      attrs.breadcrumb_path ? `类目路径清晰：${attrs.breadcrumb_path}` : "",
      quality !== null && quality >= 70 ? `页面质量分较高：${quality}/100。` : ""
    ].filter(Boolean);
    const gaps = [
      title.length < 70 ? "标题信息偏短，需要确认核心关键词、材质、尺寸和适配场景是否完整。" : "",
      !attrs.image_url ? "缺少图片字段，无法判断主图表达。" : "",
      quality !== null && quality < 60 ? `页面质量分偏低：${quality}/100，可能存在文案或图片缺口。` : "",
      !attrs.breadcrumb_path ? "缺少完整类目路径，竞品归类需要复核。" : "",
      peers.length < 2 ? "同类参考竞品不足，需要补充更多样本。" : ""
    ].filter(Boolean);
    return {
      confidence: quality !== null || attrs.image_url || attrs.breadcrumb_path ? "medium" : "low",
      summary: quality !== null
        ? `当前页面质量分约 ${quality}/100，结合标题、品牌、类目和图片字段做初步评估。`
        : "接口未提供完整页面质量字段，当前只能基于标题、品牌和类目做初筛。",
      strengths: strengths.length ? strengths : ["基础商品字段已可用于商品编号初筛。"],
      gaps: gaps.length ? gaps : ["仍需人工查看前台五点、A+、图片细节和问答。"],
      warnings: [
        candidate.main_risks || "不要只依赖第三方接口字段做采购决策。",
        attrs.is_available === false ? "接口显示商品不可售，需要确认是否临时缺货或长期下架。" : ""
      ].filter(Boolean)
    };
  }

  function buildReviewAnalysis(candidate, reviewSignal) {
    const painPoints = reviewSignal ? normalizePainPointText(reviewSignal.pain_points) : normalizePainPointText(candidate.review_pain_points || candidate.pain_points || []);
    const drivers = reviewSignal && reviewSignal.opportunity_notes && reviewSignal.opportunity_notes.length
      ? reviewSignal.opportunity_notes
      : [
        candidate.use_case,
        candidate.why_recommended,
        candidate.seasonal_attribute
      ].filter(Boolean).slice(0, 3);
    const risks = reviewSignal && reviewSignal.risk_notes && reviewSignal.risk_notes.length
      ? reviewSignal.risk_notes
      : [candidate.main_risks || "评论文本未接入，需人工抽样差评确认质量、尺寸、安装和退货风险。"];
    return {
      confidence: painPoints.length ? "medium" : "low",
      coverage: painPoints.length ? "candidate_or_peer_review_signal" : "metrics_only",
      summary: painPoints.length
        ? "已结合本地评论痛点样例或同类竞品痛点生成初步评论信号。"
        : "当前接口未提供评论文本，只能根据评分、评论数和同类经验判断风险。",
      pain_points: painPoints.length ? painPoints.slice(0, 5) : ["缺少评论文本，无法直接抽取高频差评。"],
      purchase_drivers: drivers.length ? drivers.slice(0, 5) : ["需要补充评论摘要后判断购买驱动。"],
      risks: risks.slice(0, 5)
    };
  }

  function renderCompare(products = []) {
    if (!products.length) return `<p class="empty">暂无参考竞品。</p>`;
    return `
      <div class="ads-table-wrap">
        <table class="ads-table">
          <thead>
            <tr>
              <th>商品编号</th>
              <th>产品</th>
              <th>价格</th>
              <th>评分</th>
              <th>评论数</th>
              <th>月销量</th>
            </tr>
          </thead>
          <tbody>
            ${products.map(product => `
              <tr>
                <td>${escapeHtml(product.asin)}</td>
                <td><strong>${escapeHtml(displayProductTitle(product))}</strong><br><span>${escapeHtml(product.brand || "")}</span></td>
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
    const attrs = rawAttrs(candidate);
    const peers = peerProducts(candidate, 5);
    const compareProducts = buildCompareProducts(candidate, peers);
    const price = firstValue(candidate.reference_price, attrs.price);
    const monthlyUnits = firstValue(candidate.estimated_monthly_sales, attrs.approximate_30_day_units_sold);
    const monthlyRevenue = firstValue(candidate.estimated_monthly_revenue, attrs.approximate_30_day_revenue, Number(((monthlyUnits || 0) * (price || 0)).toFixed(2)));
    const reviewCount = firstValue(candidate.review_count, attrs.reviews, attrs.variant_reviews);
    const rating = firstValue(candidate.rating, attrs.rating);
    const bsr = firstValue(candidate.bsr, attrs.product_rank);
    const score = Math.round(clamp(
      firstValue(candidate.total_score, candidate.jungle_scout_opportunity_score ? candidate.jungle_scout_opportunity_score * 10 : null, candidate.market_score ? candidate.market_score * 4 : null, 68),
      0,
      100
    ));
    const reviewBarrier = reviewCount || median(peers.map(item => firstValue(item.review_count, rawAttrs(item).reviews))) || 0;
    const competitionLevel = reviewBarrier > 1000 ? "high" : reviewBarrier > 300 ? "medium" : "low";
    const marketLevel = marketHeat(Number(monthlyUnits || 0), Number(monthlyRevenue || 0), peers.length);
    const opportunity = inferOpportunity(candidate, score, competitionLevel, marketLevel);
    const peerPrices = peers.map(item => firstValue(item.reference_price, rawAttrs(item).price));
    const peerBrands = peers.map(item => item.brand || rawAttrs(item).brand).filter(Boolean);
    const brandCounts = peerBrands.reduce((map, brand) => ({ ...map, [brand]: (map[brand] || 0) + 1 }), {});
    const topBrandCount = peerBrands.length ? Math.max(...Object.values(brandCounts)) : 0;
    const brandConcentration = peerBrands.length ? Math.round((topBrandCount / peerBrands.length) * 100) : (candidate.brand || attrs.brand ? 100 : 0);
    const numericPeerPrices = peerPrices.map(Number).filter(Number.isFinite);
    const minPeerPrice = numericPeerPrices.length ? Math.min(...numericPeerPrices) : null;
    const maxPeerPrice = numericPeerPrices.length ? Math.max(...numericPeerPrices) : null;
    const peerMedianPrice = median(peerPrices);
    const priceSpread = peerMedianPrice && minPeerPrice !== null && maxPeerPrice !== null ? Number(((maxPeerPrice - minPeerPrice) / peerMedianPrice).toFixed(2)) : null;
    const variantCount = Array.isArray(attrs.variants) ? attrs.variants.length : (attrs.is_variant ? 1 : 0);
    const quality = listingQualityScore(firstValue(attrs.listing_quality_score, candidate.listing_quality_score));
    const reviewSignal = reviewSignalFor(candidate);
    const listing = buildListingAnalysis(candidate, attrs, peers);
    const review = buildReviewAnalysis(candidate, reviewSignal);
    const trendSeries = candidate.trend_series && candidate.trend_series.length ? candidate.trend_series : estimateTrendSeries(candidate);
    const firstTrend = trendSeries[0] || monthlyUnits || 0;
    const lastTrend = trendSeries[trendSeries.length - 1] || monthlyUnits || 0;
    const trendDelta = firstTrend ? Number(((lastTrend - firstTrend) / firstTrend).toFixed(2)) : 0;

    return {
      mode: options.mode || "local_candidate_pool",
      label: options.label || "本地候选池",
      source_details: options.sourceDetails || null,
      product: {
        asin,
        title: candidate.title || candidate.display_title || `商品 ${asin}`,
        brand: candidate.brand || attrs.brand || "未知品牌",
        category: attrs.breadcrumb_path || candidate.category || attrs.category || "亚马逊美国站",
        product_type: candidate.product_type || "",
        sub_scenario: candidate.sub_scenario || "",
        seasonal_attribute: candidate.seasonal_attribute || "",
        keywords: candidate.keywords || [],
        size_risk: candidate.size_risk || "",
        compliance_risk: candidate.compliance_risk || "",
        price,
        rating,
        reviews: reviewCount,
        monthly_units: monthlyUnits,
        monthly_revenue: monthlyRevenue,
        bsr
      },
      compare_products: compareProducts,
      trend_series: trendSeries,
      analysis: {
        summary: candidate.one_sentence_conclusion || `${productTitleShort(candidate.title)}：月销约 ${formatNumber(monthlyUnits)}，评论数 ${formatNumber(reviewCount)}，类目排名 ${formatNumber(bsr)}，可用于比原先更完整的商品编号初筛。`,
        recommendation: candidate.why_recommended || "继续核验真实销量、评论痛点、成本和是否与店铺已有产品重复。",
        decision: opportunity === "high" ? "advance" : "watch",
        decision_label: opportunity === "high" ? "推进" : "继续观察",
        score,
        lifecycle: {
          stage: candidate.timing_window === "early_layout" ? "introduction" : Number(ageMonths(attrs.date_first_available)) > 48 ? "maturity" : "growth",
          confidence: monthlyUnits || bsr || attrs.date_first_available ? "medium" : "low",
          evidence: [
            attrs.date_first_available ? `上架时间：${attrs.date_first_available}，约 ${ageMonths(attrs.date_first_available)} 个月。` : "上架时间缺失，生命周期需要人工确认。",
            monthlyUnits ? `近 30 天销量字段：${formatNumber(monthlyUnits)} 件。` : "月销字段缺失，需补充销量来源。",
            bsr ? `当前类目排名：${formatNumber(bsr)}。` : "",
            `推荐来源：${(candidate.recommendation_sources || []).join(", ") || "本地数据"}`,
            `时间窗口：${candidate.timing_window || "待确认"}`
          ].filter(Boolean)
        },
        competition: {
          level: competitionLevel,
          entry_difficulty: competitionLevel,
          differentiation_room: opportunity,
          evidence: [
            peers.length ? `已从候选池匹配 ${peers.length} 个同类参考竞品。` : "候选池中同类竞品不足。",
            reviewBarrier ? `评论门槛参考值：${formatNumber(reviewBarrier)} 条。` : "",
            brandConcentration ? `参考竞品品牌集中度约 ${brandConcentration}%。` : "",
            candidate.competitive_notes || candidate.main_risks || "仍需补充真实竞品数据。"
          ].filter(Boolean)
        },
        market_overview: {
          market_heat: marketLevel,
          opportunity_level: opportunity,
          entry_barrier: competitionLevel,
          search_trend_delta: trendDelta,
          sales_trend_delta: trendDelta,
          brand_concentration: brandConcentration,
          review_barrier: reviewBarrier,
          price_spread: priceSpread,
          bsr,
          peer_count: peers.length,
          median_peer_price: peerMedianPrice,
          estimated_monthly_revenue: monthlyRevenue
        },
        product_snapshot: {
          seller_type: candidate.seller_type || attrs.seller_type || "待确认",
          seller_count: firstValue(attrs.number_of_sellers, candidate.seller_count),
          variant_count: variantCount,
          listing_quality_score: quality,
          price_positioning: pricePosition(price, peerPrices),
          age_months: ageMonths(attrs.date_first_available),
          dimensions_summary: candidate.dimensions || [
            attrs.length_value ? `L ${attrs.length_value}` : "",
            attrs.width_value ? `W ${attrs.width_value}` : "",
            attrs.height_value ? `H ${attrs.height_value}` : "",
            attrs.dimensions_unit || ""
          ].filter(Boolean).join(" ") || candidate.size_risk || "-",
          bsr,
          subcategory_rank: attrs.subcategory_ranks && attrs.subcategory_ranks[0] ? `${attrs.subcategory_ranks[0].subcategory}: #${attrs.subcategory_ranks[0].rank}` : "",
          buy_box_owner: attrs.buy_box_owner || "",
          availability: attrs.is_available === false ? "不可售" : attrs.is_available === true ? "可售" : "待确认",
          fba_fee: attrs.fee_breakdown && attrs.fee_breakdown.fba_fee,
          referral_fee: attrs.fee_breakdown && attrs.fee_breakdown.referral_fee,
          total_fees: attrs.fee_breakdown && attrs.fee_breakdown.total_fees,
          flags: [
            `产品类型：${candidate.product_type || "-"}`,
            `子场景：${candidate.sub_scenario || "-"}`,
            `店铺匹配：${candidate.store_fit || "-"}`,
            attrs.is_variant ? "该商品是变体商品编号。" : "该商品不是变体商品编号或未标记为变体。",
            attrs.is_available === false ? "当前接口显示不可售。" : "",
            attrs.date_first_available_is_estimated ? "上架时间为估算值。" : ""
          ].filter(Boolean)
        },
        listing_analysis: listing,
        review_analysis: review,
        next_steps: [
          candidate.next_step || "补充真实评论和竞品数据。",
          peers.length ? "逐个打开参考竞品，检查差评、主图和变体结构。" : "补充同类竞品样本后再判断竞争格局。",
          attrs.fee_breakdown ? `核对费用：配送费 ${formatMoney(attrs.fee_breakdown.fba_fee)}，佣金 ${formatMoney(attrs.fee_breakdown.referral_fee)}，总费用 ${formatMoney(attrs.fee_breakdown.total_fees)}。` : "确认供应商成本、包装尺寸和配送费用。"
        ]
      }
    };
  }

  function productTitleShort(title) {
    const text = String(title || "该商品编号").trim();
    return text.length > 52 ? `${text.slice(0, 52)}...` : text;
  }

  function dataMissingCase(asin) {
    const queueRecord = enqueueMissingAsin(asin);
    return {
      mode: "data_missing",
      label: "数据缺失",
      queue_record: queueRecord,
      product: {
        asin,
        title: `商品编号 ${asin}`,
        brand: "",
        category: "待确认",
        price: null,
        rating: null,
        reviews: null,
        monthly_units: null,
        monthly_revenue: null
      },
      compare_products: [],
      trend_series: [],
      analysis: {
        summary: "数据缺失：该商品编号暂未在本地候选池中。",
        recommendation: "已加入待补全队列，后续可通过手工导入或第三方数据补充后再判断。",
        decision: "hold",
        decision_label: "待补全",
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
        label: "实时数据缓存",
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
        const error = new Error(payload.error || `第三方接口返回 HTTP ${response.status}`);
        error.details = payload.details || null;
        throw error;
      }
      if (!payload.candidate || !payload.candidate.asin) {
        throw new Error("第三方接口未返回可用商品数据。");
      }
      cacheLiveCandidate(payload.candidate);
      candidateProducts = [
        payload.candidate,
        ...candidateProducts.filter(item => normalizeAsin(item.asin) !== normalizeAsin(payload.candidate.asin))
      ];
      return candidateCase(payload.candidate, {
        mode: "jungle_scout_api_live",
        label: "实时接口结果",
        sourceDetails: payload.provider || null
      });
    } catch (error) {
      const missing = dataMissingCase(asin);
      missing.mode = "api_error";
      missing.label = "实时接口失败";
      missing.analysis.summary = `实时接口调用失败：${error.message}`;
      missing.analysis.recommendation = "已加入待补全队列。请确认本地服务已启动，并检查接口凭据是否有效。";
      missing.analysis.next_steps = [
        "确认当前页面地址由本地接口代理服务提供。",
        "运行接口检查命令确认凭据状态。",
        "稍后重试该商品编号，或先用已导入候选池数据判断。"
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
          <h2>批量判断结果</h2>
          <span class="feed-count">${records.length} 个商品编号</span>
        </div>
        <div class="batch-results">
          ${records.map(record => `
            <div class="batch-row">
              <div>
                <strong>${escapeHtml(record.product.asin)}</strong>
                <span>${escapeHtml(record.mode)}</span>
              </div>
              <div>
                <strong>${escapeHtml(displayProductTitle(record.product))}</strong>
                <span>分数 ${escapeHtml(record.analysis.score)} · 机会 ${escapeHtml(levelText(record.analysis.market_overview.opportunity_level))}</span>
              </div>
              <div class="actions" style="margin-top: 0;">
                <span class="badge ${levelClass(record.analysis.decision)}">${escapeHtml(record.analysis.decision_label)}</span>
                <button class="btn small" type="button" data-asin-sample="${escapeHtml(record.product.asin)}">查看详情</button>
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
            <h3>${escapeHtml(displayProductTitle(record.product))}</h3>
            <p>商品编号 ${escapeHtml(record.product.asin)} · 待补全队列</p>
          </div>
          <div class="ads-card-badges">
            <span class="badge fit-low">待补全</span>
          </div>
        </div>
        <p class="conclusion">
          数据缺失：该商品编号暂未在本地候选池中。已加入待补全队列，后续可通过手工导入或第三方数据补充。
        </p>
        <div class="ads-metric-grid">
          <div class="ads-mini-stat"><span>队列状态</span><strong>${escapeHtml(record.queue_record.status)}</strong></div>
          <div class="ads-mini-stat"><span>来源</span><strong>${escapeHtml(record.queue_record.source)}</strong></div>
          <div class="ads-mini-stat"><span>尝试次数</span><strong>${escapeHtml(record.queue_record.attempt_count)}</strong></div>
          <div class="ads-mini-stat"><span>更新时间</span><strong>${escapeHtml(record.queue_record.updated_at.slice(0, 10))}</strong></div>
        </div>
      </article>
    `;
  }

  function renderEnrichment(record) {
    if (!window.AsinResearchEnrichment || !record || !record.product) return "";
    const enrichment = window.AsinResearchEnrichment.enrich({
      product: record.product,
      analysis: record.analysis,
      compareProducts: record.compare_products || [],
      marketplace: selectedMarketplace
    });
    const riskItems = enrichment.restriction_risks.map(item => `
      <div class="restriction-card">
        <div class="restriction-head">
          <strong>${escapeHtml(item.type)}</strong>
          <span class="badge ${riskClassByLevel(item.level)}">${escapeHtml(item.level)}</span>
        </div>
        <p>${escapeHtml(item.note)}</p>
      </div>
    `).join("");
    const taskItems = enrichment.crawler_tasks.map(task => `
      <div class="crawler-task">
        <span class="badge action">${escapeHtml(task.source)}</span>
        <strong>${escapeHtml(task.query)}</strong>
        <p>${escapeHtml(task.purpose)}</p>
      </div>
    `).join("");
    return `
      <article class="ads-card enrichment-card">
        <div class="section-title" style="margin-top: 0;">
          <div>
            <h2>增强搜索与爬虫摘要</h2>
            <span class="feed-count">${escapeHtml(enrichment.market_label)}站 · ${escapeHtml(enrichment.crawler_summary.status)}</span>
          </div>
          <span class="badge source">${escapeHtml(enrichment.crawler_summary.mode)}</span>
        </div>
        <div class="ads-metric-grid">
          <div class="ads-mini-stat"><span>目标市场</span><strong>${escapeHtml(enrichment.market_label)}</strong></div>
          <div class="ads-mini-stat"><span>站点</span><strong>${escapeHtml(enrichment.marketplace_domain)}</strong></div>
          <div class="ads-mini-stat"><span>产品族</span><strong>${escapeHtml(enrichment.product_name_cn)}</strong></div>
          <div class="ads-mini-stat"><span>本地估算月销量</span><strong>${formatNumber(enrichment.market_snapshot.estimated_units)}</strong></div>
        </div>
        <div class="copy-grid">
          <div class="copy-block">
            <h3>市场定位</h3>
            ${listItems(enrichment.positioning)}
          </div>
          <div class="copy-block">
            <h3>使用场景</h3>
            ${listItems(enrichment.usage_scenarios)}
          </div>
          <div class="copy-block">
            <h3>评论补充</h3>
            ${listItems([
              `购买驱动：${enrichment.review_enrichment.positive_drivers.join("、")}`,
              `差评主题：${enrichment.review_enrichment.negative_themes.join("、")}`,
              `待抓问题：${enrichment.review_enrichment.questions_to_scrape.join("、")}`
            ])}
          </div>
          <div class="copy-block">
            <h3>市场备注</h3>
            ${listItems([
              enrichment.market_snapshot.demand_note,
              enrichment.market_snapshot.price_note,
              enrichment.market_snapshot.competitor_note
            ])}
          </div>
        </div>
      </article>
      <article class="ads-card">
        <div class="section-title" style="margin-top: 0;">
          <h2>限制与风险提示</h2>
          <span class="feed-count">出口、专利、季节、合规、本地化</span>
        </div>
        <div class="restriction-grid">${riskItems}</div>
      </article>
      <article class="ads-card">
        <div class="section-title" style="margin-top: 0;">
          <h2>增强搜索任务</h2>
          <span class="feed-count">${enrichment.crawler_tasks.length} 个待执行抓取方向</span>
        </div>
        <div class="crawler-grid">${taskItems}</div>
      </article>
    `;
  }

  function renderAnalysis(record) {
    if (record.mode === "data_missing" || record.mode === "api_error") {
      currentRecord = record;
      renderMissingAnalysis(record);
      return;
    }
    currentRecord = record;
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
            <h3>${escapeHtml(displayProductTitle(product))}</h3>
            <p>${escapeHtml(displayCategory(product.category))} · 商品编号 ${escapeHtml(product.asin)} · ${escapeHtml(product.brand || "未知品牌")}</p>
          </div>
          <div class="ads-card-badges">
            <span class="badge ${levelClass(analysis.decision)}">${escapeHtml(analysis.decision_label)}</span>
            <span class="badge ${levelClass(overview.opportunity_level)}">机会 ${escapeHtml(levelText(overview.opportunity_level))}</span>
          </div>
        </div>
        <div class="asin-score-row">
          <div class="asin-score">
            <span>机会评分</span>
            <strong>${escapeHtml(analysis.score)}</strong>
            <div class="score-track"><i style="width: ${Math.max(5, Math.min(100, Number(analysis.score || 0)))}%;"></i></div>
          </div>
          <p class="conclusion">${escapeHtml(analysis.summary)} ${escapeHtml(analysis.recommendation)}</p>
        </div>
        <div class="ads-metric-grid">
          <div class="ads-mini-stat"><span>价格</span><strong>${formatMoney(product.price)}</strong></div>
          <div class="ads-mini-stat"><span>评分</span><strong>${escapeHtml(product.rating ?? "-")}</strong></div>
          <div class="ads-mini-stat"><span>评论数</span><strong>${formatNumber(product.reviews)}</strong></div>
          <div class="ads-mini-stat"><span>月销量</span><strong>${formatNumber(product.monthly_units)}</strong></div>
          <div class="ads-mini-stat"><span>月营收</span><strong>${formatMoney(product.monthly_revenue)}</strong></div>
          <div class="ads-mini-stat"><span>类目排名</span><strong>${formatNumber(product.bsr)}</strong></div>
          <div class="ads-mini-stat"><span>市场阶段</span><strong>${escapeHtml(stageText(analysis.lifecycle && analysis.lifecycle.stage))}</strong></div>
          <div class="ads-mini-stat"><span>竞争强度</span><strong>${escapeHtml(levelText(analysis.competition && analysis.competition.level))}</strong></div>
          <div class="ads-mini-stat"><span>进入门槛</span><strong>${escapeHtml(levelText(overview.entry_barrier))}</strong></div>
        </div>
      </article>
      <div class="module-grid">
        <article class="ads-card">
          <div class="section-title" style="margin-top: 0;">
            <h2>市场阶段</h2>
            <span class="badge ${levelClass(analysis.lifecycle && analysis.lifecycle.confidence)}">${escapeHtml(levelText(analysis.lifecycle && analysis.lifecycle.confidence))}</span>
          </div>
          ${listItems(analysis.lifecycle && analysis.lifecycle.evidence)}
        </article>
        <article class="ads-card">
          <div class="section-title" style="margin-top: 0;">
            <h2>竞争格局</h2>
            <span class="badge ${levelClass(analysis.competition && analysis.competition.level)}">${escapeHtml(levelText(analysis.competition && analysis.competition.level))}</span>
          </div>
          ${listItems(analysis.competition && analysis.competition.evidence)}
        </article>
      </div>
      <article class="ads-card">
        <div class="section-title" style="margin-top: 0;">
          <h2>趋势和市场指标</h2>
          <span class="feed-count">接口数据 + 本地竞品模型</span>
        </div>
        <div class="ads-metric-grid">
          <div class="ads-mini-stat"><span>市场热度</span><strong>${escapeHtml(levelText(overview.market_heat))}</strong></div>
          <div class="ads-mini-stat"><span>趋势变化</span><strong>${overview.sales_trend_delta === null || overview.sales_trend_delta === undefined ? "-" : `${Math.round(Number(overview.sales_trend_delta) * 100)}%`}</strong></div>
          <div class="ads-mini-stat"><span>参考竞品数</span><strong>${formatNumber(overview.peer_count)}</strong></div>
          <div class="ads-mini-stat"><span>品牌集中度</span><strong>${overview.brand_concentration === null || overview.brand_concentration === undefined ? "-" : `${escapeHtml(overview.brand_concentration)}%`}</strong></div>
          <div class="ads-mini-stat"><span>评论门槛</span><strong>${formatNumber(overview.review_barrier)}</strong></div>
          <div class="ads-mini-stat"><span>同类价格中位数</span><strong>${formatMoney(overview.median_peer_price)}</strong></div>
          <div class="ads-mini-stat"><span>价格跨度</span><strong>${overview.price_spread === null || overview.price_spread === undefined ? "-" : `${Math.round(Number(overview.price_spread) * 100)}%`}</strong></div>
          <div class="ads-mini-stat"><span>预估月营收</span><strong>${formatMoney(overview.estimated_monthly_revenue)}</strong></div>
        </div>
        ${renderTrend(record.trend_series)}
      </article>
      <div class="module-grid">
        <article class="ads-card">
          <h2 style="margin-top: 0;">商品快照</h2>
          <div class="ads-metric-grid">
            <div class="ads-mini-stat"><span>卖家类型</span><strong>${escapeHtml(snapshot.seller_type || "-")}</strong></div>
            <div class="ads-mini-stat"><span>卖家数量</span><strong>${escapeHtml(snapshot.seller_count ?? "-")}</strong></div>
            <div class="ads-mini-stat"><span>变体数</span><strong>${escapeHtml(snapshot.variant_count ?? "-")}</strong></div>
            <div class="ads-mini-stat"><span>页面质量分</span><strong>${escapeHtml(snapshot.listing_quality_score ?? "-")}</strong></div>
            <div class="ads-mini-stat"><span>价格位置</span><strong>${escapeHtml(snapshot.price_positioning || "-")}</strong></div>
            <div class="ads-mini-stat"><span>上架时长</span><strong>${snapshot.age_months === null || snapshot.age_months === undefined ? "-" : `${escapeHtml(snapshot.age_months)} 个月`}</strong></div>
            <div class="ads-mini-stat"><span>子类目排名</span><strong>${escapeHtml(snapshot.subcategory_rank || "-")}</strong></div>
            <div class="ads-mini-stat"><span>购物车归属</span><strong>${escapeHtml(snapshot.buy_box_owner || "-")}</strong></div>
            <div class="ads-mini-stat"><span>可售状态</span><strong>${escapeHtml(snapshot.availability || "-")}</strong></div>
            <div class="ads-mini-stat"><span>费用合计</span><strong>${formatMoney(snapshot.total_fees)}</strong></div>
          </div>
          ${listItems(snapshot.flags)}
        </article>
        <article class="ads-card">
          <h2 style="margin-top: 0;">下一步</h2>
          ${listItems(analysis.next_steps)}
        </article>
      </div>
      <div class="module-grid">
        <article class="ads-card">
          <div class="section-title" style="margin-top: 0;">
            <h2>页面评估</h2>
            <span class="badge ${levelClass(analysis.listing_analysis && analysis.listing_analysis.confidence)}">${escapeHtml(levelText(analysis.listing_analysis && analysis.listing_analysis.confidence))}</span>
          </div>
          <p>${escapeHtml(analysis.listing_analysis && analysis.listing_analysis.summary)}</p>
          <div class="copy-grid">
            <div class="copy-block"><h3>优势</h3>${listItems(analysis.listing_analysis && analysis.listing_analysis.strengths)}</div>
            <div class="copy-block"><h3>缺口</h3>${listItems(analysis.listing_analysis && analysis.listing_analysis.gaps)}</div>
            <div class="copy-block"><h3>风险提示</h3>${listItems(analysis.listing_analysis && analysis.listing_analysis.warnings)}</div>
          </div>
        </article>
        <article class="ads-card">
          <div class="section-title" style="margin-top: 0;">
            <h2>评论信号</h2>
            <span class="badge ${levelClass(analysis.review_analysis && analysis.review_analysis.confidence)}">${escapeHtml(levelText(analysis.review_analysis && analysis.review_analysis.confidence))}</span>
          </div>
          <p>${escapeHtml(analysis.review_analysis && analysis.review_analysis.summary)}</p>
          <div class="copy-grid">
            <div class="copy-block"><h3>痛点</h3>${listItems(analysis.review_analysis && analysis.review_analysis.pain_points)}</div>
            <div class="copy-block"><h3>购买驱动</h3>${listItems(analysis.review_analysis && analysis.review_analysis.purchase_drivers)}</div>
            <div class="copy-block"><h3>风险</h3>${listItems(analysis.review_analysis && analysis.review_analysis.risks)}</div>
          </div>
        </article>
      </div>
      <article class="ads-card">
        <div class="section-title" style="margin-top: 0;">
          <h2>参考竞品</h2>
          <span class="feed-count">${(record.compare_products || []).length} 个商品编号</span>
        </div>
        ${renderCompare(record.compare_products)}
      </article>
      ${renderEnrichment(record)}
    `;
  }

  function syncMarketButtons() {
    document.querySelectorAll("[data-asin-market]").forEach(button => {
      const active = button.dataset.asinMarket === selectedMarketplace;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderRecent() {
    const root = document.getElementById("recentAsins");
    if (!root) return;
    const items = readJsonState(RECENT_KEY);
    root.innerHTML = items.length
      ? items.map(asin => `<button class="btn small" type="button" data-asin-sample="${escapeHtml(asin)}">${escapeHtml(asin)}</button>`).join("")
      : `<span class="empty">暂无历史商品编号。</span>`;
  }

  async function analyzeAsin(value, options = {}) {
    const asin = normalizeAsin(value);
    const status = document.getElementById("asinAnalyzerStatus");
    const input = document.getElementById("asinInput");
    if (!isValidAsin(asin)) {
      if (status) status.textContent = "请输入 10 位商品编号。";
      return;
    }
    if (input) input.value = asin;
    saveRecent(asin);
    renderRecent();
    const localCase = options.forceRemote ? null : getLocalCase(asin);
    if (status) {
      status.textContent = localCase
        ? "正在读取本地商品编号判断数据。"
        : "正在调用实时数据接口。";
    }
    const record = localCase || await getCase(asin, { forceRemote: Boolean(options.forceRemote) });
    renderAnalysis(record);
    if (!status) return;
    if (record.mode === "data_missing") {
      status.textContent = "数据缺失：该商品编号暂未在本地候选池中，已加入待补全队列。";
    } else if (record.mode === "local_candidate_pool") {
      status.textContent = "已命中本地候选池。";
    } else if (record.mode === "jungle_scout_api_live") {
      status.textContent = "已调用实时接口并缓存该商品编号。";
    } else if (record.mode === "jungle_scout_api_cached") {
      status.textContent = "已命中实时接口本地缓存。";
    } else if (record.mode === "api_error") {
      status.textContent = "实时接口调用失败，已加入待补全队列。";
    } else {
      status.textContent = "已加载本地样例分析。";
    }
  }

  async function analyzeBatch(text) {
    const status = document.getElementById("asinAnalyzerStatus");
    const asins = extractAsins(text);
    if (!asins.length) {
      renderBatchResults([]);
      if (status) status.textContent = "未识别到有效商品编号。";
      return;
    }
    if (status) status.textContent = `正在判断 ${asins.length} 个商品编号；本地未命中项会调用实时接口。`;
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
      status.textContent = `已完成 ${asins.length} 个商品编号判断；实时接口 ${liveCount} 个，缓存 ${cachedCount} 个，失败 ${failedCount} 个。`;
    }
  }

  function clearBatch() {
    const input = document.getElementById("asinBatchInput");
    const file = document.getElementById("asinBatchFile");
    if (input) input.value = "";
    if (file) file.value = "";
    renderBatchResults([]);
    const status = document.getElementById("asinAnalyzerStatus");
    if (status) status.textContent = "批量输入已清空。";
  }

  async function init() {
    asinData = await loadFirst(DATA_PATHS, { samples: [], cases: {} });
    candidateProducts = window.ProductCandidateProvider
      ? await window.ProductCandidateProvider.loadCandidateProducts()
      : await loadFirst(["./data/product_research/candidate_products.json", "./data/candidate_products.json"], []);
    reviewPainPointRecords = await loadFirst(["./data/product_research/review_pain_points.json", "./data/review_pain_points.json"], []);

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
      if (action === "enhance-search" && currentRecord) {
        renderAnalysis(currentRecord);
        const status = document.getElementById("asinAnalyzerStatus");
        if (status) status.textContent = `已刷新${marketLabel(selectedMarketplace)}市场的增强搜索与爬虫摘要。`;
      }
      if (action === "clear-batch") clearBatch();
    });

    document.addEventListener("click", event => {
      const marketButton = event.target.closest("[data-asin-market]");
      if (!marketButton) return;
      selectedMarketplace = marketButton.dataset.asinMarket || "US";
      localStorage.setItem(MARKET_KEY, selectedMarketplace);
      syncMarketButtons();
      if (currentRecord) renderAnalysis(currentRecord);
      const status = document.getElementById("asinAnalyzerStatus");
      if (status) status.textContent = `已切换到${marketLabel(selectedMarketplace)}市场。`;
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
    syncMarketButtons();
    await analyzeAsin((asinData.samples && asinData.samples[0]) || "B0CGXQL7NK");
  }

  init().catch(error => {
    console.error(error);
    const root = document.getElementById("asinAnalysisContent");
    if (root) {
      root.innerHTML = `<article class="ads-card"><h3>商品编号判断模块加载失败</h3><p>${escapeHtml(error.message)}</p></article>`;
    }
  });
})();
