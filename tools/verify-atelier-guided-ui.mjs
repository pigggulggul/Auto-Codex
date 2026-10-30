// Starts its own isolated synthetic server. Never calls a real model or user store.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,mkdtemp,cp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.argv[2]||'playwright');
const output=path.resolve('.cache/atelier-guided-ux');await mkdir(output,{recursive:true});
const scratch=await mkdtemp(path.resolve('.cache/atelier-guided-ui-'));
await cp(path.resolve('build-server'),path.join(scratch,'build-server'),{recursive:true});await cp(path.resolve('dist'),path.join(scratch,'dist'),{recursive:true});await cp(path.resolve('tools/fixtures/proposal-app-server.mjs'),path.join(scratch,'app-server'));
const child=spawn(process.execPath,[path.join(scratch,'build-server/server/index.js'),'--serve'],{cwd:scratch,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AUTO_CODEX_PORT:'4877',CODEX_BIN:process.execPath}});
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Isolated fixture startup timed out')),12000);child.stdout.on('data',data=>{if(String(data).includes('Auto Codex bridge')){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(new Error('Isolated fixture exited before listening'));});});
const browser=await chromium.launch({channel:'chrome',headless:true}).catch(error=>{child.kill();throw error;});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const wsCalls=[];page.on('websocket',ws=>ws.on('framesent',event=>{try{const message=JSON.parse(String(event.payload));if(message.type?.startsWith('atelier.'))wsCalls.push(message);}catch{/* Ignore non-JSON diagnostics. */}}));
const evidence={synthetic:true,liveModel:false};
const visible=async text=>assert(await page.getByText(text,{exact:false}).first().isVisible(),text);
try{
 await page.goto('http://127.0.0.1:4877');
 await page.getByRole('button',{name:'아이디어부터',exact:false}).first().click();
 const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'아이디어부터 · 새 프로젝트'})});
 await dialog.getByLabel('프로젝트 이름',{exact:true}).fill('처음 만드는 여행 일정');
 await dialog.getByLabel('어떤 것을 만들고 싶나요?',{exact:false}).fill('혼자 여행하는 사람이 장소를 모아 하루 일정을 쉽게 만드는 앱');
 await dialog.getByRole('button',{name:'이 아이디어로 시작하기',exact:true}).click();
 await page.getByRole('heading',{name:'먼저 세 가지만 생각해 보세요',exact:true}).waitFor();
 const workspace=page.getByRole('region',{name:'Atelier 수동 디자인 작업실'});
 await workspace.locator('summary').filter({hasText:'직접 답변을 정리하거나 고치기'}).click();
 const visibleAnswers=workspace.getByRole('textbox',{name:'나의 답변',exact:false});assert.equal(await visibleAnswers.count(),3);
 await visibleAnswers.first().fill('마음에 드는 장소로 하루 여행 일정을 만드는 앱');
 await workspace.getByRole('form',{name:'무엇을 만드는 프로젝트인가요?',exact:true}).getByRole('button',{name:'저장',exact:true}).click();
 await page.getByText('서버 저장 확인됨',{exact:true}).first().waitFor();
 evidence.threeBasicQuestions=true;
 await page.screenshot({path:path.join(output,'design-1440.png'),fullPage:true});

 // Replacing a prepared export used to leak one of the two transfer slots each time.
 await workspace.locator('summary').filter({hasText:'백업 파일 저장·가져오기'}).click();
 for(let i=0;i<4;i++){
  await workspace.getByRole('button',{name:'설계 백업 파일 준비',exact:true}).click();
  await workspace.getByRole('button',{name:'내 PC에 저장',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.design-workspace .design-download button')?.disabled);
 }
 const downloaded=page.waitForEvent('download');await workspace.getByRole('button',{name:'내 PC에 저장',exact:true}).click();
 const download=await downloaded;assert(download.suggestedFilename().endsWith('.atelier.json'));await download.saveAs(path.join(output,'synthetic-backup.atelier.json'));
 evidence.repeatBackup=true;
 assert(wsCalls.filter(c=>c.type==='atelier.transfer.abort').length>=3);
 assert.equal(await workspace.locator('.design-error').count(),0);

 const proposals=workspace.getByRole('region',{name:'읽기 전용 AI 설계 제안'});await proposals.getByLabel('무엇을 도와드릴까요?',{exact:false}).selectOption('brief');
 await proposals.getByLabel('무엇을 도와드릴까요?',{exact:false}).selectOption('concept');
 await visible('아직 다듬을 항목이 없어요');
 await proposals.getByLabel('새 항목의 이름',{exact:true}).fill('편안한 여행 노트');
 await proposals.getByRole('button',{name:'이 이름으로 항목 준비하기',exact:true}).click();
 await proposals.getByRole('checkbox',{name:'편안한 여행 노트',exact:true}).waitFor();
 evidence.emptyTargetRecovery=true;
 await proposals.getByLabel('무엇을 도와드릴까요?',{exact:false}).selectOption('brief');
 await proposals.getByRole('button',{name:'이 내용으로 AI 제안받기',exact:true}).click();
 await proposals.getByRole('heading',{name:'후보 도착 · 마음에 드는 내용을 골라 주세요',exact:true}).waitFor({timeout:20000});
 assert.equal(await proposals.getByRole('button',{name:'이 후보를 설계에 반영',exact:true}).count(),3);
 await proposals.getByRole('button',{name:'이 후보를 설계에 반영',exact:true}).first().click();
 await proposals.getByRole('button',{name:'설계에 반영했어요',exact:true}).waitFor();
 assert.equal(await visibleAnswers.first().inputValue(),'Synthetic fixture value');
 evidence.proposalApply=true;

 for(const name of ['이용 순서','참고 이미지','분위기 정하기','색·글자와 자료','설계 요약','만들기 준비','결과 확인·수정']){
  await workspace.getByRole('navigation',{name:'설계의 여덟 작업 탭'}).getByRole('button',{name,exact:true}).click();
  assert(await workspace.getByRole('region',{name:'현재 단계 안내'}).isVisible());
 }
 await workspace.getByRole('navigation',{name:'설계의 여덟 작업 탭'}).getByRole('button',{name:'색·글자와 자료',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'style-390.png'),fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 evidence.mobileNoOverflow=true;evidence.allEightTabs=true;
 await workspace.getByRole('navigation',{name:'설계의 여덟 작업 탭'}).getByRole('button',{name:'아이디어 정리',exact:true}).click();
 await page.screenshot({path:path.join(output,'design-390.png'),fullPage:true});
 await page.getByRole('button',{name:'전체 항목',exact:true}).click();
 await page.getByRole('button',{name:'차근차근 (추천)',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.design-actions button[aria-pressed="true"]')?.textContent==='전체 항목');
 assert.equal(await visibleAnswers.count(),12);
 await page.getByRole('button',{name:'차근차근 (추천)',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.design-actions button[aria-pressed="true"]')?.textContent==='차근차근 (추천)');
 assert.equal(await visibleAnswers.count(),3);assert.equal(await visibleAnswers.first().inputValue(),'Synthetic fixture value');
 evidence.densityPreservesValues=true;assert.deepEqual(errors,[]);evidence.pageErrors=errors;
 await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});await writeFile(path.join(output,'failure.txt'),String(error)+'\n'+await page.locator('body').innerText());throw error;}
finally{await browser.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
