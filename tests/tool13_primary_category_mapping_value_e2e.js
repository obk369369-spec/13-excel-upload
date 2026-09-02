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

async function previewValue(page, field){
  const headers = await page.locator('#previewTable thead th').allTextContents();
  const index = headers.indexOf(field);
  assert.ok(index >= 0, `missing preview header: ${field}`);
  return page.locator('#previewTable tbody tr').first().locator('td').nth(index).textContent();
}

(async () => {
  const entrypoint = process.env.TOOL13_ENTRYPOINT || path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch({headless:true, executablePath:browserPath()});
  const page = await browser.newPage({acceptDownloads:true});
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', msg => { if(msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(pathToFileURL(entrypoint).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  assert.strictEqual(await page.locator('#cat1Input').inputValue(), '시장 조사 자료 - 영문판');
  const csv = [
    'Source A,Source B,No.of Pages,Report Description,Table of Contents,Report Code',
    'A-ONE,B-ONE,10,Overview 1,Chapter 1,C-1',
    'A-TWO,B-TWO,20,Overview 2,Chapter 2,C-2',
    'A-THREE,B-THREE,30,Overview 3,Chapter 3,C-3'
  ].join('\n');
  await page.locator('#fileInput').setInputFiles({name:'mapping-values.csv', mimeType:'text/csv', buffer:Buffer.from(csv)});
  await page.waitForFunction(() => document.querySelector('#fileInfo').textContent.includes('누적 3행'));

  const productSource = page.locator('select[data-field="상품명"][data-role="source"]');
  await productSource.selectOption({label:'Source A'});
  assert.strictEqual(await previewValue(page, '상품명'), 'A-ONE');
  await productSource.selectOption({label:'Source B'});
  assert.strictEqual(await previewValue(page, '상품명'), 'B-ONE');

  const categoryValues = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('#previewTable thead th')).map(node => node.textContent);
    const index = headers.indexOf('1차카테고리');
    return Array.from(document.querySelectorAll('#previewTable tbody tr')).map(row => row.cells[index].textContent);
  });
  assert.deepStrictEqual(categoryValues, Array(3).fill('시장 조사 자료 - 영문판'));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#uploadBtn').click()
  ]);
  const downloadPath = path.join(__dirname, '.tool13_primary_category_mapping_value_output.xlsx');
  await download.saveAs(downloadPath);
  const workbook = XLSX.read(fs.readFileSync(downloadPath), {type:'buffer'});
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {defval:''});
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map(row => row['상품명']), ['B-ONE','B-TWO','B-THREE']);
  assert.deepStrictEqual(rows.map(row => row['1차카테고리']), Array(3).fill('시장 조사 자료 - 영문판'));
  fs.unlinkSync(downloadPath);
  assert.deepStrictEqual(errors, [], `browser errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log('PASS: TOOL013 primary category all rows + mapping preview/download actual values E2E');
})().catch(error => { console.error(error); process.exit(1); });
