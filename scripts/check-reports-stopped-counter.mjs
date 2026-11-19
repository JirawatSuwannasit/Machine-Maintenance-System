// Actual reports page/charts with synthetic Supabase reads only; no live data.
// npm install --prefix /tmp/mms039-tools --no-package-lock playwright esbuild
// MMS039_TEST_TOOLS=/tmp/mms039-tools node scripts/check-reports-stopped-counter.mjs
// Requires Chromium, Python PyMuPDF and pdftoppm. Artifacts: /tmp/mms039-reports.
// MMS-040 hover/PDF regression artifacts: /tmp/mms040-tooltip-pdfs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';

const requireTools = createRequire(resolve(process.env.MMS039_TEST_TOOLS || '/tmp/mms039-tools', 'package.json'));
const { build } = requireTools('esbuild');
const { chromium } = requireTools('playwright');
const repo = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'mms039-'));
const artifacts = '/tmp/mms039-reports';
mkdirSync(artifacts, { recursive: true });
const tooltipArtifacts = '/tmp/mms040-tooltip-pdfs';
mkdirSync(tooltipArtifacts, { recursive: true });
const labels = ['จำนวนครั้งที่เสียทั้งหมด', 'จำนวนครั้งที่เครื่องหยุด', 'Downtime รวม', 'MTTR เฉลี่ย', 'ต้นทุนบำรุงรักษารวม'];
const b = (id, date, impact = 'stopped', status = 'open', downtime = null, outcome = null) => ({
  id, machine_id: 'm1', reported_at: date, operating_impact: impact, status,
  downtime_minutes: downtime, closure_outcome: outcome, repair_cost: '100.00',
});
const fixture = {
  machines: [{ id: 'm1', machine_code: 'TH4' }],
  breakdowns: [
    b('open', '2026-11-10T00:00:00Z'),
    b('progress', '2026-11-10T08:00:00Z', 'stopped', 'in_progress', 0),
    b('repaired', '2026-11-10T09:00:00Z', 'stopped', 'closed', 60, 'repaired'),
    b('not-repaired', '2026-11-10T10:00:00Z', 'stopped', 'closed', null, 'not_repaired'),
    b('running', '2026-11-10T11:00:00Z', 'running', 'closed', 120, 'repaired'),
    b('limited', '2026-11-10T12:00:00Z', 'limited', 'open', 60),
    b('last-day', '2026-11-19T23:59:59Z'),
    b('legacy-stored-stopped', '2026-10-01T00:00:00Z'),
    b('three-month-boundary', '2026-08-19T00:00:00Z'),
    b('six-month-boundary', '2026-05-19T00:00:00Z'),
    b('before-six-months', '2026-05-18T23:59:59Z'),
    b('after-last-day', '2026-11-20T00:00:00Z'),
  ],
  pm_plans: [{ id: 'plan1', pm_name: 'ทดสอบ PM', machine_id: 'm1', frequency_days: 30, is_active: true }],
  pm_records: [
    { id: 'pm0', pm_plan_id: 'plan1', machine_id: 'm1', done_date: '2026-07-01', pm_cost: '0.00' },
    { id: 'pm1', pm_plan_id: 'plan1', machine_id: 'm1', done_date: '2026-11-11', pm_cost: '50.00' },
  ],
  part_replacements: [{ id: 'r1', machine_id: 'm1', replaced_at: '2026-11-10', qty_used: 1, unit_cost: '100.00', total_cost: '100.00', reason: 'planned' }],
  queries: [], writes: 0,
};
const transport = `export const supabase={from(table){
 const q={table,columns:'',filters:[]};
 const c={select(s){q.columns=s;return c},gte(k,v){q.filters.push([k,'gte',v]);return c},lt(k,v){q.filters.push([k,'lt',v]);return c},lte(k,v){q.filters.push([k,'lte',v]);return c},eq(k,v){q.filters.push([k,'eq',v]);return c},order(){return c},
 then(a,b){window.__db.queries.push(q);return Promise.resolve({data:structuredClone(window.__db[table].filter(r=>q.filters.every(([k,op,v])=>op==='gte'?r[k]>=v:op==='lt'?r[k]<v:op==='lte'?r[k]<=v:r[k]===v))),error:null}).then(a,b)},
 insert(){window.__db.writes++;throw Error('Mutation forbidden')},update(){window.__db.writes++;throw Error('Mutation forbidden')},delete(){window.__db.writes++;throw Error('Mutation forbidden')}
 };return c;
}};`;
const inspectPdf = (file) => JSON.parse(execFileSync('python', ['-c', String.raw`
import fitz,json,sys
d=fitz.open(sys.argv[1]);out=[]
for p in d:
 out.append({'text':p.get_text(),'width':p.rect.width,'height':p.rect.height,
 'bad':[w[:4] for w in p.get_text('words') if w[0]<35 or w[1]<35 or w[2]>p.rect.width-35 or w[3]>p.rect.height-35]})
print(json.dumps(out,ensure_ascii=False))`, file], { encoding: 'utf8' }));
let browser, server, cases = 0;
const errors = [];
try {
  await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './app/reports/page';createRoot(document.getElementById('root')).render(<Page/>);`, resolveDir: repo, loader: 'tsx' }, bundle: true, outfile: join(temp, 'app.js'), jsx: 'automatic', plugins: [{ name: 'fixture-only', setup(b) {
    b.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: 'supabase', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: transport, loader: 'js' }));
  } }] });
  execFileSync(join(repo, 'node_modules/.bin/tailwindcss'), ['-i', 'app/globals.css', '-o', join(temp, 'app.css')], { stdio: 'pipe' });
  server = createServer((req, res) => {
    const file = req.url === '/app.js' ? 'app.js' : req.url === '/app.css' ? 'app.css' : null;
    res.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html');
    res.end(file ? readFileSync(join(temp, file)) : '<html lang="th"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body class="bg-surface text-primary" style="font-family:Tahoma,\'Noto Sans Thai\',sans-serif"><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Bangkok' });
  await context.route('**/*', r => r.request().url().startsWith(url) ? r.continue() : r.abort());
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-19T05:00:00Z'));
  await page.addInitScript(db => { window.__db = db; window.__printCalls = 0; window.print = () => window.__printCalls++; }, fixture);
  await page.goto(url);
  const tile = label => page.getByText(label, { exact: true }).locator('..');
  const grid = tile(labels[0]).locator('..');
  async function checkSummary(total, stopped, cost) {
    await page.waitForFunction(([label, value]) => [...document.querySelectorAll('p')].find(p => p.textContent === label)?.nextElementSibling?.textContent.trim() === value, [labels[0], `${total} ครั้ง`]);
    assert.equal(await tile(labels[1]).locator('p').nth(1).textContent(), `${stopped} ครั้ง`);
    assert.equal(await tile(labels[2]).locator('p').nth(1).textContent(), total ? '4.0 ชม.' : '0.0 ชม.');
    assert.equal(await tile(labels[3]).locator('p').nth(1).textContent(), total ? '1.5 ชม.' : '-');
    assert.equal(await tile(labels[4]).locator('p').nth(1).textContent(), `${cost.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท`);
    assert.deepEqual(await grid.locator(':scope > div > p:first-child').allTextContents(), labels);
    cases++;
  }
  await checkSummary(9, 7, 1050);
  assert.ok((await tile(labels[4]).textContent()).includes('ค่าซ่อม900.00 บาทค่า PM50.00 บาทค่าอะไหล่100.00 บาท'));
  const query = await page.evaluate(() => window.__db.queries.find(q => q.table === 'breakdowns'));
  assert.ok(query.columns.includes('operating_impact'));
  assert.deepEqual(query.filters, [['reported_at', 'gte', '2026-08-19'], ['reported_at', 'lt', '2026-11-20']]);
  await page.getByRole('button', { name: 'เดือนนี้', exact: true }).click(); await checkSummary(7, 5, 850);
  await page.getByRole('button', { name: '6 เดือน', exact: true }).click(); await checkSummary(10, 8, 1150);
  await page.getByRole('button', { name: 'กำหนดเอง', exact: true }).click();
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2026-11-10'); await dates.nth(1).fill('2026-11-10'); await checkSummary(6, 4, 700);
  await dates.nth(0).fill('2026-11-12'); await dates.nth(1).fill('2026-11-12'); await checkSummary(0, 0, 0);
  await page.getByRole('button', { name: '3 เดือน', exact: true }).click(); await checkSummary(9, 7, 1050);
  // Same ID changes status/outcome in the fixture; reloading reports never adds an event.
  await page.evaluate(() => Object.assign(window.__db.breakdowns.find(b => b.id === 'open'), { status: 'closed', closure_outcome: 'not_repaired' }));
  await page.getByRole('button', { name: 'เดือนนี้', exact: true }).click(); await checkSummary(7, 5, 850);
  await page.getByRole('button', { name: '3 เดือน', exact: true }).click(); await checkSummary(9, 7, 1050);
  for (const width of [375, 768, 1440]) {
    await page.mouse.move(0, 0);
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    // Recharts applies ResizeObserver measurements asynchronously after a resize.
    await page.waitForTimeout(250);
    if (width === 375) await page.screenshot({ path: join(artifacts, 'mobile-375.png'), fullPage: true });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => ({tag: el.tagName, class: el.getAttribute('class'), right: el.getBoundingClientRect().right})) }));
    assert.ok(overflow.scroll <= overflow.width, `${width}px: no page overflow: ${JSON.stringify(overflow)}`);
    const bounds = await grid.locator(':scope > div').evaluateAll(els => els.map(el => ({ top: el.getBoundingClientRect().top, width: el.getBoundingClientRect().width, clipped: el.scrollWidth > el.clientWidth })));
    assert.ok(bounds.every(b => !b.clipped), `${width}px: no clipped card content`);
    if (width === 1440) assert.equal(new Set(bounds.map(b => b.top)).size, 1, 'desktop five-card row');
    if (width === 375) {
      assert.ok(bounds[4].width > bounds[0].width * 1.9, 'mobile cost card spans both columns');
      await page.screenshot({ path: join(artifacts, 'mobile-375.png'), fullPage: true });
    }
    cases++;
  }
  await page.getByRole('button', { name: '🖨 พิมพ์ / บันทึก PDF', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__printCalls), 1);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(250);
  async function pdf(name) {
    const file = join(artifacts, `${name}.pdf`);
    await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    return inspectPdf(file);
  }
  // Reference pagination of the previous four-card summary with the same charts/data.
  const baselineStyle = await page.addStyleTag({ content: '#printable-report > .grid { grid-template-columns:repeat(4,minmax(0,1fr))!important; } #printable-report > .grid > div:nth-child(2) {display:none!important;} #printable-report > .grid > div:last-child {grid-column:auto!important;}' });
  const baseline = await pdf('four-card-reference'); await baselineStyle.evaluate(el => el.remove());
  const printed = await pdf('five-card-report');
  assert.equal(printed.length, baseline.length, 'no extra physical pages');
  const compactText = text => text.replace(/\s/g, '');
  for (const label of labels) assert.ok(compactText(printed[0].text).includes(compactText(label)), `${label}: on first page`);
  assert.ok(compactText(printed[0].text).includes('จำนวนครั้งที่เครื่องหยุด7ครั้ง'));
  for (const p of printed) {
    assert.ok(Math.abs(p.width - 595.28) < 1 && Math.abs(p.height - 841.89) < 1, 'existing A4 portrait orientation');
    assert.deepEqual(p.bad, [], 'no text outside printable bounds');
  }
  const charts = await page.locator('.report-chart-card > h2').allTextContents();
  assert.equal(charts.length, 6);
  for (const title of charts) {
    assert.ok(compactText(printed.map(p => p.text).join('')).includes(compactText(title)));
    assert.ok(compactText(baseline.map(p => p.text).join('')).includes(compactText(title)));
  }
  assert.equal(await page.locator('.recharts-wrapper').count(), 5, 'all existing charts rendered');
  execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '1600', '-png', join(artifacts, 'five-card-report.pdf'), join(artifacts, 'pdf-first-page')], { stdio: 'pipe' });
  cases++;
  // Keep the pointer over each real chart, then activate the existing print
  // button via DOM click (Playwright.click would move the pointer away).
  // page.pdf exercises Chromium's print rendering with the tooltip still active.
  for (const [index, name] of ['breakdown', 'downtime', 'replacement-pie', 'machine-cost', 'monthly-cost'].entries()) {
    await page.emulateMedia({ media: 'screen' });
    const chart = page.locator('.recharts-wrapper').nth(index);
    const tooltip = chart.locator('.recharts-tooltip-wrapper');
    await chart.scrollIntoViewIfNeeded();
    if (index === 1) {
      const tick = chart.locator('.recharts-xAxis .recharts-cartesian-axis-tick').filter({ hasText: '09/2026' });
      const labelBounds = await tick.boundingBox();
      const chartBounds = await chart.boundingBox();
      await page.mouse.move(labelBounds.x + labelBounds.width / 2, chartBounds.y + chartBounds.height / 2);
    } else {
      await chart.locator(index === 2 ? '.recharts-pie-sector path' : '.recharts-bar-rectangle path').first().hover();
    }
    await page.waitForFunction(i => document.querySelectorAll('.recharts-wrapper')[i].querySelector('.recharts-tooltip-wrapper').style.visibility === 'visible', index);
    const tooltipText = await tooltip.textContent();
    assert.ok(tooltipText.trim().length > 0, `${name}: real hover tooltip has content`);
    if (index === 0) assert.ok(tooltipText.includes('TH4'));
    if (index === 1) assert.ok(tooltipText.includes('09/2026'));
    assert.equal(await tooltip.evaluate(el => getComputedStyle(el).display), 'block', `${name}: screen tooltip works`);
    const cursor = chart.locator('.recharts-tooltip-cursor');
    if (index !== 2) assert.ok(await cursor.count() > 0, `${name}: actual hover cursor DOM verified`);
    const dataSelector = index === 2 ? '.recharts-pie-sector path' : '.recharts-bar-rectangle path';
    const shapes = await chart.locator(dataSelector).evaluateAll(els => els.map(el => ({ d: el.getAttribute('d'), fill: el.getAttribute('fill') })));
    await page.screenshot({ path: join(tooltipArtifacts, `${name}-screen-hover.png`), fullPage: true });
    const callsBefore = await page.evaluate(() => window.__printCalls);
    await page.getByRole('button', { name: '🖨 พิมพ์ / บันทึก PDF', exact: true }).evaluate(el => el.click());
    assert.equal(await page.evaluate(() => window.__printCalls), callsBefore + 1);
    assert.equal(await tooltip.evaluate(el => el.style.visibility), 'visible', `${name}: tooltip still active at print request`);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(250); // existing print chart dimensions resize via ResizeObserver
    assert.deepEqual(await tooltip.evaluate(el => ({ display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility })), { display: 'none', visibility: 'hidden' });
    assert.ok((await cursor.evaluateAll(els => els.map(el => getComputedStyle(el).display))).every(display => display === 'none'));
    const file = join(tooltipArtifacts, `${name}.pdf`);
    await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    const output = inspectPdf(file);
    assert.deepEqual(output, printed, `${name}: exact PDF text, page count, orientation and bounds match the no-hover report`);
    assert.ok(output.some(p => p.text.includes('TH4')), 'legitimate machine axis labels remain');
    assert.ok(output.some(p => p.text.includes('09/2026')), 'legitimate month axis labels remain');
    for (let p = 1; p <= output.length; p++) {
      execFileSync('pdftoppm', ['-f', String(p), '-singlefile', '-scale-to', '1600', '-png', file, join(tooltipArtifacts, `${name}-page-${p}`)], { stdio: 'pipe' });
    }
    await page.emulateMedia({ media: 'screen' });
    await page.waitForTimeout(250);
    // Restore hover after the print layout resize, proving the print-only rules
    // did not disable normal tooltips or alter chart data/colors.
    if (index === 1) {
      const tickBounds = await chart.locator('.recharts-xAxis .recharts-cartesian-axis-tick').filter({ hasText: '09/2026' }).boundingBox();
      const bounds = await chart.boundingBox();
      await page.mouse.move(tickBounds.x + tickBounds.width / 2, bounds.y + bounds.height / 2);
    } else await chart.locator(dataSelector).first().hover();
    await page.waitForFunction(i => document.querySelectorAll('.recharts-wrapper')[i].querySelector('.recharts-tooltip-wrapper').style.visibility === 'visible', index);
    assert.equal(await tooltip.evaluate(el => getComputedStyle(el).display), 'block');
    assert.deepEqual(await chart.locator(dataSelector).evaluateAll(els => els.map(el => ({ d: el.getAttribute('d'), fill: el.getAttribute('fill') }))), shapes);
    console.log(`PASS ${name}: actual hover DOM, print-button activation with pointer retained, clean ${output.length}-page PDF, screen tooltip restored.`);
    cases++;
  }
  assert.equal(await page.evaluate(() => window.__db.writes), 0);
  assert.deepEqual(errors, []);
  console.log(`PASS: ${cases} report/filter/layout/PDF scenarios; ${printed.length} A4 portrait pages with all five summary cards and six report sections. No writes. Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  if (server) await new Promise(r => server.close(r));
  rmSync(temp, { recursive: true, force: true });
}
