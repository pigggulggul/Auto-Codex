async (page) => {
 const base='http://127.0.0.1:4317';
 const root='C:/Users/user01/Documents/Codex/2026-10-29/mvp-1-v1-3-https-ui-2';
 const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());});
 const saved=async()=>page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='로컬에 자동 저장됨');
 const tab=async name=>{await page.locator(`.sidebar [data-tab="${name}"]`).click();await page.locator(`.sidebar [data-tab="${name}"].active`).waitFor();};
 const shot=async name=>{await saved();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:root+'/outputs/atelier/docs/'+name,fullPage:true,animations:'disabled'});};
 const click=async a=>page.locator('[data-action="'+a+'"]').click();
 await page.goto(base);await page.locator('.sidebar,.home').first().waitFor();await page.setViewportSize({width:1440,height:1000});
 // Rendered fixture is explicit test input, not a real customer's result or generated image analysis.
 const fixturePage=await page.context().newPage();await fixturePage.setViewportSize({width:980,height:720});
 await fixturePage.setContent('<html lang="ko"><meta charset="utf-8"><style>body{font:18px Arial;background:#f5f3ed;color:#34372e;padding:45px}h1{font-size:32px}section{padding:28px;background:white;border:1px solid #ddd;margin:20px 0}button{padding:14px 28px;background:#526940;color:white;border:0;border-radius:6px}small{color:#777}label{display:block;margin:16px 0}</style><small>UX 회귀 검증용 가상 설문 화면 · 외부 서비스 미구현</small><h1>우리 모임, 어떤 시간이 좋나요?</h1><p>원하는 시간을 하나 선택해 주세요.</p><section><strong>참여 가능한 시간</strong><label>○ 평일 저녁</label><label>○ 토요일 오후</label><label>○ 일요일 오후</label></section><button>답변 제출하기</button><p>제출 후 선택한 답을 수정할 수 있습니다.</p></html>');
 await fixturePage.screenshot({path:root+'/work/survey-test-result.png'});await fixturePage.close();
 const cases=[
  {entry:'image',name:'라이어 게임 디자인',idea:'각자의 역할을 확인하고 대화와 투표로 라이어를 찾는 모임용 게임',user:'친구들과 한 기기를 돌려 보는 참가자',goal:'자기 역할을 확인하고 대화·투표 후 라이어와 정답을 확인한다.',features:'참가자 설정\n역할 비공개 확인\n토론 타이머\n라이어 지목 투표\n정답 공개',materials:'주제·단어 목록과 역할 안내 문구',pattern:'round',steps:'참가자와 라운드 설정\n각자 역할 비공개 확인\n대화와 단서 제시\n라이어 지목 투표\n정답과 라이어 공개',style:1,fit:'fun',check:'역할 확인 화면에서 다른 참가자의 비밀 정보가 보이지 않는다.'},
  {entry:'concept',name:'이상형월드컵 사이트 UI',idea:'두 후보 중 하나를 고르며 최종 우승 후보를 찾는 비교 사이트',user:'관심 주제의 후보를 비교하는 방문자',goal:'후보를 두 개씩 비교해 좋아하는 후보를 최종 우승자로 고른다.',features:'주제와 라운드 선택\n두 후보 비교\n후보 선택\n최종 우승 결과',materials:'사용 권리를 확인할 후보 이미지와 이름, 주제별 후보 목록',pattern:'compare',steps:'주제와 후보 수 선택\n두 후보 비교\n선호 후보 선택\n다음 대결 진행\n최종 우승자 확인',style:1,fit:'fun',check:'후보를 선택하면 다음 대결로 넘어가고 마지막에 우승 후보가 표시된다.'},
  {entry:'improve',name:'앙케이트 사이트 UI',idea:'모임 일정에 답변하고 결과를 확인하는 간단한 앙케이트 사이트',user:'모임 일정을 고르는 초대받은 참가자',goal:'참여 가능한 시간을 답변하고 제출 완료 여부와 응답 결과를 확인한다.',features:'앙케이트 질문 읽기\n참여 가능 시간 선택\n응답 검토와 제출\n응답 수정\n집계 결과 확인',materials:'질문 문구와 응답 선택지, 응답 집계 예시 데이터',pattern:'answer',steps:'질문과 참여 방법 확인\n참여 가능 시간 선택\n응답 확인과 제출\n제출 완료 확인\n집계 결과 확인',style:2,fit:'reading',check:'응답 제출 후 완료 안내와 응답 수정 방법을 바로 찾을 수 있다.'}
 ];
 const evidence=[];
 for(const c of cases){
  if(await page.locator('.sidebar').count())await page.locator('.sidebar [data-action=home]').click();await page.locator(`.home [data-action=create][data-entry="${c.entry}"]`).click();
  await page.locator('#new-name').fill(c.name+' · UX 검증');await page.locator('#new-idea').fill(c.idea);await page.locator('#create-submit').click();await page.locator('.sidebar').waitFor();
  if(c.entry==='image'){
   await page.locator('[data-easy-tab=reference]').waitFor();await page.locator('[data-upload=reference]').setInputFiles(root+'/work/reference-layout.png');await page.locator('#reference-original').waitFor();await page.waitForFunction(()=>document.querySelector('#reference-original')?.naturalWidth>0);await click('whole-region');await page.locator('.easy-region').waitFor();
   await page.getByLabel('이미지에서 어떤 특징이 보이나요?',{exact:true}).fill('넓은 연회색 바탕에 진한 제목, 파란 주요 버튼과 단순한 흰색 패널이 보인다.');
   await page.getByLabel('내 프로젝트의 어디에 쓸까요?',{exact:true}).fill('역할 확인 화면의 배경과 다음 참가자 버튼');await page.getByLabel('이 특징이 어떤 도움이 되나요?',{exact:true}).fill('한 명씩 역할을 읽고 다음 행동을 분명하게 찾도록 돕는다.');await click('easy-reference-confirm');await saved();await shot('14-liar-reference.png');await page.locator('.easy-footer [data-tab=design]').click();await page.locator('[data-easy-tab=design]').waitFor();
  }
  if(c.entry==='concept'){
   await page.locator('[data-easy-tab=concept]').waitFor();await page.locator('#easy-concept-name').fill('후보가 주인공인 두 장 비교 화면');await page.locator('#easy-concept-summary').fill('두 후보를 같은 크기로 나란히, 이름과 진행 라운드는 또렷하게, 선택한 후보만 색으로 강조한다.');await click('easy-custom-concept');await page.locator('#easy-fit').selectOption('fun');await click('easy-direction');await page.locator('[data-easy-tab=design]').waitFor();
  }
  if(c.entry==='improve'){
   await page.locator('#review-wanted').fill('응답을 제출하면 완료 안내와 답변 수정 버튼이 바로 보이는 설문 화면');await page.locator('#review-problem').fill('제출 전 안내만 있어 제출 후 응답 수정 위치를 알 수 없다.');await click('easy-start-review');await page.locator('#result-file').waitFor();
   await page.locator('#result-screen').fill('설문 참여 화면 · 검증용 가상 결과');await page.locator('#result-source').fill('회귀 검증용 HTML 직접 렌더 · 실제 외부 서비스 미구현');await page.locator('#result-file').setInputFiles(root+'/work/survey-test-result.png');await page.locator('#result-note').fill('제출 버튼은 보이지만 완료 후 수정 위치는 이 화면에서 알 수 없음');await click('result-submit');await page.locator('.review-item').waitFor();
   if(await page.locator('.review-item').count()!==1)throw Error('Guided comparison should show one criterion');
   await page.locator('[data-action=easy-review-step][data-index="3"]').click();await page.locator('.review-item textarea').first().fill('따뜻한 연한 바탕과 진한 본문, 초록 버튼이 보인다. 원래 정확한 색 규칙은 미정이다.');await page.locator('.review-item textarea').nth(1).fill('등록한 HTML 검증 화면 전체');await page.locator('.review-item [data-action=verdict][data-value=unverifiable]').click();await saved();await shot('15-survey-review.png');
  }
  await tab('design');await page.locator('[data-easy-tab=design]').waitFor();
  if(await page.locator('[data-action=easy-design-back]').count())await click('easy-design-back');
  await click('easy-original');await page.getByLabel('누가 사용하나요?',{exact:true}).fill(c.user);await page.getByLabel('사용자가 여기서 마칠 핵심 작업',{exact:true}).fill(c.goal);await page.locator('#easy-environment').selectOption({label:'둘 다'});await click('easy-basics');await page.locator('#easy-featuresText').fill(c.features);await page.locator('[data-action=easy-help-choice][data-value=steps]').click();await page.locator('#easy-materials').fill(c.materials);await click('easy-features');await page.locator('[data-easy-tab=flow]').waitFor();
  await page.locator(`[data-action=easy-pattern][data-id="${c.pattern}"]`).click();await page.locator('#easy-flowText').fill(c.steps);await page.locator('#easy-back').selectOption('back');await page.locator('#easy-recovery').selectOption('previous');if(c.entry==='image')await page.locator('[data-path="progress.easy.loop"]').check();await click('easy-flow');await page.locator('[data-easy-tab=reference]').waitFor();await page.locator('.easy-footer [data-tab=concept]').click();await page.locator('[data-easy-tab=concept]').waitFor();
  if(c.entry!=='concept')await page.locator(`[data-action=easy-palette][data-index="${c.style}"]`).click();await page.locator('#easy-fit').selectOption(c.fit);await click('easy-direction');await page.locator('[data-easy-tab=style]').waitFor();
  await page.locator('[data-action=easy-check][value=start]').check();await page.locator('[data-action=easy-check][value=finish]').check();await page.locator('#easy-customCheck').fill(c.check);await click('easy-style');await page.locator('[data-easy-tab=brief]').waitFor();
  const issueTexts=await page.locator('.easy-issue').allTextContents();if(issueTexts.length)throw Error(c.name+' blocked: '+issueTexts.join(' / '));
  await click('easy-intent');await page.locator('[data-action=assemble]').waitFor();await click('assemble');await page.locator('.prompt-preview').waitFor();await saved();
  const prompt=await page.locator('.prompt-preview').innerText();if(/촬영|네 장|꾸미기|거점|채집/.test(prompt))throw Error('Unrelated sample leaked');for(const step of c.steps.split('\n'))if(!prompt.includes(step))throw Error('Missing step '+step);if(!prompt.includes(c.check))throw Error('Missing project criterion');
  const id=await page.evaluate(async()=>{const s=await(await fetch('/api/settings')).json();return s.lastProject});const data=await(await page.request.get(base+'/api/projects/'+id)).json();
  await page.reload();await page.locator('.prompt-preview').waitFor();if(await page.locator('.prompt-preview').innerText()!==prompt)throw Error('Prompt changed on reload');
  await shot(c.entry==='image'?'16-liar-prompt.png':c.entry==='concept'?'17-worldcup-prompt.png':'18-survey-prompt.png');
  evidence.push({name:c.name,entry:c.entry,projectId:id,snapshotId:data.snapshots.at(-1).id,stepCount:data.flows[0].steps.length,actualLinks:data.flows[0].graph.transitions.length,referenceFiles:data.references.map(r=>({fileId:r.fileId,crops:r.regions.map(a=>a.cropId)})),promptCharacters:prompt.length,reloadPreserved:true,unrelatedExamples:false,blockingIssues:0});
 }
 if(errors.length)throw Error(errors.join('\n'));if(external.length)throw Error('External requests: '+external.join(','));
 return {passed:evidence,errors,externalRequests:external.length};
}

