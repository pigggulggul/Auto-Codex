// Local-only verification of the shipped domain modules and preserved source fixtures.
// Run after npm run build. Does not start a server or read user history/data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {createDomain, SCHEMA_VERSION, TEMPLATE_VERSION} from '../build-server/shared/atelier/index.js';

const root = new URL('../', import.meta.url);
const flag=process.argv.indexOf('--manifest'),manifestPath=flag>=0?process.argv[flag+1]:'docs/atelier/STAGE2_SOURCE_MANIFEST.json';
assert(['docs/atelier/STAGE2_SOURCE_MANIFEST.json','docs/atelier/STAGE8_SOURCE_MANIFEST.json'].includes(manifestPath),'Choose an explicitly recorded repository baseline.');
const manifest = JSON.parse(await readFile(new URL(manifestPath, root), 'utf8'));
const sourcePaths = [
  'atelier/atelier/public/domain.js', 'atelier/atelier/public/structure.js', 'atelier/atelier/public/guide.js',
  'atelier/atelier/contracts.d.ts', 'atelier/atelier/src/project-validation.mjs',
  'atelier/atelier/public/app.js', 'atelier/atelier/public/panels.js',
  'atelier/atelier/tests/domain.test.mjs', 'atelier/atelier/tests/extension.test.mjs',
  ...(await readdir(new URL('atelier/atelier/examples/', root)))
    .filter(name => name.endsWith('.atelier.json')).map(name => `atelier/atelier/examples/${name}`)
];
assert.equal(manifest.files.length, sourcePaths.length);
for (const path of sourcePaths) {
  const entry = manifest.files.find(file => file.path === path);
  assert(entry, `Source manifest missing: ${path}`);
  const bytes = await readFile(new URL(path, root));
  const digest=value=>createHash('sha256').update(value).digest('hex');
  if(entry.lfSha256)assert.equal(digest(bytes.toString('utf8').replace(/\r\n/g,'\n')),entry.lfSha256,`Source content changed: ${path}`);
  else assert.equal(digest(bytes), entry.sha256, `Source changed: ${path}`);
}

let sequence = 0;
const domain = createDomain({id: prefix => `${prefix}_${++sequence}`, now: () => '2026-10-29T00:00:00.000Z'});
const p = domain.newProject({name: '빌드 모듈 검증', idea: '컴파일된 순수 모듈의 합성 입력'});
assert.equal(domain.ready(p), false);
const snapshot = domain.baseline(p, '합성 입력의 빌드 검증');
assert.equal(snapshot.draft, true);
assert(Object.isFrozen(snapshot.input.fields.user));
assert.throws(() => {snapshot.input.fields.user.value = 'tampered';}, TypeError);
assert.equal(p.results.length, 0);
assert.equal(p.reviews.length, 0);
assert(snapshot.text.includes('진단용 기준'));
console.log(JSON.stringify({
  sourceFilesVerified: sourcePaths.length, SCHEMA_VERSION, TEMPLATE_VERSION,
  draft: snapshot.draft, frozen: Object.isFrozen(snapshot), results: p.results.length, reviews: p.reviews.length
}));
