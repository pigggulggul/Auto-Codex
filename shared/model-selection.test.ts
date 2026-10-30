import {expect,it} from 'vitest';
import type {ModelInfo} from './protocol.js';
import {defaultModel,isSixSeries,preferredModelCatalog} from './model-selection.js';

const model=(name:string,isDefault=false):ModelInfo=>({id:name,model:name,displayName:name,hidden:false,isDefault,inputModalities:['text'],supportsPersonality:false,supportedReasoningEfforts:[{reasoningEffort:'low'}]});
it('prefers returned 6-series models over a legacy default and preserves server order/effort metadata',()=>{
  const old=model('gpt-5.2-codex',true),astra=model('gpt-6-astra'),sol=model('gpt-6.1-sol',true);
  const offered=[old,astra,sol];expect(preferredModelCatalog(offered)).toEqual([astra,sol]);expect(defaultModel(offered)).toBe(sol);
  expect(defaultModel([old,astra])).toBe(astra);expect(offered[0]).toBe(old);expect(defaultModel(offered)?.supportedReasoningEfforts).toEqual(sol.supportedReasoningEfforts);
});
it('recognizes the family by model ID and retains non-6 catalogs without synthesizing unavailable models',()=>{
  for(const name of ['gpt-6-astra','gpt-6.1-sol','gpt-6.1-terra','gpt-6-luna'])expect(isSixSeries(name)).toBe(true);
  for(const name of ['gpt-5.6-sol','gpt-60','synthetic-fixture'])expect(isSixSeries(name)).toBe(false);
  const fixture=[model('fixture')];expect(preferredModelCatalog(fixture)).toBe(fixture);expect(defaultModel(fixture)).toBe(fixture[0]);expect(defaultModel([])).toBeUndefined();
});
