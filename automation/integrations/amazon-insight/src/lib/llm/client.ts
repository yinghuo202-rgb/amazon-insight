import { buildTemplateInspiration } from "@/lib/analysis";
import {
  briefReportPayloadSchema,
  type AnalysisResponse,
  type BriefReportPayload,
  type CandidateProduct,
  type ManualInputs,
} from "@/lib/contracts";
import {
  extractKeySentences,
  formatCompactNumber,
  formatCurrency,
  levelLabel,
  modeLabel,
  stageLabel,
} from "@/lib/utils";

type TemplateInput = {
  product: CandidateProduct;
  analysis: AnalysisResponse;
  manualInputs: ManualInputs;
};

type BriefReportInput = {
  product: CandidateProduct;
  compareProducts: CandidateProduct[];
  analysis: AnalysisResponse;
  notes?: string;
};

type OpenAiCompatibleConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
};

export type InspirationAdapter = {
  provider: string;
  model: string | null;
  mode: "live" | "rule_based" | "unavailable";
  generateInspiration: (input: TemplateInput) => Promise<ReturnType<typeof buildTemplateInspiration>>;
  generateBriefReport: (input: BriefReportInput) => Promise<BriefReportPayload>;
};

function resolveLiveConfig(): OpenAiCompatibleConfig | null {
  const provider = process.env.LLM_PROVIDER?.trim() || "disabled";
  const apiKey = process.env.LLM_API_KEY?.trim() || "";
  const model = process.env.LLM_MODEL?.trim() || "";
  const baseUrl = (process.env.LLM_API_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const timeoutMs = Number.parseInt(process.env.LLM_TIMEOUT_MS?.trim() || "30000", 10);

  if (provider === "disabled" || !apiKey || !model) {
    return null;
  }

  return {
    provider,
    model,
    apiKey,
    baseUrl,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(timeoutMs, 5000) : 30000,
  };
}

function parseJsonContent(content: string) {
  const trimmed = content.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed) as unknown;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]) as unknown;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  }

  throw new Error("LLM response did not contain valid JSON.");
}

function buildTemplateBriefReport(input: BriefReportInput, fallbackNote?: string): BriefReportPayload {
  const { product, compareProducts, analysis, notes = "" } = input;
  const focusNotes = extractKeySentences(notes, 3);
  const leadingCompare = compareProducts[0];
  const opportunityLabel = levelLabel(analysis.marketOverview.opportunityLevel);
  const competitionLabel = levelLabel(analysis.competition.level);
  const lifecycleLabel = stageLabel(analysis.lifecycle.stage);
  const verdict =
    analysis.marketOverview.opportunityLevel === "high"
      ? "建议继续推进到供应链验证和样品评估。"
      : analysis.marketOverview.opportunityLevel === "medium"
        ? "建议保留在观察名单中，先验证差异化是否真实可做。"
        : "建议谨慎推进，除非你已经有明确的成本或产品结构优势。";

  const summary = [
    `${product.title} 当前更接近${lifecycleLabel}市场，机会等级${opportunityLabel}，竞争强度${competitionLabel}。`,
    analysis.marketOverview.summary,
    leadingCompare
      ? `当前主要参考竞品是 ${leadingCompare.title}，可重点对比价格带、评论门槛和卖点表达。`
      : "当前没有附带参考竞品，建议至少补一个对照款验证判断。",
    focusNotes[0] ? `当前手工关注点：${focusNotes[0]}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const keySignals = [
    analysis.lifecycle.evidence[0],
    analysis.lifecycle.evidence[1],
    analysis.competition.evidence[0],
    analysis.listingAnalysis?.gaps[0] ? `Listing 缺口：${analysis.listingAnalysis.gaps[0]}` : "",
    analysis.reviewAnalysis?.painPoints[0] ? `评论侧痛点：${analysis.reviewAnalysis.painPoints[0]}` : "",
    product.price !== null ? `当前售价约 ${formatCurrency(product.price)}。` : "",
    product.reviews !== null ? `评论量约 ${formatCompactNumber(product.reviews)}。` : "",
  ]
    .filter(Boolean)
    .slice(0, 5);

  const risks = [
    analysis.reviewAnalysis?.risks[0] || "评论文本覆盖有限，建议继续用真实评论做二次校验。",
    analysis.listingAnalysis?.warnings[0] || "当前卖点表达可能不足以支撑显著溢价。",
    analysis.competition.entryDifficulty === "high"
      ? "当前进入门槛偏高，投放和冷启动成本需要保守估计。"
      : "门槛不算最高，但仍需确认供应链、成本和质检可控。",
    fallbackNote || "",
  ]
    .filter(Boolean)
    .slice(0, 4);

  const nextSteps = [
    "补 2 到 3 个直接竞品，对比价格、评论门槛和主卖点结构。",
    analysis.reviewAnalysis?.painPoints[0]
      ? `围绕“${analysis.reviewAnalysis.painPoints[0]}”验证是否能做出真实改良。`
      : "继续抓取或整理真实评论，确认痛点是否集中。",
    analysis.marketOverview.opportunityLevel === "high"
      ? "进入样品、成本和包装方案验证，判断是否值得进入下一轮。"
      : "先验证差异化路径，再决定是否进入样品和报价阶段。",
    focusNotes[1] ? `把“${focusNotes[1]}”加入下一轮验证清单。` : "",
  ]
    .filter(Boolean)
    .slice(0, 4);

  return briefReportPayloadSchema.parse({
    headline: `${product.title} 一页简报`,
    verdict,
    summary,
    keySignals,
    risks,
    nextSteps,
    generationMeta: {
      provider: "template-disabled-llm",
      model: null,
      mode: "rule_based" as const,
      manualInputsUsed: focusNotes.length > 0 ? ["notes"] : [],
      notes: [
        "当前结果基于结构化分析和模板规则生成，没有伪装成实时模型结论。",
        `报告模式：${modeLabel("rule_based")}。`,
        fallbackNote || "",
      ].filter(Boolean),
      generatedAt: new Date().toISOString(),
    },
    mode: "rule_based" as const,
  });
}

async function generateBriefReportWithProvider(
  config: OpenAiCompatibleConfig,
  input: BriefReportInput,
): Promise<BriefReportPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const context = {
      product: {
        asin: input.product.asin,
        title: input.product.title,
        brand: input.product.brand,
        category: input.product.category,
        price: input.product.price,
        rating: input.product.rating,
        reviews: input.product.reviews,
        monthlyUnits: input.product.monthlyUnits,
        monthlyRevenue: input.product.monthlyRevenue,
      },
      compareProducts: input.compareProducts.map((product) => ({
        asin: product.asin,
        title: product.title,
        brand: product.brand,
        price: product.price,
        rating: product.rating,
        reviews: product.reviews,
        monthlyRevenue: product.monthlyRevenue,
      })),
      analysis: {
        summary: input.analysis.summary,
        recommendation: input.analysis.recommendation,
        lifecycle: input.analysis.lifecycle,
        competition: input.analysis.competition,
        marketOverview: input.analysis.marketOverview,
        productSnapshot: input.analysis.productSnapshot,
        listingAnalysis: input.analysis.listingAnalysis,
        reviewAnalysis: input.analysis.reviewAnalysis,
        missingData: input.analysis.missingData,
      },
      notes: input.notes || "",
    };

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是 Amazon 选品研究分析助手。只能使用给定数据，不要编造不存在的精确数字或评论事实。请输出简洁中文 JSON，字段必须严格是 headline, verdict, summary, keySignals, risks, nextSteps。每个数组 3 到 5 条，summary 控制在 120 到 220 字。",
          },
          {
            role: "user",
            content: JSON.stringify(context),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("LLM returned empty content.");
    }

    const parsed = briefReportPayloadSchema.parse(parseJsonContent(content));
    return {
      ...parsed,
      generationMeta: {
        ...parsed.generationMeta,
        provider: config.provider,
        model: config.model,
        mode: "live",
        manualInputsUsed: input.notes?.trim() ? ["notes"] : [],
        notes: [
          "该简报由大模型基于当前结构化数据生成。",
          ...(parsed.generationMeta.notes ?? []),
        ].slice(0, 5),
        generatedAt: new Date().toISOString(),
      },
      mode: "live",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function getLlmAdapter(): InspirationAdapter {
  const liveConfig = resolveLiveConfig();

  return {
    provider: liveConfig?.provider || process.env.LLM_PROVIDER?.trim() || "disabled",
    model: liveConfig?.model || null,
    mode: liveConfig ? "live" : "rule_based",
    async generateInspiration(input) {
      return buildTemplateInspiration(input);
    },
    async generateBriefReport(input) {
      if (!liveConfig) {
        return buildTemplateBriefReport(input);
      }

      try {
        return await generateBriefReportWithProvider(liveConfig, input);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "大模型调用失败，已自动回退到规则摘要。";
        return buildTemplateBriefReport(input, `大模型调用失败，已自动回退到规则摘要：${message}`);
      }
    },
  };
}
