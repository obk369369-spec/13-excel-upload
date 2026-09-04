const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const {chromium} = require('playwright');
const XLSX = require('../vendor/xlsx.full.min.js');

function browserPath(){
  return [
    process.env.BROWSER_EXECUTABLE,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean).find(candidate => fs.existsSync(candidate));
}

function expectedPageValue(inputPath){
  const workbook = XLSX.read(fs.readFileSync(inputPath), {type:'buffer'});
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {header:1, defval:''});
  for(let rowIndex=0; rowIndex<Math.min(rows.length, 60); rowIndex++){
    const header = rows[rowIndex].map(value => String(value).toLowerCase().replace(/[ ._-]/g, ''));
    const column = header.findIndex(value => ['pages','page','noofpages','numberofpages'].includes(value));
    if(column < 0) continue;
    for(let dataIndex=rowIndex+1; dataIndex<rows.length; dataIndex++){
      const value = String((rows[dataIndex] || [])[column] ?? '').trim();
      if(value) return `${value} Pages`;
    }
  }
  throw new Error(`No independent page value found in ${inputPath}`);
}

async function runCase(browser, entrypoint, inputPath){
  const context = await browser.newContext({acceptDownloads:true});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if(message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(pathToFileURL(entrypoint).href);
  await page.evaluate(async () => {
    localStorage.clear();
    if(window.idbKeyval) await window.idbKeyval.clear();
  });
  await page.reload();
  await page.locator('#fileInput').setInputFiles(inputPath);
  await page.waitForFunction(() => /누적 [1-9][0-9]*행/.test(document.querySelector('#fileInfo').textContent), null, {timeout:120000});

  const headers = await page.locator('#previewTable thead th').allTextContents();
  const formatColumn = headers.indexOf('체제');
  assert.ok(formatColumn >= 0, '체제 preview column missing');
  const previewFormat = (await page.locator('#previewTable tbody tr').first().locator('td').nth(formatColumn).textContent()).trim();
  const expectedFormat = expectedPageValue(inputPath);
  assert.strictEqual(previewFormat, expectedFormat, 'preview format differs from independent expected value');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#uploadBtn').click()
  ]);
  const expectedFilename = `${path.basename(inputPath, path.extname(inputPath))} - 월드 입력.xls`;
  assert.strictEqual(download.suggestedFilename(), expectedFilename, 'download filename mismatch');
  const outputPath = await download.path();
  const bytes = fs.readFileSync(outputPath);
  assert.deepStrictEqual([...bytes.subarray(0, 8)], [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1], 'output is not BIFF8/OLE .xls');
  const outputBook = XLSX.read(bytes, {type:'buffer'});
  const outputRows = XLSX.utils.sheet_to_json(outputBook.Sheets[outputBook.SheetNames[0]], {defval:''});
  assert.ok(outputRows.length > 0, 'reopened output has no rows');
  assert.strictEqual(String(outputRows[0]['체제']), expectedFormat, 'downloaded format differs from preview/expected');
  assert.deepStrictEqual(errors, [], `browser errors: ${errors.join(' | ')}`);
  await context.close();
  return {input:path.basename(inputPath), output:expectedFilename, rows:outputRows.length, expected:expectedFormat, actual:String(outputRows[0]['체제'])};
}

(async () => {
  const entrypoint = process.env.TOOL13_ENTRYPOINT || path.resolve(__dirname, '..', 'index.html');
  const inputs = [process.env.TOOL13_XLS_INPUT, process.env.TOOL13_XLSX_INPUT];
  assert.ok(inputs.every(Boolean), 'TOOL13_XLS_INPUT and TOOL13_XLSX_INPUT are required');
  assert.strictEqual(path.extname(inputs[0]).toLowerCase(), '.xls');
  assert.strictEqual(path.extname(inputs[1]).toLowerCase(), '.xlsx');
  const browser = await chromium.launch({headless:true, executablePath:browserPath()});
  const results = [];
  try {
    for(const input of inputs) results.push(await runCase(browser, entrypoint, input));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({status:'PASS', entrypoint, results}, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
