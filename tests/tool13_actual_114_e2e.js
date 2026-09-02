const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const crypto = require('crypto');
const {chromium} = require('playwright');
const XLSX = require('../vendor/xlsx.full.min.js');

const actualDir = process.env.TOOL13_ACTUAL_114_DIR ||
  'D:\\홈페이지 자료 입력\\Metadata Sheet (Market Report)\\MarketsandMarkets\\입력전\\MarketsandMarkets_Latest_엑셀파일만_평면압축';

function browserPath(){
  return [
    process.env.BROWSER_EXECUTABLE,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean).find(candidate => fs.existsSync(candidate));
}

(async () => {
  const inputs = fs.readdirSync(actualDir)
    .filter(name => !name.startsWith('~$') && /\.(xlsx|xls|csv)$/i.test(name))
    .sort()
    .map(name => path.join(actualDir, name));
  assert.strictEqual(inputs.length, 114, `expected exact actual set of 114 files, got ${inputs.length}`);

  const browser = await chromium.launch({headless:true, executablePath:browserPath()});
  const page = await browser.newPage({acceptDownloads:true});
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('console', msg => { if(msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`); });
  page.on('dialog', dialog => dialog.accept());
  const entrypoint = process.env.TOOL13_ENTRYPOINT || path.resolve(__dirname, '..', 'index.html');
  await page.goto(pathToFileURL(entrypoint).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const started = Date.now();
  await page.locator('#fileInput').setInputFiles(inputs);
  await page.waitForFunction(() => {
    const text = document.querySelector('#fileInfo').textContent;
    return /누적 \d+행/.test(text) || /BLOCKED|실패|오류/.test(text);
  }, null, {timeout:180000});

  const result = await page.evaluate(() => ({
    fileInfo: document.querySelector('#fileInfo').textContent,
    rowTag: document.querySelector('#rowTag').textContent,
    publisherTag: document.querySelector('#publisherTag').textContent,
    log: document.querySelector('#coreLog').textContent,
    previewRows: document.querySelectorAll('#previewTable tbody tr').length,
    previewCategories: (() => {
      const headers = Array.from(document.querySelectorAll('#previewTable thead th')).map(node => node.textContent);
      const index = headers.indexOf('1차카테고리');
      return Array.from(document.querySelectorAll('#previewTable tbody tr')).map(row => row.cells[index].textContent);
    })(),
    state: JSON.parse(localStorage.getItem('tool13_preview_working_v1') || '{}')
  }));
  assert.deepStrictEqual(pageErrors, [], `browser errors: ${pageErrors.join(' | ')}`);
  assert.match(result.fileInfo, /파일 114개 \/ 누적 [1-9]\d*행/);
  assert.match(result.publisherTag, /발행사 MarketsandMarkets/);
  assert.ok(result.previewRows > 0, 'preview not generated');
  assert.ok(result.previewCategories.every(value => value === '시장 조사 자료 - 영문판'), 'primary category mismatch in rendered preview rows');

  await page.locator('#coordBtn').click();
  await page.locator('#previewTable tbody td').first().click();
  await page.locator('#diagBtn').click();
  await page.locator('#recheckBtn').click();
  const validation = await page.evaluate(() => ({
    status:document.querySelector('#dpPass').textContent,
    errors:JSON.parse(localStorage.getItem('tool13_diag_v3') || '{}').errors || [],
    packet:JSON.parse(document.querySelector('#diagPacketBox').textContent || '{}')
  }));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#uploadBtn').click()
  ]);
  const downloadPath = await download.path();
  assert.ok(downloadPath && fs.statSync(downloadPath).size > 0, 'output download missing/empty');
  const outputWorkbook = XLSX.read(fs.readFileSync(downloadPath), {type:'buffer'});
  const outputRows = XLSX.utils.sheet_to_json(outputWorkbook.Sheets[outputWorkbook.SheetNames[0]], {defval:''});
  const expectedOutputRows = Number((result.rowTag.match(/\d+/) || [0])[0]);
  assert.strictEqual(outputRows.length, expectedOutputRows, 'downloaded row count differs from preview row count');
  assert.ok(outputRows.every(row => row['1차카테고리'] === '시장 조사 자료 - 영문판'), 'primary category mismatch in downloaded rows');
  assert.strictEqual(validation.status, 'PASS', `validation=${JSON.stringify(validation.errors)}`);
  console.log(JSON.stringify({
    status:'PASS', input_files:inputs.length, elapsed_ms:Date.now()-started,
    file_info:result.fileInfo, row_tag:result.rowTag, publisher:result.publisherTag,
    preview_dom_rows:result.previewRows, output_rows:outputRows.length,
    pass_count:validation.status === 'PASS' ? 114 : 0,
    hold_count:validation.status === 'PASS' ? 0 : validation.errors.length,
    primary_category:'시장 조사 자료 - 영문판', primary_category_rows:outputRows.length,
    output_file:download.suggestedFilename(), output_bytes:fs.statSync(downloadPath).size,
    output_sha256:crypto.createHash('sha256').update(fs.readFileSync(downloadPath)).digest('hex')
  }));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
