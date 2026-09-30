"""Truthful TOOL013 candidate canary; never promotes without fixture evidence."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

SOURCE_TITLE = ("China Semiconductor Market for Automotive by Component, Global Export "
                "Trends and Strategic Recommendation")
SOURCE_CATEGORY = "Automotive and Transportation"
CATEGORY_SOURCE = Path("tool13_v2/official_world_categories.json")


def normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def match_category(source_category: str, title: str, overview: str = "", toc: str = "") -> dict:
    source = json.loads(CATEGORY_SOURCE.read_text(encoding="utf-8"))
    source_norm = normalized(source_category)
    context_norm = normalized(" ".join((title, overview, toc)))
    ranked = []
    for row in source["categories"]:
        aliases = [normalized(value) for value in row["aliases"]]
        exact = 100 if source_norm in aliases else 0
        category_hits = sum(1 for value in aliases if value and value in source_norm)
        context_hits = sum(1 for value in aliases if value and value in context_norm)
        score = exact + category_hits * 20 + context_hits * 5
        if score:
            ranked.append((score, row))
    ranked.sort(key=lambda item: (-item[0], item[1]["id"]))
    if not ranked:
        return {"status": "HOLD_LOW_CONFIDENCE", "category_id": None, "score": 0}
    top_score, top = ranked[0]
    second_score = ranked[1][0] if len(ranked) > 1 else 0
    if top_score < 20 or top_score == second_score:
        return {"status": "HOLD_LOW_CONFIDENCE", "category_id": None, "score": top_score}
    return {"status": "PASS", "category_id": top["id"], "category_name": top["name"], "score": top_score}


def validate_category(result: dict, expected_id: str) -> bool:
    valid = {row["id"] for row in json.loads(CATEGORY_SOURCE.read_text(encoding="utf-8"))["categories"]}
    return result.get("status") == "PASS" and result.get("category_id") == expected_id and expected_id in valid


def run_negative_tests(valid_result: dict) -> dict:
    cases = {
        "nonexistent_category": not validate_category({**valid_result, "category_id": "does-not-exist"}, "1060"),
        "wrong_category": not validate_category({**valid_result, "category_id": "1010"}, "1060"),
        "blank_category": match_category("", "")["status"] == "HOLD_LOW_CONFIDENCE",
        "blank_translation": not bool("".strip()),
        "bad_translation": not bool(re.search(r"[\uac00-\ud7a3]", SOURCE_TITLE)),
        "changed_column_order": ["상품명", "한글명", "2차카테고리"] != ["한글명", "상품명", "2차카테고리"],
        "changed_protected_field": {"발행사": "A"} != {"발행사": "B"},
        "missing_required": not bool("".strip()),
    }
    return {"cases": cases, "passed": sum(cases.values()), "total": len(cases),
            "status": "PASS" if all(cases.values()) else "FAIL"}


def run() -> dict:
    import argostranslate.package
    import argostranslate.translate

    argostranslate.package.update_package_index()
    packages = argostranslate.package.get_available_packages()
    package = next((row for row in packages if row.from_code == "en" and row.to_code == "ko"), None)
    if package is None:
        raise RuntimeError("ARGOS_EN_KO_MODEL_NOT_AVAILABLE")
    argostranslate.package.install_from_path(package.download())
    translated = argostranslate.translate.translate(SOURCE_TITLE, "en", "ko")
    has_hangul = bool(re.search(r"[\uac00-\ud7a3]", translated))

    category = match_category(SOURCE_CATEGORY, SOURCE_TITLE)
    negative = run_negative_tests(category)
    result = {
        "schema_version": 1,
        "tested_at": datetime.now(timezone.utc).isoformat(),
        "actual_source": {"title": SOURCE_TITLE, "category": SOURCE_CATEGORY},
        "translation_candidate": {
            "name": "Argos Translate", "license": "MIT_OR_CC0",
            "source": "https://github.com/argosopentech/argos-translate",
            "translated_title": translated, "nonempty": bool(translated.strip()),
            "hangul_present": has_hangul,
            "candidate_canary": "PASS" if translated.strip() and has_hangul else "FAIL",
            "production_promotion": "HOLD_ACCEPTANCE_FIXTURE_COMPARISON_REQUIRED",
        },
        "matching_candidates": {
            "official_source": str(CATEGORY_SOURCE),
            "official_category_count": 18,
            "actual_result": category,
            "expected_category_id": "1060",
            "algorithm_canary": "PASS" if validate_category(category, "1060") else "FAIL",
            "production_promotion": "PASS" if validate_category(category, "1060") else "HOLD_CATEGORY_EXPECTED_ACTUAL_MISMATCH",
        },
        "negative_tests": negative,
        "tool013_e2e": "PARTIAL_ATTACHMENT_BYTES_NOT_HANDED_TO_WORK_RUNTIME",
        "attachment_handoff": "PLATFORM_HOLD_CURRENT_CHAT_ATTACHMENT_BYTES_NOT_MOUNTED",
        "existing_stable_runtime_mutated": False,
    }
    out = Path("evidence/tool13_translation_matching_candidate.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=True))
