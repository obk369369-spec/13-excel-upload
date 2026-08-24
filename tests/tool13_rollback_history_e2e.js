const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const {chromium} = require('playwright');

const executablePath = [
  process.env.BROWSER_EXECUTABLE,
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
].filter(Boolean).find(candidate => fs.existsSync(candidate));

(async () => {
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('#fileInput').setInputFiles({
    name:'rollback.csv', mimeType:'text/csv',
    buffer:Buffer.from('Report Title,No.of Pages,Report Code\nAlpha,10,A-1\n')
  });
  await page.waitForFunction(() => document.querySelector('#fileInfo').textContent.includes('누적 1행'));
  await page.locator('#recheckBtn').click();
  await page.waitForFunction(() => document.querySelector('#dpRecheckSummary').textContent === 'FAIL');
  assert.strictEqual(await page.locator('#dpPass').textContent(), 'X');
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tool13_diag_v3')));
  assert.strictEqual(saved.state, 'HOLD');
  assert.strictEqual(saved.rollback_history.length, 1);
  assert.strictEqual(saved.error_history.length, 1);
  assert.ok(saved.error_history[0].errors.length > 0);

  await page.reload();
  await page.waitForLoadState('load');
  assert.match(await page.locator('#dpRollbackHistory').textContent(), /HOLD/);
  await page.locator('#runBtn').click();
  await page.locator('#coordBtn').click();
  await page.locator('#previewTable tbody td').first().click();
  await page.locator('#diagBtn').click();
  await page.locator('#recheckBtn').click();
  await page.waitForFunction(() => document.querySelector('#dpPass').textContent === 'PASS');
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tool13_diag_v3')));
  assert.strictEqual(saved.state, 'VERIFIED');
  assert.strictEqual(saved.rollback_history.length, 1);
  assert.strictEqual(saved.error_history.length, 1);
  assert.deepStrictEqual(saved.packet.errors, []);
  assert.strictEqual(saved.packet.rollback_history.length, 1);
  assert.strictEqual(saved.packet.error_history.length, 1);
  assert.ok(saved.packet.clicked_trace);
  assert.strictEqual(saved.packet.first_fail, null);

  await page.reload();
  await page.waitForLoadState('load');
  await page.waitForFunction(() => document.querySelector('#dpPass').textContent === 'PASS');
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tool13_diag_v3')));
  assert.ok(saved.clicked_trace);
  assert.strictEqual(saved.state, 'VERIFIED');
  assert.strictEqual(saved.rollback_history.length, 1);
  assert.strictEqual(saved.error_history.length, 1);
  for(const no of ['12','13','16','20','21','22','26']){
    const card = page.locator('#fixedErrorListBody .fixed-error-card').filter({hasText:`${no}.`});
    await card.locator('.status-pass').waitFor();
    assert.match(await card.textContent(), /브라우저 fixture/);
  }
  assert.deepStrictEqual(errors, [], `browser errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log('PASS: TOOL013 failed recheck -> persisted rollback/error history -> restart -> verified recovery E2E');
})().catch(error => { console.error(error); process.exit(1); });
