const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const {chromium} = require('playwright');

function browserPath(){
  return [
    process.env.BROWSER_EXECUTABLE,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean).find(candidate => fs.existsSync(candidate));
}

(async () => {
  const executablePath = browserPath();
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('load');

  const input = {
    name:'mapping.csv', mimeType:'text/csv',
    buffer:Buffer.from('Report Title,No.of Pages,Report Description,Table of Contents,Report Code\nAlpha,10,Verified overview,Chapter 1,B-1\n')
  };
  await page.locator('#fileInput').setInputFiles(input);
  await page.waitForFunction(() => document.querySelector('#fileInfo').textContent.includes('누적 1행'));

  const tocPreset = page.locator('select[data-field="목차"][data-role="preset"]');
  const overviewPreset = page.locator('select[data-field="개요"][data-role="preset"]');
  const formatPreset = page.locator('select[data-field="체제"][data-role="preset"]');
  const tocBefore = await tocPreset.inputValue();
  const overviewBefore = await overviewPreset.inputValue();
  await formatPreset.selectOption({label:'원본 연결'});
  assert.strictEqual(await tocPreset.inputValue(), tocBefore);
  assert.strictEqual(await overviewPreset.inputValue(), overviewBefore);
  await page.reload();
  assert.strictEqual(await page.locator('select[data-field="체제"][data-role="preset"]').inputValue(), '원본 연결');
  assert.strictEqual(await page.locator('select[data-field="목차"][data-role="preset"]').inputValue(), tocBefore);
  assert.strictEqual(await page.locator('select[data-field="개요"][data-role="preset"]').inputValue(), overviewBefore);
  await page.locator('#runBtn').click();

  for(const expected of ['체제','목차','개요']){
    const headers = await page.locator('#previewTable thead th').allTextContents();
    const index = headers.indexOf(expected);
    assert.ok(index >= 0, `missing preview header: ${expected}`);
    await page.locator('#coordBtn').click();
    await page.locator('#previewTable tbody tr').first().locator('td').nth(index).click();
    const trace = await page.evaluate(() => JSON.parse(localStorage.getItem('tool13_diag_v3')).clicked_trace);
    assert.strictEqual(trace.header_name, expected);
    assert.strictEqual(Number(trace.col_no), index + 1);
  }

  for(const no of ['04','05','06','07']){
    const card = page.locator('#fixedErrorListBody .fixed-error-card').filter({hasText:`${no}.`});
    await assert.doesNotReject(() => card.locator('.status-pass').waitFor());
    assert.match(await card.textContent(), /브라우저 fixture/);
  }

  assert.deepStrictEqual(errors, [], `browser errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log('PASS: TOOL013 config field isolation + format/TOC/overview coordinate-header mapping fixtures');
})().catch(error => { console.error(error); process.exit(1); });
