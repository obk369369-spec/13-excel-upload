const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const {chromium} = require('playwright');

function browserPath(){
  return [
    process.env.BROWSER_EXECUTABLE,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean).find(candidate => fs.existsSync(candidate));
}

async function workbookRows(page, download){
  const filePath = await download.path();
  const base64 = fs.readFileSync(filePath).toString('base64');
  return page.evaluate(encoded => {
    const bytes = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0));
    const workbook = XLSX.read(bytes, {type:'array'});
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {header:1, defval:''});
  }, base64);
}

(async () => {
  const executablePath = browserPath();
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  const page = await browser.newPage({acceptDownloads:true});
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  assert.strictEqual(await page.evaluate(() => typeof XLSX), 'object', 'browser XLSX runtime unavailable');

  await page.locator('#fileInput').setInputFiles({
    name:'consistency.csv', mimeType:'text/csv',
    buffer:Buffer.from('Report Title,No.of Pages,Report Description,Table of Contents,Report Code\nAlpha,10,Overview A,Chapter A,A-1\nBeta,20,Overview B,Chapter B,B-1\n')
  });
  await page.waitForFunction(() => document.querySelector('#fileInfo').textContent.includes('누적 2행'));
  await page.locator('#coordBtn').click();
  await page.locator('#previewTable tbody td').first().click();
  await page.locator('#diagBtn').click();
  await page.locator('#recheckBtn').click();
  await page.waitForFunction(() => document.querySelector('#dpPass').textContent === 'PASS');

  const preview = await page.locator('#previewTable tbody tr').evaluateAll(rows => rows.map(row => Array.from(row.cells).map(cell => cell.textContent)));
  const packet = JSON.parse(await page.locator('#diagPacketBox').textContent());
  assert.deepStrictEqual(packet.files, ['consistency.csv']);
  assert.deepStrictEqual(packet.errors, []);

  const [traceDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#traceBtn').click()]);
  const traceRows = await workbookRows(page, traceDownload);
  const [uploadDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#uploadBtn').click()]);
  const uploadRows = await workbookRows(page, uploadDownload);

  assert.strictEqual(traceRows.length, 3);
  assert.strictEqual(uploadRows.length, 3);
  const strings = rows => rows.map(row => row.map(value => String(value)));
  assert.deepStrictEqual(strings(traceRows.slice(1).map(row => row.slice(0,3))), strings(preview.map(row => row.slice(0,3))));
  assert.deepStrictEqual(strings(traceRows.slice(1).map(row => row.slice(3))), strings(uploadRows.slice(1)));
  for(const no of ['18','19']){
    const card = page.locator('#fixedErrorListBody .fixed-error-card').filter({hasText:`${no}.`});
    await card.locator('.status-pass').waitFor();
    assert.match(await card.textContent(), /브라우저 fixture/);
  }
  assert.deepStrictEqual(errors, [], `browser errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log('PASS: TOOL013 preview + diagnostic packet + trace/upload XLSX download read-back consistency E2E');
})().catch(error => { console.error(error); process.exit(1); });
