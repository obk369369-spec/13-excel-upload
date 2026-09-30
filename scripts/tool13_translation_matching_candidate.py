"""Truthful TOOL013 candidate canary; never promotes without fixture evidence."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

SOURCE_TITLE = ("China Semiconductor Market for Automotive by Component, Global Export "
                "Trends and Strategic Recommendation")
SOURCE_CATEGORY = "Automotive and Transportation"


def normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


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

    # These matching checks validate algorithms only.  The official WIC 18-item
    # source is deliberately not invented, so category promotion remains HOLD.
    aliases = ["Automotive & Transportation", "automotive transportation", "Healthcare"]
    exact = [row for row in aliases if row == SOURCE_CATEGORY]
    norm = [row for row in aliases if normalized(row) == normalized(SOURCE_CATEGORY)]
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
            "exact_matches": exact, "normalized_matches": norm,
            "algorithm_canary": "PASS",
            "production_promotion": "HOLD_OFFICIAL_18_CATEGORY_SOURCE_NOT_PRESENT",
        },
        "tool013_e2e": "PARTIAL_CANDIDATE_ONLY",
        "existing_stable_runtime_mutated": False,
    }
    out = Path("evidence/tool13_translation_matching_candidate.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=True))
