const assert=require('assert'),fs=require('fs'),path=require('path');
const {pathToFileURL}=require('url');
const {chromium}=require('playwright');
const XLSX=require('../vendor/xlsx.full.min.js');
(async()=>{
 const entry=process.env.TOOL13_ENTRYPOINT||path.resolve(__dirname,'../index.html');
 const input=process.env.TOOL13_REPRESENTATIVE_INPUT;
 assert(input,'TOOL13_REPRESENTATIVE_INPUT required');
 const browser=await chromium.launch({headless:true,executablePath:path.join(process.env['ProgramFiles(x86)'],'Microsoft/Edge/Application/msedge.exe')});
 const report={entry,input,test:'file input -> cache commit -> reload -> exact preview -> download/reopen -> reset',status:'RUNNING'};
 try{
 const page=await browser.newPage({acceptDownloads:true});
 page.on('dialog',d=>d.accept());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(entry).href);
 await page.waitForFunction(()=>!document.querySelector('#fileInput').disabled);
 await page.locator('#fileInput').setInputFiles(input);
 await page.waitForFunction(()=>document.querySelector('#fileInfo').textContent.includes('누적'));
 await page.waitForFunction(()=>document.querySelector('#coreLog').textContent.includes('로컬 재개 캐시 저장 완료'));
 const realBefore=await page.locator('#previewTable tbody').textContent();
 const source=XLSX.read(fs.readFileSync(input),{type:'buffer'});
 const sourceRows=XLSX.utils.sheet_to_json(source.Sheets[source.SheetNames[0]],{header:1});
 const firstTitle=sourceRows[2][1];assert(realBefore.includes(firstTitle));
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#fileInput').disabled);
 assert.strictEqual(await page.locator('#previewTable tbody').textContent(),realBefore);
 const [realDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#uploadBtn').click()]);
 const realBook=XLSX.read(fs.readFileSync(await realDownload.path()),{type:'buffer'});
 const realRows=XLSX.utils.sheet_to_json(realBook.Sheets[realBook.SheetNames[0]],{defval:''});
 assert(realRows.some(r=>r['상품명']===firstTitle));assert(realRows.every(r=>r['1차카테고리']==='시장 조사 자료 - 영문판'));
 report.real_rows=realRows.length;report.real_source_title_preserved=true;
 await page.locator('#resetBtn').click();await page.waitForFunction(()=>!document.querySelector('#fileInput').disabled&&document.querySelectorAll('#previewTable tbody tr').length===0);
 const description='Exact source text 123. '.repeat(1100);
 const csv=['Report Title,Report Description,Report Code',...Array.from({length:160},(_,i)=>`Title ${i},${description},R${i}`)].join('\n');
 assert(csv.length>3000000);
 await page.locator('#fileInput').setInputFiles({name:'MarketsandMarkets-resume.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await page.waitForFunction(()=>document.querySelector('#coreLog').textContent.includes('로컬 재개 캐시 저장 완료: 160행'));
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#fileInput').disabled);
 assert((await page.locator('#fileInfo').textContent()).includes('누적 160행'));
 const [downloaded]=await Promise.all([page.waitForEvent('download'),page.locator('#uploadBtn').click()]);
 const book=XLSX.read(fs.readFileSync(await downloaded.path()),{type:'buffer'});
 const rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{defval:''});
 assert.strictEqual(rows.length,160);
 // The unchanged str() mapping contract trims boundary whitespace (index.html).
 // First trial exposed an oracle mismatch at the final space, not cache loss.
 rows.forEach((row,i)=>{assert.strictEqual(row['상품명'],`Title ${i}`);assert.strictEqual(row['개요'],description.trim());assert.strictEqual(row['1차카테고리'],'시장 조사 자료 - 영문판')});
 await page.locator('#resetBtn').click();await page.waitForFunction(()=>!document.querySelector('#fileInput').disabled&&document.querySelectorAll('#previewTable tbody tr').length===0);
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#fileInput').disabled);
 assert.strictEqual(await page.locator('#previewTable tbody tr').count(),0);
 assert.deepStrictEqual(errors,[]);
 Object.assign(report,{prior_trial:'FAIL: oracle omitted existing str().trim() contract; same input retained',large_input_chars:csv.length,expected_rows:160,actual_rows:rows.length,all_titles_and_descriptions_exact:true,reset_durable:true,status:'PASS'});
 }catch(e){report.status='FAIL';report.error=e.stack;throw e}
 finally{fs.writeFileSync(process.env.TOOL13_IDB_EVIDENCE||path.join(__dirname,'tool13_idb_resume_evidence.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report))}
})().catch(e=>{console.error(e);process.exitCode=1});
