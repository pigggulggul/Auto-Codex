async (page) => {
 const base='http://127.0.0.1:4317';const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('.home,.sidebar').first().waitFor();
 const fixture=await page.evaluate(async()=>{const d=await import('/domain.js');const p=d.makeSample('photo');p.name='QA 확장 검증 · 분기와 첨부';p.settings.density='quick';d.allDecisions(p).forEach(x=>{x.status='confirmed';x.reviewNeeded=false;});p.concepts[0].selected=true;p.intent={choice:'match',reason:'확장 기능의 UI 시험용 데이터',revision:p.revision};const r=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});if(!r.ok)throw new Error(await r.text());const settings=await(await fetch('/api/settings')).json();await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,lastProject:p.id})});return p;});
 await page.reload();await page.locator('.sidebar').waitFor();
 const get=async()=>await(await page.request.get(base+'/api/projects/'+fixture.id)).json();
 const tab=async name=>{await page.locator(`.sidebar [data-tab="${name}"]`).click();await page.locator(`.sidebar [data-tab="${name}"].active`).waitFor();};
 const saved=async()=>{await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='로컬에 자동 저장됨');};
 await tab('flow');await page.locator('[data-action="add-screen"]').click();
 const failure=await page.locator('.editor details.item').last().getAttribute('data-locate');
 const failureBox=page.locator(`[data-locate="${failure}"]`);await failureBox.evaluate(e=>e.open=true);
 await failureBox.locator('[data-prop="value"]').fill('권한 실패 상태');await failureBox.locator('[data-prop="role"]').fill('오류와 가능한 복구 행동 안내');await failureBox.locator('select.status-select').selectOption('confirmed');
 await page.locator(`[data-action="flow-screen"][value="${failure}"]`).check();
 if(!(await page.locator('.graph-errors').innerText()).includes('도달할 수 없습니다'))throw new Error('Unreachable screen was not detected');
 const flow=fixture.flows[0].id,start=fixture.screens[0].id;
 const openRows=async()=>page.locator('.graph-rows').evaluate(e=>e.open=true);
 async function newEdge(from,to,kind,condition,preserve){
  await page.locator('[data-action="graph-add"]').click();await openRows();const eid=await page.locator('.graph-edge').last().getAttribute('data-edge-id');
  for(const [key,value]of [['from',from],['to',to],['kind',kind]]){await openRows();await page.locator(`[data-edge="${eid}"][data-graph-key="${key}"]`).selectOption(value);}
  await openRows();await page.locator(`[data-edge="${eid}"][data-graph-key="condition"]`).fill(condition);await page.locator(`[data-edge="${eid}"][data-graph-key="preserve"]`).fill(preserve);
 }
 await newEdge(start,failure,'branch','카메라 권한을 얻지 못함','입력한 원문과 선택');
 await page.locator('[data-action="graph-ack"]').click();if(!(await page.locator('#toast').innerText()).includes('돌아갈 수 없습니다'))throw new Error('Dead-end branch was accepted');
 await newEdge(failure,start,'recovery','가져오기 선택 또는 다시 시도','원본 파일과 편집 상태');await page.locator('[data-action="graph-ack"]').click();await saved();
 let data=await get();if(data.flows[0].graph.reviewedVersion!==data.flows[0].graph.version)throw new Error('Graph not acknowledged');
 await page.locator('.graph-editor').scrollIntoViewIfNeeded();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.editor')).opacity==='1');await page.screenshot({path:'outputs/atelier/docs/08-flow-graph.png',fullPage:false});
 await tab('style');
 async function asset(name,file,screen){
  await page.locator('[data-action="add-asset"]').click();const box=page.locator('.editor article.item').last(),id=await box.getAttribute('data-locate');
  await box.locator('[data-prop="value"]').fill(name);await box.locator('[data-prop="purpose"]').fill('선택한 화면의 실제 리소스');await box.locator('[data-prop="rules"]').fill('원본의 형식과 비율을 유지');
  await box.locator('input[data-upload="asset"]').setInputFiles(file);
  await page.waitForFunction(id=>!!document.querySelector(`[data-locate="${id}"] .file-preview`),id);await saved();
  const fresh=page.locator(`[data-locate="${id}"]`);await fresh.locator('select.status-select').selectOption('confirmed');
  await fresh.locator('.dependency-editor').evaluate(e=>e.open=true);await fresh.locator(`[data-action="link-decision"][data-link="screenIds"][value="${screen}"]`).check();await saved();return id;
 }
 const root='C:/Users/user01/Documents/Codex/2026-10-29/mvp-1-v1-3-https-ui-2/outputs/atelier/';
 const doc=await asset('선택 화면의 작업 문서',root+'README.md',start);
 const font=await asset('선택 화면의 실제 제목 서체',root+'public/assets/instrument-serif.woff2',start);
 const unrelated=await asset('UNRELATED QA JSON 자료',root+'package.json',failure);
 const fontRule=fixture.styles.find(s=>s.role==='서체').id;
 const fontBox=page.locator(`[data-locate="${fontRule}"]`);await fontBox.locator('.dependency-editor').evaluate(e=>e.open=true);await fontBox.locator('[data-prop="fontAssetId"]').selectOption(font);await saved();
 await page.waitForFunction(()=>document.querySelector('.style-sample')?.style.getPropertyValue('--project-font').includes('AtelierProject_'));
 const background=page.locator(`[data-locate="${fixture.styles[0].id}"]`);await background.locator('.dependency-editor').evaluate(e=>e.open=true);await background.locator(`[data-action="link-decision"][data-link="screenIds"][value="${start}"]`).check();await saved();
 await tab('flow');const screenBox=page.locator(`[data-locate="${start}"]`);await screenBox.evaluate(e=>e.open=true);await screenBox.locator('details').first().evaluate(e=>e.open=true);await screenBox.locator(`[data-action="review-decision"][data-id="${start}"]`).click();await saved();
 await tab('prompt');await page.locator('#output-scope-mode').selectOption('screens');await page.locator(`[data-action="output-target"][value="${start}"]`).check();await saved();
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.editor')).opacity==='1');await page.screenshot({path:'outputs/atelier/docs/09-scoped-output.png',fullPage:false});
 await tab('brief');const outstanding=await page.locator('.issue').allTextContents();if(outstanding.length)throw new Error('Scope blockers: '+outstanding.join(' | '));
 await page.locator('#intent-reason').fill('선택한 시작 화면과 연결한 실제 문서·서체만 전달한다.');await page.locator('[data-action="confirm-intent"]').click();await saved();
 await tab('prompt');await page.locator('[data-action="assemble"]').click();await page.locator('.prompt-preview').waitFor();await saved();data=await get();const snap=data.snapshots.at(-1),other=data.assets.find(a=>a.id===unrelated);
 if(snap.referenceFileIds.length!==2||snap.referenceFileIds.includes(other.fileId)||snap.text.includes('UNRELATED QA JSON'))throw new Error('Unrelated scope content leaked');
 if(!snap.text.includes('결과 예시와 시작 방법'))throw new Error('Selected screen role missing');
 const bundle=await page.request.get(`${base}/api/projects/${data.id}/bundle?snapshot=${snap.id}`);if(!bundle.ok())throw new Error('Scoped bundle failed');const zip=await bundle.body();if(zip.includes(Buffer.from(other.fileId))||zip.includes(Buffer.from('UNRELATED QA JSON')))throw new Error('Unrelated ZIP content leaked');
 const backup=await(await page.request.get(`${base}/api/projects/${data.id}/backup`)).json();const restore=await page.request.post(base+'/api/restore',{data:backup});if(!restore.ok())throw new Error('Non-image restore failed');const clone=await restore.json();const restoredFiles=await(await page.request.get(`${base}/api/projects/${clone.id}/files`)).json();if(restoredFiles.files.length!==3||restoredFiles.missing.length)throw new Error('Non-image files not restored');await page.request.delete(base+'/api/projects/'+clone.id,{data:{}});
 await page.setViewportSize({width:390,height:844});await page.reload();await page.locator('#output-scope-mode').waitFor();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.editor')).opacity==='1');await page.screenshot({path:'outputs/atelier/docs/10-mobile-scope.png',fullPage:false});const width=await page.evaluate(()=>document.documentElement.scrollWidth);if(width>390)throw new Error('Mobile horizontal overflow '+width);
 if(errors.length)throw new Error(errors.join('\n'));return {projectId:data.id,structuredBranches:10,unreachableAndDeadEndBlocked:true,localFontRendered:true,uploadedTypes:['Markdown','WOFF2','JSON'],scopedAttachmentCount:2,backupRestoredAllThreeFiles:true,mobileScrollWidth:width,pageErrors:errors};
}
