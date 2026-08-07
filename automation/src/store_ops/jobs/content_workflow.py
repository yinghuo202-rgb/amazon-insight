from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone

from ..config import ProjectConfig
from ..db import StateDb
from ..sku import SkuNormalizer
from .creative_briefs import read_creative_briefs
from .product_catalog import run as run_product_catalog


CJK_RE = re.compile(r"[\u3400-\u9fff]")


def _atomic_json(path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _text(value: object) -> str:
    return "" if value is None else str(value).strip()


def _copy_draft(item: dict) -> dict:
    listing = item.get("listing") or {}
    title = _text(listing.get("title"))
    bullets = [_text(value) for value in listing.get("bullets", []) if _text(value)]
    description = _text(listing.get("description"))
    source = "listing_master" if any((title, bullets, description)) else "structured_product_draft"
    product_name = _text(item.get("englishName")) or _text(item.get("productDescription")) or item["sku"]
    category = _text(item.get("category"))
    size = _text(item.get("shippingSizeCm"))
    packaging = _text(item.get("packaging"))
    if not title:
        title = " ".join(filter(None, ("MEASUREMAN", product_name, category, size)))
    fallback_bullets = [
        f"Product Type: {category or product_name}",
        f"Product Size: {size}" if size else "Product Size: Confirm final dimensions before publishing.",
        f"Packaging: {packaging}" if packaging else "Packaging: Confirm package contents before publishing.",
        "Key Features: Add verified material, accuracy, pressure range or performance claims.",
        "Application: Add the verified use cases and compatibility limits for this product.",
    ]
    bullets = (bullets + fallback_bullets[len(bullets):])[:5]
    if not description:
        description = " ".join(filter(None, (
            f"MEASUREMAN {product_name}.",
            f"Category: {category}." if category else "",
            f"Product size: {size}." if size else "",
            f"Packaging: {packaging}." if packaging else "",
            "Verify all technical specifications, compliance claims and package contents before publishing.",
        )))
    quality_flags = []
    if source != "listing_master":
        quality_flags.extend(["needs_ai_copy_refinement", "needs_keyword_research"])
    if CJK_RE.search(title + " ".join(bullets) + description):
        quality_flags.append("needs_english_copy")
    if len([value for value in listing.get("bullets", []) if _text(value)]) < 5:
        quality_flags.append("selling_points_incomplete")
    quality_flags.append("compliance_review_required")
    return {
        "source": source,
        "title": title,
        "bullets": bullets,
        "description": description,
        "qualityFlags": sorted(set(quality_flags)),
    }


def _generated_main_sections(item: dict, copy: dict) -> list[dict]:
    size = _text(item.get("shippingSizeCm"))
    packaging = _text(item.get("packaging"))
    bullets = copy["bullets"]
    requirements = [
        ("主图 1", "2000 × 2000", "", "纯白背景，产品主体占画面 85% 左右，不添加文案、边框或装饰物。"),
        ("主图 2", "2000 × 2000", bullets[0], "展示核心卖点，使用产品 45° 视角和不超过 3 个简洁图标。"),
        ("主图 3", "2000 × 2000", bullets[1], f"尺寸与接口标注图；当前产品尺寸：{size or '待工程确认'}。"),
        ("主图 4", "2000 × 2000", bullets[2], "材料、结构或关键部件特写，所有性能词需有产品资料支持。"),
        ("主图 5", "2000 × 2000", bullets[3], "使用场景图，产品必须符合真实安装方向和比例。"),
        ("主图 6", "2000 × 2000", f"Package Includes · {packaging or '待确认'}", "包装清单平铺展示，不加入未随产品提供的配件。"),
        ("主图 7", "2000 × 2000", bullets[4], "应用范围或兼容性说明，避免未经验证的绝对化宣传。"),
    ]
    return [{"section": section, "channel": "main_image", "size": size_value, "copy": copy_value, "requirement": requirement, "sourceRow": None} for section, size_value, copy_value, requirement in requirements]


def _generated_aplus_sections(item: dict, copy: dict) -> list[dict]:
    bullets = copy["bullets"]
    product_name = _text(item.get("englishName")) or _text(item.get("productDescription")) or item["sku"]
    requirements = [
        ("品牌横幅", "1464 × 600 / 600 × 450", copy["title"], "产品与真实使用场景结合，保留移动端安全区。"),
        ("核心优势", "1464 × 600 / 600 × 450", "\n".join(bullets[:3]), "用 3 个图标呈现已验证的核心优势，减少大段文字。"),
        ("结构细节", "1464 × 600 / 600 × 450", bullets[3], "展示材料、接口、表盘或关键结构的局部特写。"),
        ("应用场景", "1464 × 600 / 600 × 450", bullets[4], "展示 3–4 个真实应用场景，避免不兼容场景。"),
        ("规格与包装", "1464 × 600 / 600 × 450", f"{product_name}\n{copy['description']}", "整理规格、尺寸、包装清单和注意事项；提交前由工程复核。"),
    ]
    return [{"section": section, "channel": "a_plus", "size": size_value, "copy": copy_value, "requirement": requirement, "sourceRow": None} for section, size_value, copy_value, requirement in requirements]


def run(config: ProjectConfig, db: StateDb) -> dict:
    run_id = db.start_run("build-content-workflow")
    try:
        product_catalog_path = config.runtime_root / "reports" / "product_catalog.json"
        if not product_catalog_path.exists():
            run_product_catalog(config, db)
        product_catalog = json.loads(product_catalog_path.read_text(encoding="utf-8"))
        normalizer = SkuNormalizer(config.sku_pattern, config.ignore_values)
        briefs, exceptions = read_creative_briefs(config, normalizer)
        briefs_by_sku: dict[str, list[dict]] = defaultdict(list)
        for brief in briefs:
            for sku in brief["skus"]:
                briefs_by_sku[sku].append(brief)
        for sku_briefs in briefs_by_sku.values():
            sku_briefs.sort(key=lambda brief: brief["modifiedAt"], reverse=True)

        tasks = []
        for item in product_catalog["items"]:
            sku = item["sku"]
            copy = _copy_draft(item)
            sku_briefs = briefs_by_sku.get(sku, [])
            main_brief = next((brief for brief in sku_briefs if any(section["channel"] == "main_image" for section in brief["sections"])), None)
            aplus_brief = next((brief for brief in sku_briefs if any(section["channel"] == "a_plus" for section in brief["sections"])), None)
            main_sections = [section for section in main_brief["sections"] if section["channel"] == "main_image"] if main_brief else []
            aplus_sections = [section for section in aplus_brief["sections"] if section["channel"] == "a_plus"] if aplus_brief else []
            main_from_archive = bool(main_sections)
            aplus_from_archive = bool(aplus_sections)
            if not main_sections:
                main_sections = _generated_main_sections(item, copy)
            if not aplus_sections:
                aplus_sections = _generated_aplus_sections(item, copy)
            tasks.append({
                "sku": sku,
                "productName": _text(item.get("productDescription")) or _text(item.get("englishName")) or sku,
                "category": _text(item.get("category")),
                "imageFile": _text(item.get("imageFile")),
                "status": "draft_review_required",
                "copy": copy,
                "mainImageBrief": {
                    "source": "creative_archive" if main_from_archive else "generated_template",
                    "sections": main_sections,
                },
                "aPlusBrief": {
                    "source": "creative_archive" if aplus_from_archive else "generated_template",
                    "sections": aplus_sections,
                },
                "sourceBriefIds": [brief["briefId"] for brief in sku_briefs],
            })

        generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        creative_payload = {
            "schemaVersion": 1,
            "generatedAt": generated_at,
            "briefs": briefs,
            "exceptions": exceptions,
        }
        workflow_payload = {
            "schemaVersion": 1,
            "generatedAt": generated_at,
            "summary": {
                "taskCount": len(tasks),
                "listingMasterCount": sum(1 for task in tasks if task["copy"]["source"] == "listing_master"),
                "generatedCopyCount": sum(1 for task in tasks if task["copy"]["source"] != "listing_master"),
                "mainImageArchiveCount": sum(1 for task in tasks if task["mainImageBrief"]["source"] == "creative_archive"),
                "aPlusArchiveCount": sum(1 for task in tasks if task["aPlusBrief"]["source"] == "creative_archive"),
                "archiveBriefCount": len(briefs),
                "mappedArchiveBriefCount": sum(1 for brief in briefs if brief["skus"]),
                "exceptionCount": len(exceptions),
            },
            "tasks": tasks,
        }
        _atomic_json(config.runtime_root / "reports" / "creative_briefs.json", creative_payload)
        output = config.runtime_root / "reports" / "content_workflow.json"
        _atomic_json(output, workflow_payload)
        summary = {"status": "completed", "output": str(output), **workflow_payload["summary"]}
        db.finish_run(run_id, "completed", summary=summary)
        return summary
    except Exception as error:
        db.finish_run(run_id, "failed", error=repr(error))
        raise
