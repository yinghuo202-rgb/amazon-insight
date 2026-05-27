const fs = require("fs");
const path = require("path");

const { ROOT, ensureDir, readJsonFirst, writeJson } = require("./data_paths");

const EXPORT_DIR = path.join(ROOT, "input", "browser_exports", "jungle_scout");
const TASKS_PATH = "data/product_research/jungle_scout_keyword_tasks.json";
const README_PATH = path.join(EXPORT_DIR, "README.md");

const THEME_KEYWORDS = {
  water_pressure_control_expansion: [
    "rv water pressure regulator",
    "garden hose pressure regulator",
    "hose shut off valve",
    "hose splitter valve",
    "flow control valve",
    "pressure regulator adapter"
  ],
  water_filtration_expansion: [
    "rv inline water filter",
    "rv water filter stand",
    "garden hose inline filter",
    "water filter hose adapter",
    "rv water filter hose"
  ],
  protection_expansion: [
    "outdoor faucet cover",
    "outdoor faucet freeze protection",
    "rv winterization adapter",
    "winter hose bib cover",
    "garden hose freeze protector"
  ],
  flow_control_expansion: [
    "garden hose quick connect",
    "brass hose shut off valve",
    "garden hose connector",
    "pressure washer hose connector",
    "garden hose valve splitter"
  ]
};

const FALLBACK_KEYWORDS = [
  "rv winterization adapter",
  "garden hose quick connect",
  "outdoor faucet cover",
  "rv inline water filter",
  "hose shut off valve",
  "pressure washer hose connector"
];

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 70);
}

function todaySlug() {
  return new Date().toISOString().slice(0, 10);
}

function uniqueByKeyword(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.keyword.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildKeywordItems(expansionOpportunities) {
  const opportunities = Array.isArray(expansionOpportunities?.opportunities)
    ? expansionOpportunities.opportunities
    : [];

  const generated = [];
  opportunities
    .slice()
    .sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0))
    .forEach(opportunity => {
      const keywords = THEME_KEYWORDS[opportunity.theme_id] || [];
      keywords.forEach((keyword, index) => {
        generated.push({
          keyword,
          source_theme_id: opportunity.theme_id,
          source_theme_label: opportunity.label || opportunity.theme_id,
          source_priority_score: Number(opportunity.priority_score || 50),
          target_product_types: opportunity.target_product_types || [],
          target_sub_scenarios: opportunity.target_sub_scenarios || [],
          preferred_price_band: opportunity.preferred_price_band || "20_80",
          rank_hint: index + 1
        });
      });
    });

  if (!generated.length) {
    FALLBACK_KEYWORDS.forEach((keyword, index) => {
      generated.push({
        keyword,
        source_theme_id: "fallback_store_expansion",
        source_theme_label: "Fallback store expansion",
        source_priority_score: 50,
        target_product_types: [],
        target_sub_scenarios: [],
        preferred_price_band: "20_80",
        rank_hint: index + 1
      });
    });
  }

  return uniqueByKeyword(generated)
    .map(item => ({
      ...item,
      priority_score: item.source_priority_score * 10 - item.rank_hint
    }))
    .sort((a, b) => b.priority_score - a.priority_score);
}

function buildTasks(keywordItems, profileSummary) {
  const createdAt = new Date().toISOString();
  const date = todaySlug();
  return keywordItems.slice(0, 12).map((item, index) => {
    const fileName = `${String(index + 1).padStart(2, "0")}_${slugify(item.keyword)}_${date}.csv`;
    return {
      task_id: `js_keyword_${date}_${String(index + 1).padStart(2, "0")}`,
      keyword: item.keyword,
      marketplace: profileSummary?.marketplace || "US",
      source_theme_id: item.source_theme_id,
      source_theme_label: item.source_theme_label,
      priority_score: item.priority_score,
      status: "pending_export",
      export_target_path: `input/browser_exports/jungle_scout/${fileName}`,
      browser_plugin: "Jungle Scout Extension",
      suggested_filters: {
        marketplace: "Amazon US",
        price_focus: "$20-$80",
        monthly_sales_min: 30,
        avoid_exact_store_duplicates: true,
        preferred_complexity: "low_to_medium"
      },
      target_product_types: item.target_product_types,
      target_sub_scenarios: item.target_sub_scenarios,
      notes: "Use Edge with the logged-in Jungle Scout extension, export CSV, then place the file at export_target_path.",
      created_at: createdAt
    };
  });
}

function writeReadme(tasks) {
  const lines = [
    "# Jungle Scout Browser Export Drop Folder",
    "",
    "Put Jungle Scout CSV exports in this folder, then run:",
    "",
    "```powershell",
    "npm run import:jungle-scout",
    "```",
    "",
    "Current keyword tasks:",
    ""
  ];

  tasks.forEach(task => {
    lines.push(`- ${task.task_id}: ${task.keyword}`);
    lines.push(`  Target file: ${task.export_target_path}`);
  });

  fs.writeFileSync(README_PATH, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  ensureDir(EXPORT_DIR);
  const profileSummary = readJsonFirst(["data/store/store_profile_summary.json"], {});
  const expansionOpportunities = readJsonFirst(["data/store/store_expansion_opportunities.json"], {});
  const keywordItems = buildKeywordItems(expansionOpportunities);
  const tasks = buildTasks(keywordItems, profileSummary);
  const outputPath = writeJson(TASKS_PATH, {
    generated_at: new Date().toISOString(),
    marketplace: profileSummary?.marketplace || "US",
    source: "store_profile_expansion_opportunities",
    task_count: tasks.length,
    tasks
  });
  writeReadme(tasks);

  console.log(JSON.stringify({
    output: outputPath,
    export_dir: EXPORT_DIR,
    task_count: tasks.length,
    top_keywords: tasks.slice(0, 8).map(task => task.keyword)
  }, null, 2));
}

main();
