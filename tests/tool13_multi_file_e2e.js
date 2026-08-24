const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const {chromium} = require('playwright');

(async () => {
  let browser;
  const browserCandidates = [
    process.env.BROWSER_EXECUTABLE,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  const executablePath = browserCandidates.find(candidate => fs.existsSync(candidate));
  browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('dialog', dialog => dialog.accept());
  const url = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('load');
  await page.waitForTimeout(100);
  const baselinePageErrorCount = pageErrors.length;
  assert.strictEqual(baselinePageErrorCount, 0, `startup browser page errors: ${pageErrors.join(' | ')}`);

  const first = {name:'first.csv', mimeType:'text/csv', buffer:Buffer.from('Report Title,No.of Pages,Report Code\nAlpha,10,A-1\n')};
  const second = {name:'second.csv', mimeType:'text/csv', buffer:Buffer.from('Report Title,No.of Pages,Report Code\nBeta,20,B-1\n')};
  await page.locator('#fileInput').setInputFiles(first);
  await page.waitForFunction(() => document.querySelector('#fileInfo').textContent.includes('누적 1행'));
  await page.waitForFunction(() => document.querySelector('#fileInput').files.length === 0);
  await page.locator('#fileInput').setInputFiles(second);
  await page.waitForTimeout(500);
  assert.strictEqual(pageErrors.length, baselinePageErrorCount, `new browser page errors: ${pageErrors.slice(baselinePageErrorCount).join(' | ')}`);
  const secondInfo = await page.locator('#fileInfo').textContent();
  const secondLog = await page.locator('#coreLog').textContent();
  assert.match(secondInfo, /파일 2개 \/ 누적 2행/, `fileInfo=${secondInfo}\nlog=${secondLog}`);
  assert.strictEqual(await page.locator('#previewTable tbody tr').count(), 2);

  await page.locator('#fileInput').setInputFiles(first);
  await page.waitForFunction(() => document.querySelector('#fileInfo').textContent.includes('중복차단 1행'));
  assert.strictEqual(await page.locator('#previewTable tbody tr').count(), 2);

  await page.reload();
  await page.waitForLoadState('load');
  assert.match(await page.locator('#fileInfo').textContent(), /파일 2개 \/ 누적 2행 \/ 중복차단 1행/);
  await page.locator('#runBtn').click();
  assert.strictEqual(await page.locator('#previewTable tbody tr').count(), 2);

  await page.locator('#coordBtn').click();
  await page.locator('#previewTable tbody td').first().click();
  await page.locator('#diagBtn').click();
  await page.waitForFunction(() => document.querySelector('#dpRecheckSummary').textContent === 'TESTED');
  await page.locator('#recheckBtn').click();
  await page.waitForFunction(() => document.querySelector('#dpPass').textContent === 'PASS');
  const packet = JSON.parse(await page.locator('#diagPacketBox').textContent());
  assert.deepStrictEqual(packet.clicked_trace, packet.ui_trace);
  assert.deepStrictEqual(packet.errors, []);
  assert.strictEqual(packet.first_fail, null);
  assert.strictEqual(packet.recheck_status, 'PASS');
  assert.strictEqual(packet.upload_status, '검증완료');
  assert.strictEqual(pageErrors.length, 0, `browser page errors: ${pageErrors.join(' | ')}`);

  await browser.close();
  console.log('PASS: TOOL013 actual sequential CSV files -> cumulative preview -> duplicate guard -> restart resume E2E');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
