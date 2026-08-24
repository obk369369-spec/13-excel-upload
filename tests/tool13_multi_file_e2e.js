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

  async function makeXlsx(name, title, pages, code) {
    const base64 = await page.evaluate(({title, pages, code}) => {
      const sheet = XLSX.utils.aoa_to_sheet([
        ['Report Title', 'No.of Pages', 'Report Code'],
        [title, pages, code]
      ]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'input');
      const bytes = new Uint8Array(XLSX.write(workbook, {type:'array', bookType:'xlsx'}));
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    }, {title, pages, code});
    return {
      name,
      mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer:Buffer.from(base64, 'base64')
    };
  }

  const first = await makeXlsx('first.xlsx', 'Alpha', 10, 'A-1');
  const second = await makeXlsx('second.xlsx', 'Beta', 20, 'B-1');
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
  const batchCheckpoint = await page.evaluate(() => JSON.parse(localStorage.getItem('tool13_batch_checkpoint_v1')));
  assert.strictEqual(batchCheckpoint.batches, 3);

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
  const storedDiag = await page.evaluate(() => JSON.parse(localStorage.getItem('tool13_diag_v3')));
  assert.deepStrictEqual(packet, storedDiag.packet);
  assert.deepStrictEqual(packet.clicked_trace, packet.ui_trace);
  assert.deepStrictEqual(packet.errors, []);
  assert.strictEqual(packet.first_fail, null);
  assert.strictEqual(packet.recheck_status, 'PASS');
  assert.strictEqual(packet.upload_status, '검증완료');
  assert.match(await page.locator('#errorListBody').textContent(), /감지된 오류 없음/);
  assert.strictEqual(pageErrors.length, 0, `browser page errors: ${pageErrors.join(' | ')}`);

  await browser.close();
  console.log('PASS: TOOL013 actual sequential XLSX files -> cumulative preview -> duplicate guard -> restart resume E2E');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
