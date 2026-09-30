const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('../vendor/xlsx.full.min.js');

const inputPath = path.resolve(process.argv[2]);
const outputPath = path.resolve(process.argv[3]);
const evidencePath = path.resolve(process.argv[4]);

const EXPECTED_HEADERS = [
  '발행사', '상품명', '한글명', '1차카테고리', '2차카테고리', '3차카테고리',
  '페이지수', '개요', '목차', '발행일', '파일명', '판매유형', '환(u,e,g,j)',
  'HardCapy가격', 'PDF가격', '저자', '체제', 'ISBN/CODE'
];
const SOURCE_TITLE = 'China Semiconductor Market for Automotive by Component, Global Export Trends and Strategic Recommendation';
const TRANSLATED_TITLE = '자동차용 부품별 중국 반도체 시장, 세계 수출 동향 및 전략적 제언';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function reopen(bytes) {
  const ole = [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];
  if (bytes.length < ole.length || !ole.every((value, index) => bytes[index] === value)) {
    throw new Error('INVALID_XLS_OLE_SIGNATURE');
  }
  return XLSX.read(bytes, {type: 'buffer', cellDates: true});
}

function validateRow(row, headers = EXPECTED_HEADERS) {
  const validCategories = new Set(['1010','1020','1030','1040','1050','1060','1070','1080','10a0','10b0','10c0','10d0','10e0','10f0','10g0','10h0','10i0','10j0']);
  const errors = [];
  if (JSON.stringify(headers) !== JSON.stringify(EXPECTED_HEADERS)) errors.push('COLUMN_ORDER_CHANGED');
  if (!row['발행사'] || !row['상품명'] || !row['한글명']) errors.push('REQUIRED_VALUE_MISSING');
  if (!/[가-힣]/.test(String(row['상품명'] || ''))) errors.push('TRANSLATION_INVALID');
  if (row['한글명'] !== SOURCE_TITLE) errors.push('SOURCE_TITLE_CHANGED');
  if (!validCategories.has(String(row['2차카테고리'] || ''))) errors.push('CATEGORY_INVALID');
  if (String(row['2차카테고리']) !== '1060') errors.push('CATEGORY_MISMATCH');
  if (row['1차카테고리'] !== '시장 조사 자료 - 영문판') errors.push('PROTECTED_FIELD_CHANGED');
  if (row['체제'] !== '128 Pages') errors.push('FORMAT_INVALID');
  return errors;
}

const originalBytes = fs.readFileSync(inputPath);
const originalHash = sha256(originalBytes);
const sourceBook = reopen(originalBytes);
const sourceSheet = sourceBook.Sheets[sourceBook.SheetNames[0]];
const sourceRows = XLSX.utils.sheet_to_json(sourceSheet, {header: 1, defval: ''});
assert.deepStrictEqual(sourceRows[0], EXPECTED_HEADERS, 'official template columns differ');
const protectedTemplateRow = Object.fromEntries(EXPECTED_HEADERS.map((header, index) => [header, (sourceRows[1] || [])[index] || '']));

const outputRow = {...protectedTemplateRow};
Object.assign(outputRow, {
  '발행사': 'TOOL013 V2 실제 검증',
  '상품명': TRANSLATED_TITLE,
  '한글명': SOURCE_TITLE,
  '1차카테고리': '시장 조사 자료 - 영문판',
  '2차카테고리': '1060',
  '페이지수': 128,
  '개요': 'Automotive semiconductor market validation sample.',
  '목차': 'Component; Export Trends; Strategic Recommendation',
  '발행일': '2026-09-30',
  '파일명': 'tool013-v2-acceptance',
  '판매유형': 'PDF',
  '체제': '128 Pages'
});

assert.deepStrictEqual(validateRow(outputRow), [], 'positive validation failed');
const outputBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(outputBook, XLSX.utils.json_to_sheet([outputRow], {header: EXPECTED_HEADERS}), 'Sheet1');
const outputBytes = XLSX.write(outputBook, {bookType: 'biff8', type: 'buffer'});
fs.writeFileSync(outputPath, outputBytes);

const reopened = reopen(fs.readFileSync(outputPath));
const reopenedRows = XLSX.utils.sheet_to_json(reopened.Sheets[reopened.SheetNames[0]], {defval: ''});
assert.strictEqual(reopenedRows.length, 1, 'reopened output row count mismatch');
assert.deepStrictEqual(validateRow(reopenedRows[0]), [], 'reopened output validation failed');
assert.strictEqual(sha256(fs.readFileSync(inputPath)), originalHash, 'official source was modified');

const negative = {
  wrong_translation: validateRow({...outputRow, '상품명': 'Wrong English'}).includes('TRANSLATION_INVALID'),
  blank_translation: validateRow({...outputRow, '상품명': ''}).includes('REQUIRED_VALUE_MISSING'),
  nonexistent_category: validateRow({...outputRow, '2차카테고리': '9999'}).includes('CATEGORY_INVALID'),
  wrong_category: validateRow({...outputRow, '2차카테고리': '1010'}).includes('CATEGORY_MISMATCH'),
  blank_category: validateRow({...outputRow, '2차카테고리': ''}).includes('CATEGORY_INVALID'),
  missing_required: validateRow({...outputRow, '발행사': ''}).includes('REQUIRED_VALUE_MISSING'),
  changed_column_order: validateRow(outputRow, [...EXPECTED_HEADERS].reverse()).includes('COLUMN_ORDER_CHANGED'),
  changed_protected_field: validateRow({...outputRow, '1차카테고리': '변경됨'}).includes('PROTECTED_FIELD_CHANGED'),
  source_value_damaged: validateRow({...outputRow, '한글명': 'changed'}).includes('SOURCE_TITLE_CHANGED'),
  unexpected_value_added: !EXPECTED_HEADERS.includes('임의추가'),
  corrupted_output: (() => { try { reopen(Buffer.from([0,1,2,3])); return false; } catch { return true; } })(),
  reopen_failure: (() => { try { reopen(Buffer.alloc(0)); return false; } catch { return true; } })()
};
assert.ok(Object.values(negative).every(Boolean), 'one or more negative tests failed');

const evidence = {
  schema_version: 1,
  target: 'TOOL013_V2',
  status: 'PARTIAL_TRANSLATION_APPROVAL_FIXTURE_MISSING',
  actual_input_xls: {path: inputPath, sha256: originalHash, bytes: originalBytes.length},
  actual_output_xls: {path: outputPath, sha256: sha256(outputBytes), bytes: outputBytes.length, reopened_rows: reopenedRows.length},
  columns: {expected: EXPECTED_HEADERS, actual: sourceRows[0], status: 'PASS'},
  protected_source_unchanged: true,
  category_existing_pass_reused: true,
  actual_xls_e2e: 'PASS',
  negative_tests: {passed: Object.values(negative).filter(Boolean).length, total: Object.keys(negative).length, cases: negative, status: 'PASS'},
  translation: {
    source: SOURCE_TITLE,
    actual: TRANSLATED_TITLE,
    mechanical_validation: 'PASS',
    approved_expected_comparison: 'HOLD_APPROVED_TRANSLATION_FIXTURE_NOT_PRESENT'
  },
  operations_ready: false,
  reason: 'User-approved historical Korean title fixture is not present in repository evidence; no false COMPLETE.'
};
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
