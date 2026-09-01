import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const sharedOriginDoc = new URL(
  '../../../../hackathon-hunter/artifacts/webmcp-shared/ORIGIN_TRIAL.md',
  import.meta.url,
);

function originToken(markup) {
  return markup.match(/<meta\s+http-equiv=["']origin-trial["']\s+content=["']([^"']+)["']\s*\/?>/i)?.[1];
}

test('uses the exact shared origin-trial token once before the app module', async () => {
  const [html, shared] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(sharedOriginDoc, 'utf8'),
  ]);
  const token = originToken(html);
  assert.ok(token, 'origin-trial meta is absent');
  assert.equal(token, originToken(shared));
  assert.equal(html.match(/http-equiv=["']origin-trial["']/gi)?.length, 1);
  assert.equal(html.indexOf('http-equiv="origin-trial"') < html.indexOf('src="./src/app.mjs"'), true);
});

test('ships an MIT license with the public maintainer identity', async () => {
  const license = await readFile(new URL('LICENSE', root), 'utf8');
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 hungson175/);
  assert.match(license, /Permission is hereby granted, free of charge/);
});

test('README takes a cold reviewer from clone to tests and static serve', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8');
  for (const phrase of [
    'Ninety Days',
    'npm test',
    'npm run serve',
    '28/28',
    '1440×900',
    '390×844',
    '4 → 5 → 6 → 5',
    '3 months',
    'not AMT owed',
    'not tax or legal advice',
  ]) {
    assert.equal(readme.includes(phrase), true, `README missing: ${phrase}`);
  }
  assert.doesNotMatch(readme, /6,180|\$52,000|90 calendar days/);
});

test('404 fallback is byte-identical to the project-path-safe entry page', async () => {
  const [html, fallback] = await Promise.all([
    readFile(new URL('index.html', root)),
    readFile(new URL('404.html', root)),
  ]);
  assert.deepEqual(fallback, html);
  const source = html.toString('utf8');
  assert.match(source, /href="\.\/styles\.css"/);
  assert.match(source, /src="\.\/src\/app\.mjs"/);
  assert.doesNotMatch(source, /(?:href|src)="\/(?!\/)/);
});

test('uses a real static serve command without an uninstalled build stack', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.scripts.serve, 'python3 -m http.server 8000');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
