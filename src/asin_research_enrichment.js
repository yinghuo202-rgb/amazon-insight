(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AsinResearchEnrichment = api;
  if (typeof window !== "undefined") window.AsinResearchEnrichment = api;
  if (typeof globalThis !== "undefined") globalThis.AsinResearchEnrichment = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const MARKETS = {
    US: {
      label: "美国",
      domain: "amazon.com",
      currency: "美元",
      baseline: "需求容量最大，适合先验证搜索量、评论门槛和价格带。",
      risk: "平台竞争强，专利和产品责任风险需要前置排查。"
    },
    CA: {
      label: "加拿大",
      domain: "amazon.ca",
      currency: "加元",
      baseline: "市场容量小于美国，但季节、户外、房车和防冻类需求更集中。",
      risk: "双语包装、冬季区域需求和配送成本需要单独评估。"
    },
    IT: {
      label: "意大利",
      domain: "amazon.it",
      currency: "欧元",
      baseline: "适合验证欧洲小体积配件、园艺、车库和汽车边缘类目。",
      risk: "欧盟合规、包装责任、语言本地化和增值税成本会影响进入门槛。"
    }
  };

  function textOf(product = {}) {
    return [
      product.title,
      product.category,
      product.product_type,
      product.sub_scenario,
      product.seasonal_attribute,
      ...(product.keywords || [])
    ].join(" ").toLowerCase();
  }

  function productFamily(product = {}) {
    const text = textOf(product);
    if (text.includes("label maker")) return "label_maker";
    if (text.includes("faucet") || text.includes("spigot") || text.includes("freeze")) return "faucet_cover";
    if (text.includes("hose storage") || text.includes("storage bag")) return "hose_storage";
    if (text.includes("door edge") || text.includes("edge guard")) return "automotive_edge_guard";
    if (text.includes("pressure regulator") || text.includes("pressure reducer")) return "pressure_regulator";
    if (text.includes("pressure gauge")) return "pressure_gauge";
    if (text.includes("inline water filter") || text.includes("water filter")) return "water_filter";
    if (text.includes("quick connect") || text.includes("connector") || text.includes("fitting")) return "hose_connector";
    if (text.includes("wheel chock")) return "wheel_chock";
    if (text.includes("hook")) return "garage_hook";
    return "general_accessory";
  }

  function familyName(family) {
    return {
      label_maker: "蓝牙标签打印机",
      faucet_cover: "户外水龙头防冻保护罩",
      hose_storage: "房车或花园水管收纳袋",
      automotive_edge_guard: "汽车车门边缘防护条",
      pressure_regulator: "水压调节阀",
      pressure_gauge: "压力表",
      water_filter: "房车水路过滤器",
      hose_connector: "水管接头",
      wheel_chock: "拖车轮挡",
      garage_hook: "车库挂钩",
      general_accessory: "通用配件"
    }[family] || "通用配件";
  }

  function usageScenarios(family, market) {
    const common = {
      faucet_cover: ["冬季户外水龙头防冻", "住宅花园水管接口保护", "房车营地低温维护"],
      hose_storage: ["房车水管分类收纳", "车库和仓库整理", "露营后湿水管隔离存放"],
      automotive_edge_guard: ["车门边缘防磕碰", "二手车外观维护", "停车空间狭窄场景"],
      pressure_regulator: ["房车营地接水保护", "花园灌溉压力控制", "临时水路设备保护"],
      pressure_gauge: ["家庭水压检测", "水管和水泵维护", "灌溉系统调试"],
      water_filter: ["房车饮用水过滤", "露营供水改善", "花园水源预过滤"],
      hose_connector: ["花园水管快速连接", "灌溉系统扩展", "户外清洗换接"],
      wheel_chock: ["拖车驻车防滑", "房车营地固定", "车库维护安全"],
      garage_hook: ["车库墙面收纳", "园艺工具上墙", "冬季室内整理"],
      label_maker: ["家庭收纳标签", "小办公室耗材管理", "手账和礼品标记"],
      general_accessory: ["户外维护", "车库整理", "轻量替换配件"]
    }[family] || [];
    if (market === "CA" && family === "faucet_cover") return ["加拿大冬季防冻", ...common.slice(0, 2)];
    if (market === "IT" && family === "hose_connector") return ["意大利庭院灌溉", "阳台园艺维护", "水管换接"];
    return common;
  }

  function reviewThemes(family) {
    return {
      faucet_cover: {
        positives: ["保温厚度", "安装快", "绑带牢固"],
        negatives: ["尺寸不适配", "极寒效果不足", "外壳开裂"],
        questions: ["是否覆盖常见龙头尺寸", "是否有极寒测试说明", "绑带是否耐用"]
      },
      hose_storage: {
        positives: ["收纳清晰", "防水", "容量足"],
        negatives: ["拉链坏", "布料薄", "提手断裂"],
        questions: ["是否能放下常见房车水管", "湿水管是否会渗漏", "拉链是否防锈"]
      },
      automotive_edge_guard: {
        positives: ["安装简单", "外观不突兀", "防磕碰"],
        negatives: ["胶不牢", "发黄", "尺寸不准"],
        questions: ["是否适配曲面车门", "高温暴晒后是否脱胶", "是否影响关门"]
      },
      label_maker: {
        positives: ["连接方便", "体积小", "模板多"],
        negatives: ["应用不稳定", "耗材贵", "打印偏移"],
        questions: ["应用是否稳定", "耗材是否通用", "是否支持多语言"]
      },
      general_accessory: {
        positives: ["安装简单", "价格可接受", "用途清晰"],
        negatives: ["材质弱", "包装破损", "说明不清"],
        questions: ["核心尺寸是否明确", "包装能否抗运输", "售后问题是否集中"]
      }
    }[family] || {
      positives: ["使用简单", "价格合理", "场景清晰"],
      negatives: ["质量波动", "尺寸不准", "说明不清"],
      questions: ["尺寸是否完整", "材料是否稳定", "差评是否集中"]
    };
  }

  function restrictionRisks(family, market, product = {}) {
    const seasonal = {
      faucet_cover: market === "CA" ? "加拿大旺季更早，建议 7-8 月完成上架和广告预热。" : "冬季防冻品需要提前 90-120 天布局，迟到会错过自然排名积累。",
      hose_storage: "春夏房车和庭院维护更强，淡季以观察和低库存测试为主。",
      automotive_edge_guard: "季节性较弱，但春夏自驾和车辆维护期会有小幅提升。",
      label_maker: "开学季、年末整理和办公室补货有节点，但不属于强季节品。"
    }[family] || "季节性不强，按搜索趋势和库存周转决定进入节奏。";

    const patentLevel = ["label_maker", "automotive_edge_guard", "faucet_cover"].includes(family) ? "中" : "低";
    const exportLevel = ["pressure_regulator", "water_filter", "label_maker"].includes(family) ? "中" : "低";
    const complianceLevel = market === "IT" ? "中" : ["pressure_regulator", "water_filter", "label_maker"].includes(family) ? "中" : "低";

    return [
      {
        type: "出口限制",
        level: exportLevel,
        note: exportLevel === "中"
          ? "涉及水路、电子或过滤功能时，需要核对材质声明、用途描述、海关编码和目的国抽检要求。"
          : "普通配件出口限制较低，但仍需确认材质、包装和申报品名一致。"
      },
      {
        type: "专利外观",
        level: patentLevel,
        note: patentLevel === "中"
          ? "需要检索外观、结构和品牌词，避免复制头部竞品造型、固定方式或页面表达。"
          : "专利风险较低，但仍要避开竞品图案、品牌词和独特结构。"
      },
      {
        type: "季节窗口",
        level: family === "faucet_cover" ? "高" : "中",
        note: seasonal
      },
      {
        type: "合规认证",
        level: complianceLevel,
        note: market === "IT"
          ? "进入意大利需关注欧盟包装责任、语言标签、增值税和可能的材料合规要求。"
          : "美国和加拿大需重点核对儿童警示、材料安全、饮用水接触声明和平台类目要求。"
      },
      {
        type: "市场本地化",
        level: market === "US" ? "低" : "中",
        note: market === "CA"
          ? "加拿大建议准备英法双语包装或说明，并单独测算尾程和退货成本。"
          : market === "IT"
            ? "意大利需要本地语言标题、尺寸单位、售后说明和欧盟责任主体信息。"
            : "美国市场可先验证主图、关键词和评论痛点，再决定是否扩展到其他站点。"
      }
    ];
  }

  function searchTasks(product, family, market) {
    const name = familyName(family);
    const marketInfo = MARKETS[market] || MARKETS.US;
    return [
      {
        source: "前台搜索",
        query: `${name} ${marketInfo.domain} 价格 评论`,
        purpose: "验证真实搜索结果、价格带、主图表达和头部品牌集中度。"
      },
      {
        source: "评论爬取",
        query: `${name} 差评 尺寸 材质 安装`,
        purpose: "抽取高频差评，补充退货、安装、适配和耐用性风险。"
      },
      {
        source: "使用场景搜索",
        query: `${name} 使用场景 购买原因 替代方案`,
        purpose: "确认买家是谁、为什么买、在哪些场景使用。"
      },
      {
        source: "专利和合规初筛",
        query: `${name} patent design compliance export`,
        purpose: "形成专利、出口、认证和平台限制的待核验清单。"
      }
    ];
  }

  function scoreForMarket(market, family, product = {}) {
    const base = Number(product.monthly_units || product.estimated_monthly_sales || 80);
    const multiplier = market === "US" ? 1 : market === "CA" ? 0.32 : 0.22;
    const seasonalBoost = market === "CA" && family === "faucet_cover" ? 1.25 : market === "IT" && ["hose_connector", "hose_storage"].includes(family) ? 1.12 : 1;
    return Math.max(5, Math.round(base * multiplier * seasonalBoost));
  }

  function enrich({ product = {}, analysis = {}, compareProducts = [], marketplace = "US" } = {}) {
    const market = MARKETS[marketplace] ? marketplace : "US";
    const family = productFamily(product);
    const themes = reviewThemes(family);
    const marketInfo = MARKETS[market];
    const estimatedUnits = scoreForMarket(market, family, product);
    return {
      marketplace: market,
      market_label: marketInfo.label,
      marketplace_domain: marketInfo.domain,
      product_family: family,
      product_name_cn: familyName(family),
      crawler_summary: {
        status: "本地增强任务已生成",
        mode: "本地模拟爬虫摘要",
        source_count: 4,
        note: "当前前端先生成可执行的搜索和爬虫任务；真实外部抓取建议放到本地代理或后端执行。"
      },
      market_snapshot: {
        demand_note: marketInfo.baseline,
        risk_note: marketInfo.risk,
        estimated_units: estimatedUnits,
        price_note: market === "US" ? "优先对齐美国主价格带。" : market === "CA" ? "需单独换算加元价格和尾程成本。" : "需单独核算欧元价格、税费和本地配送。",
        competitor_note: compareProducts.length ? `已有 ${compareProducts.length} 个参考竞品可用于横向对照。` : "参考竞品不足，需要通过前台搜索补齐。"
      },
      usage_scenarios: usageScenarios(family, market),
      positioning: [
        `目标买家：${family === "label_maker" ? "家庭收纳和小办公室用户" : family.includes("automotive") ? "汽车维护和外观保护用户" : "房车、庭院、车库维护用户"}。`,
        `市场定位：低到中复杂度配件，核心卖点应围绕尺寸适配、材料稳定和安装便利。`,
        `差异化方向：用配件组合、清晰尺寸图、真实场景图和差评痛点修复来避开同质化。`
      ],
      review_enrichment: {
        positive_drivers: themes.positives,
        negative_themes: themes.negatives,
        questions_to_scrape: themes.questions
      },
      restriction_risks: restrictionRisks(family, market, product),
      crawler_tasks: searchTasks(product, family, market)
    };
  }

  return {
    MARKETS,
    enrich,
    productFamily,
    familyName
  };
});
