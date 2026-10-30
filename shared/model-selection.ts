import type {ModelInfo} from './protocol.js';

export function isSixSeries(model:string):boolean {
  return /^gpt-6(?:[.-]|$)/i.test(model);
}

/** Preserve App Server order and metadata; never invent a model or retry failed inference. */
export function preferredModelCatalog(models:ModelInfo[]):ModelInfo[] {
  const six=models.filter(model=>isSixSeries(model.model));
  return six.length?six:models;
}

export function defaultModel(models:ModelInfo[]):ModelInfo|undefined {
  const candidates=preferredModelCatalog(models);
  return candidates.find(model=>model.isDefault)??candidates[0];
}
