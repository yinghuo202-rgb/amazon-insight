(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LlmProvider = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const SUPPORTED_TASKS = new Set([
    "ads_optimization",
    "product_recommendation_explanation",
    "asin_screening_explanation",
    "review_pain_point_summary",
    "daily_report_summary"
  ]);

  function buildMockOutput(taskType, input) {
    return {
      provider: "mock",
      model: "local_mock",
      taskType,
      summary: `Mock LLM output for ${taskType}.`,
      recommendations: Array.isArray(input && input.recommendations) ? input.recommendations : [],
      safety: {
        external_request_made: false,
        requires_local_approval: true
      }
    };
  }

  async function runMockLLM({ taskType, input = {}, options = {} }) {
    if (!SUPPORTED_TASKS.has(taskType)) {
      throw new Error(`Unsupported LLM taskType: ${taskType}`);
    }
    return {
      taskType,
      input,
      output: buildMockOutput(taskType, input),
      provider: "mock",
      model: options.model || "local_mock",
      created_at: new Date().toISOString(),
      source_data_reference: options.source_data_reference || "",
      error: ""
    };
  }

  async function runDeepSeek() {
    throw new Error("DeepSeek provider is not enabled. Configure config/llm.config.local.json in a backend/local script before use.");
  }

  async function runOpenAI() {
    throw new Error("OpenAI provider is not enabled. Configure config/llm.config.local.json in a backend/local script before use.");
  }

  async function runLocalLLM(args) {
    return runMockLLM({ ...args, options: { ...(args && args.options), model: "local_placeholder" } });
  }

  async function runLLM(args) {
    return runMockLLM(args);
  }

  return {
    SUPPORTED_TASKS,
    runLLM,
    runMockLLM,
    runDeepSeek,
    runOpenAI,
    runLocalLLM
  };
});
