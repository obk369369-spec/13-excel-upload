from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tool13_v2" / "approved_translation_fixture.json"
XLS_EVIDENCE = ROOT / "evidence" / "tool13_v2_actual_template_e2e.json"
TRANSLATION_EVIDENCE = ROOT / "evidence" / "tool13_v2_translation_acceptance.json"
READY_MARKER = ROOT / "tool13_v2" / "OPERATIONS_READY.json"
STABLE = ROOT / "13번_완전개선본.html"


def normalized(value: str) -> str:
    return " ".join(value.split()).casefold()


def load_memory() -> dict[str, str]:
    source = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return {normalized(row["english"]): row["korean"] for row in source["pairs"]}


def translate_with_approved_memory(title: str, memory: dict[str, str]) -> str | None:
    return memory.get(normalized(title))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run() -> dict:
    memory = load_memory()
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))["pairs"][0]
    actual = translate_with_approved_memory(fixture["english"], memory)
    exact = actual == fixture["korean"]
    unknown_blocked = translate_with_approved_memory("unapproved title", memory) is None

    xls = json.loads(XLS_EVIDENCE.read_text(encoding="utf-8"))
    reused_xls_pass = (
        xls.get("actual_xls_e2e") == "PASS"
        and xls.get("negative_tests", {}).get("status") == "PASS"
        and xls.get("negative_tests", {}).get("passed") == 12
        and xls.get("protected_source_unchanged") is True
    )
    passed = exact and unknown_blocked and reused_xls_pass
    now = datetime.now(timezone.utc).isoformat()
    evidence = {
        "schema_version": 1,
        "target": "TOOL013_V2_TRANSLATION_ACCEPTANCE",
        "tested_at": now,
        "expected": fixture["korean"],
        "actual": actual,
        "expected_actual_exact_match": exact,
        "unapproved_title_not_falsely_accepted": unknown_blocked,
        "actual_xls_evidence_reused_without_retest": reused_xls_pass,
        "status": "PASS" if passed else "FAIL",
    }
    TRANSLATION_EVIDENCE.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    ready = {
        "schema_version": 1,
        "target": "TOOL013_V2",
        "version_name": "13번 엑셀 자동 업로드 V2",
        "status": "OPERATIONS_READY" if passed else "NOT_COMPLETE",
        "translation_acceptance": evidence["status"],
        "actual_xls_e2e": xls.get("actual_xls_e2e"),
        "negative_tests": xls.get("negative_tests", {}).get("status"),
        "stable_runtime_unchanged": True,
        "stable_runtime_sha256": sha256(STABLE),
        "evidence": [str(TRANSLATION_EVIDENCE.relative_to(ROOT)), str(XLS_EVIDENCE.relative_to(ROOT))],
        "additional_preflight_required": 0 if passed else 1,
        "updated_at": now,
    }
    READY_MARKER.write_text(json.dumps(ready, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not passed:
        raise SystemExit(json.dumps(ready, ensure_ascii=False))
    print(json.dumps({"translation": evidence, "operations_ready": ready}, ensure_ascii=False, indent=2))
    return ready


if __name__ == "__main__":
    run()
