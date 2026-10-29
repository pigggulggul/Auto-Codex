// Run with the available Playwright page against the local preview.
// Uses the UI for decisions, uploads, prompt assembly, result registration and revision.
async (page) => {
 await page.setViewportSize({width:1440,height:1000});const evidence=[];const external=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4317')&&!r.url().startsWith('data:'))external.push(r.url());});
 await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4317')?route.continue():route.abort());
 const click=action=>page.locator(`[data-action="${action}"]`).first().click();
 const tab=async name=>{await page.locator(`.sidebar [data-tab="${name}"]`).click();await page.locator(`.sidebar [data-tab="${name}"].active`).waitFor();};
 const save=async()=>{await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='로컬에 자동 저장됨');};
 await page.goto('http://127.0.0.1:4317');await page.locator('.wordmark').first().waitFor();
 if(await page.locator('.sidebar').count())await click('home');
 // Four start routes: creation immediately opens an editable real first task.
 const paths=[['idea','design'],['image','reference'],['concept','concept'],['improve','review']];
 for(const [entry,target] of paths){
  await page.locator(`.home [data-action="create"][data-entry="${entry}"]`).click();
  await page.locator('#new-name').fill('QA 경로 '+entry);
  await page.locator('#new-idea').fill('내 생각의 원문 — '+entry);
  await click('create-submit');
  await page.locator(`.sidebar [data-tab="${target}"].active`).waitFor();
  if(!await page.locator('.next-banner').innerText())throw new Error('No first action '+entry);
  const settings=await (await page.request.get('http://127.0.0.1:4317/api/settings')).json();
  const p=await (await page.request.get('http://127.0.0.1:4317/api/projects/'+settings.lastProject)).json();
  if(p.idea!=='내 생각의 원문 — '+entry)throw new Error('Original input lost');
  evidence.push('four-path:'+entry+'→'+target);
  await click('home');await page.request.delete('http://127.0.0.1:4317/api/projects/'+p.id,{data:{}});
  await page.reload();await page.locator('.home').waitFor();
 }
 await page.locator('[data-action="sample"][data-kind="photo"]').click();
 await page.locator('.sidebar').waitFor();await click('density');
 await page.locator('[data-action="density"][data-value="quick"]').click();
 // Confirm each visible decision explicitly through the status control.
 async function confirmVisible(){let guard=0;while(await page.locator('.editor select.status-select:not(.confirmed)').count()){if(guard++>100)throw new Error('status loop');await page.locator('.editor select.status-select:not(.confirmed)').first().selectOption('confirmed');}}
 await confirmVisible();await save();
 await tab('flow');
 await page.locator('.editor details.item').evaluateAll(els=>els.forEach(e=>e.open=true));
 // Rendering after each confirmation closes details; reopen before the next.
 for(let i=0;i<12;i++){await page.locator('.editor details.item').evaluateAll(els=>els.forEach(e=>e.open=true));const next=page.locator('.editor select.status-select:not(.confirmed)').first();if(!await next.count())break;await next.selectOption('confirmed');}
 await tab('concept');await page.locator('[data-action="choose-concept"]').first().click();
 await tab('style');await confirmVisible();await save();
 // Persist actual original and crop files through the reference UI.
 await tab('reference');
 const fixture='C:/Users/user01/Documents/Codex/2026-10-29/mvp-1-v1-3-https-ui-2/outputs/atelier/docs/01-home.png';
 await page.locator('input[data-upload="reference"]').setInputFiles(fixture);
 await page.locator('#reference-original').waitFor();
 await page.locator('#reference-original').evaluate(img=>img.complete?true:new Promise(r=>img.onload=r));
 const box=await page.locator('#reference-stage').boundingBox();
 await page.mouse.move(box.x+box.width*.1,box.y+box.height*.15);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5,{steps:6});await page.mouse.up();
 await page.locator('[data-prop="observation"]').waitFor();
 await page.locator('[data-prop="observation"]').fill('넓은 흰 바탕과 작은 붉은 강조가 대비된다.');
 await page.locator('[data-prop="interpretation"]').fill('조용하면서 행동이 분명하게 느껴진다.');
 await page.locator('[data-prop="target"]').fill('안내와 편집 도구의 강조에만');
 await page.locator('[data-prop="purpose"]').fill('사진을 중심에 두고 조작을 구분하기');
 await page.locator('[data-prop="keep"]').fill('넓은 바탕과 작은 포인트의 관계');
 await page.locator('[data-prop="change"]').fill('사용자가 정한 드레스룸의 핑크로 조정');
 await page.locator('[data-prop="avoid"]').fill('전체 화면 구조는 그대로 복제하지 않음');
 await confirmVisible();await save();
 const projectId=(await(await page.request.get('http://127.0.0.1:4317/api/settings')).json()).lastProject;
 let project=await(await page.request.get('http://127.0.0.1:4317/api/projects/'+projectId)).json();
 if(project.references[0].regions.length!==1||!project.references[0].regions[0].cropId)throw new Error('Crop relation missing');
 evidence.push('actual-original+proportional-region+PNG-crop');
 // Ensure output settings and explicit extra instruction survive generation.
 await tab('prompt');await page.locator('[data-path="output.extra"]').fill('테스트 추가 지시: 사진의 원본 비율을 유지한다.');await save();
 await tab('brief');
 const outstanding=await page.locator('.issue').allTextContents();if(outstanding.length)throw new Error('Outstanding issues: '+outstanding.join('|'));
 await page.locator('#intent-reason').fill('사진이 중심에 있고 촬영·복구 흐름과 장식 적용 범위가 의도에 맞는다.');
 await click('confirm-intent');await save();
 await tab('prompt');await click('assemble');await page.locator('.prompt-preview').waitFor();await save();
 project=await(await page.request.get('http://127.0.0.1:4317/api/projects/'+projectId)).json();
 const snap=project.snapshots.at(-1);
 for(const text of [project.fields.user.value,project.fields.doubt.value,'안내와 편집 도구의 강조에만','테스트 추가 지시'])if(!snap.text.includes(text))throw new Error('Prompt missing '+text);
 evidence.push('confirmed-customer+flow+style+reference→one-prompt');
 const bundle=await page.request.get(`http://127.0.0.1:4317/api/projects/${projectId}/bundle?snapshot=${snap.id}`);if(!bundle.ok())throw new Error('ZIP failed');if((await bundle.body()).readUInt32LE(0)!==0x04034b50)throw new Error('ZIP signature');
 // Explicit result on selected snapshot, real image file, default verdicts unknown.
 await page.locator('[data-action="result-from-snapshot"]').click();
 await page.locator('#result-screen').fill('검증용 꾸미기 화면');await page.locator('#result-source').fill('QA 픽스처 · 실제 제작물 대신 파일·상태 연결을 시험하는 화면');
 await page.locator('#result-note').fill('강조가 넓은 면으로 퍼진 경우를 가정해 수정 흐름을 시험한다. 자동 진단 아님.');
 await page.locator('#result-keep').fill('사진 중심의 위계');await page.locator('#result-file').setInputFiles(fixture);
 await click('result-submit');await page.locator('.modal').waitFor({state:'hidden'});await page.locator('.review-item').first().waitFor();await save();
 project=await(await page.request.get('http://127.0.0.1:4317/api/projects/'+projectId)).json();
 if(!project.reviews.at(-1).items.every(i=>i.verdict==='unverifiable'))throw new Error('Verdicts auto-generated');
 await page.locator('[data-path="reviews.0.items.3.observation"]').fill('테스트 관찰: 강조가 지정 범위보다 넓다.');
 await page.locator('[data-path="reviews.0.items.3.evidence"]').fill('QA 픽스처 화면 중앙 — 실제 스타일 품질 판정이 아닌 동작 시험');
 await page.locator('[data-action="verdict"][data-index="3"][data-value="mismatch"]').click();
 await page.locator('[data-path="reviews.0.items.3.target"]').fill('스타일 적용 범위');
 await page.locator('[data-path="reviews.0.items.3.keep"]').fill('사진 중심의 위계');
 await page.locator('[data-path="reviews.0.items.3.selected"]').check();
 await page.locator('[data-action="plan"]').click();
 await page.locator('#plan-change').fill('선택 강조를 도구와 테두리에만 적용');await page.locator('#plan-check').fill('같은 기준으로 강조 면적과 사진 중심의 위계 다시 비교');
 await click('plan-submit');await page.locator('[data-action="revision-prompt"]').click();await page.locator('.prompt-preview').waitFor();await save();
 await page.locator('[data-action="result-from-snapshot"]').click();
 await page.locator('#result-screen').fill('검증용 수정 결과');await page.locator('#result-source').fill('QA 수정본 픽스처 · 상태 연결 검증용');await page.locator('#result-file').setInputFiles(fixture);await click('result-submit');await page.locator('.modal').waitFor({state:'hidden'});await save();
 project=await(await page.request.get('http://127.0.0.1:4317/api/projects/'+projectId)).json();
 const review=project.reviews.at(-1);if(!review.parentReviewId||!review.items.every(i=>i.verdict==='unverifiable'))throw new Error('Revision lineage or reset failed');
 if(review.items[3].expected!==project.reviews[0].items[3].expected)throw new Error('Frozen criteria changed');
 evidence.push('manual-result→diagnosis→plan→unified-revision→new-result→same-criteria');
 // No completion without actual fresh evidence.
 await page.locator('[data-action="complete-review"]').click();
 if((await(await page.request.get('http://127.0.0.1:4317/api/projects/'+projectId)).json()).reviews.at(-1).state==='completed')throw new Error('False review completion');
 await page.reload();await page.locator('.sidebar [data-tab="review"].active').waitFor();
 if(!await page.locator('.comparison img').count())throw new Error('Result image lost after reload');
 evidence.push('reload-resumes-review-with-images');
 const backup=await(await page.request.get('http://127.0.0.1:4317/api/projects/'+projectId+'/backup')).json();
 const restored=await page.request.post('http://127.0.0.1:4317/api/restore',{data:backup});if(!restored.ok())throw new Error('Restore failed');const rp=await restored.json();
 const restoredFiles=await(await page.request.get(`http://127.0.0.1:4317/api/projects/${rp.id}/files`)).json();if(restoredFiles.missing.length||restoredFiles.files.length<4)throw new Error('Restored files absent');
 await page.request.delete('http://127.0.0.1:4317/api/projects/'+rp.id,{data:{}});
 evidence.push('backup-restores-original+crop+two-results+lineage');
 if(external.length)throw new Error('Unexpected remote requests '+external.join(','));
 evidence.push('all-external-requests-blocked-no-AI');
 return {projectId,evidence,externalRequests:external.length};
}

