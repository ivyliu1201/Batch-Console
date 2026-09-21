import { test, expect, chromium } from './runtime.mjs';

const seedDay = '2026-09-21T04:00:00.000Z';
const up = ['接收前端來源檔', '處理前端來源檔', '傳送後端來源檔'];
const down = ['接收後端結果檔', '處理後端結果檔', '傳送前端結果檔'];
const prepared = ['上傳檔案', '審核完成'];
const errors = new WeakMap();

async function freeze(page, date = seedDay) {
  await page.addInitScript(value => {
    const OriginalDate = Date;
    window.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [value])); }
      static now() { return new OriginalDate(value).getTime(); }
    };
  }, date);
}
test.beforeEach(async ({ page }) => {
  const found = [];
  errors.set(page, found);
  page.on('pageerror', error => found.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.url().startsWith('http://127.0.0.1:5173')) found.push(`${response.status()} ${response.url()}`); });
  await freeze(page);
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function role(page, id) {
  await page.locator('.user-menu').click();
  await page.locator(`[data-role="${id}"]`).click();
  await expect(page).toHaveURL(/\/workbench(?:\?|$)/);
}
async function nav(page, id) {
  const link = page.locator(`[data-route="${id}"]`);
  if (!(await link.isVisible())) await page.locator('#sidebar-toggle').click();
  await link.click();
}
async function mode(page, prefix, value) {
  const select = page.locator(`#${prefix}-mode`);
  await expect(select).toHaveRole('combobox');
  await select.click();
  await page.getByRole('option', { name: value, exact: true }).click();
  await expect(select).toHaveText(value);
  await expect(select).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.operation-mode-dialog')).toHaveCount(0);
}
async function modePlaceholder(page, prefix) {
  const select = page.getByRole('combobox', { name: '作業方式', exact: true });
  await expect(select).toHaveAttribute('id', `${prefix}-mode`);
  await expect(select).toHaveText('作業方式');
  await select.click();
  await expect(page.getByRole('listbox', { name: '作業方式' })).toBeVisible();
  await expect(page.getByRole('option')).toHaveText(['手動', '自動']);
  await page.keyboard.press('Escape');
  await expect(select).toBeFocused();
  await expect(page.locator(`label[for="${prefix}-mode"]`)).toBeHidden();
}
async function search(page, value) {
  await page.getByRole('searchbox', { name: '批次編號' }).fill(value);
  await page.getByRole('button', { name: '查詢批次', exact: true }).click();
}
async function audit(page) { return page.evaluate(() => window.BatchConsoleAudit.list()); }
async function snapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('batch-console', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state', 'readonly');
      const read = tx.objectStore('state').get('console');
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}
async function upload(page, filename = 'e2e-source.txt', operation = 'upload') {
  await page.goto(`/operation/${operation}`);
  await page.locator(`.${operation}-job-table tbody tr`).first().getByRole('button', { name: '開啟' }).click();
  await page.locator('.native-file-input').setInputFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n')) });
  await page.locator(`.${operation}-submit-button`).click();
  await page.locator('.confirm-modal .primary-button').click();
  await expect(page.locator(`.${operation}-result-modal`)).toBeVisible();
  const record = (await audit(page)).at(-1);
  await page.locator(`.${operation}-result-modal .modal-actions .primary-button`).click();
  return record;
}
async function capture(page, info, name) {
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true });
  await info.attach(name, { path: info.outputPath(name + '.png'), contentType: 'image/png' });
}
async function pageFits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function viewport(page, width, height = 900) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('main').evaluate(async element => { await Promise.allSettled(element.getAnimations().map(animation => animation.finished)); });
}

test('U01 all pipeline stages fit one desktop row without scrolling', async ({ page }, info) => {
  const flows = [
    ['001', [...up, ...down]], ['010', up], ['011', down],
    ['008', [...prepared, ...up, ...down]], ['009', [...prepared, ...up]], ['012', down],
  ];
  for (const [id, names] of flows) {
    await page.goto(`/search?batch=ABC-20260907-${id}`);
    await expect(page.locator('.stage-name')).toHaveText(names);
    for (const width of [1280, 1366, 1440, 1920]) {
      await viewport(page, width);
      const boxes = await page.locator('.stage').evaluateAll(els => els.map(el => ({ top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height })));
      expect(Math.max(...boxes.map(b => b.top)) - Math.min(...boxes.map(b => b.top))).toBeLessThan(2);
      const wrapped = await page.locator('.stage-name').evaluateAll(els => els.filter(el => { const range = document.createRange(); range.selectNodeContents(el); return new Set([...range.getClientRects()].map(r => Math.round(r.top))).size > 1; }).map(el => el.textContent));
      expect(wrapped).toEqual([]);
      const layout = await page.locator('.pipeline').evaluate(element => {
        const area = element.closest('.pipeline-area').getBoundingClientRect();
        const cards = [...element.children].map(card => card.getBoundingClientRect());
        return {
          overflow: element.scrollWidth - element.clientWidth,
          outside: cards.filter(card => card.left < area.left || card.right > area.right || card.right > innerWidth).length,
          clipped: [...element.querySelectorAll('.stage-name')].filter(label => label.scrollWidth > label.clientWidth || label.getBoundingClientRect().right > label.parentElement.getBoundingClientRect().right - 2).length,
          widths: cards.map(card => card.width),
          gaps: cards.slice(1).map((card, i) => card.left - cards[i].right),
          scrollRegions: [...element.closest('.pipeline-area').querySelectorAll('*')].filter(el => ['auto','scroll'].includes(getComputedStyle(el).overflowX)).length,
        };
      });
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.outside).toBe(0);
      expect(layout.clipped).toBe(0);
      expect(layout.scrollRegions).toBe(0);
      expect(Math.max(...layout.widths) - Math.min(...layout.widths)).toBeLessThan(1);
      expect(Math.max(...layout.gaps) - Math.min(...layout.gaps)).toBeLessThan(1);
      await pageFits(page);
      await page.locator('.stage').last().click();
      await expect(page.locator('.stage').last()).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.stage-detail-heading h2')).toContainText(names.at(-1));
      if (id === '008' && [1280, 1440].includes(width)) await capture(page, info, `eight-stages-${width}`);
    }
  }
  await capture(page, info, 'pipeline-desktop-last-stage');
});

test('U02 both batch lists have no secondary status text for all roles', async ({ page }, info) => {
  await page.goto('/workbench');
  for (const user of ['admin', 'clerk', 'supervisor']) {
    await role(page, user);
    for (const status of ['stopped', 'reviewing', 'processing', 'success']) {
      await page.locator(`[data-status="${status}"]`).click();
      await expect(page.locator('#dashboard-table .current-stage')).toHaveCount(0);
      await expect(page.locator('#dashboard-table .badge')).not.toHaveCount(0);
    }
    await nav(page, 'query');
    await expect(page.locator('#query-table .badge')).not.toHaveCount(0);
    await expect(page.locator('#query-table .current-stage')).toHaveCount(0);
    await expect(page.locator('#query-table td[data-label="目前狀態"] > :not(.badge)')).toHaveCount(0);
    await nav(page, 'dashboard');
  }
  await capture(page, info, 'workbench-states');
});

test('U03 query mode is beside dates and combines with keyword and date', async ({ page }, info) => {
  await page.goto('/search');
  await expect(page.locator('.query-date-filter #query-mode')).toBeVisible();
  await modePlaceholder(page, 'query');
  await expect(page.locator('#query-pagination-summary')).toContainText('共 25 筆');
  await expect(page.locator('.batch-table select')).toHaveCount(0);
  await mode(page, 'query', '手動');
  await search(page, 'abc-202609');
  await expect(page.locator('#search-feedback')).toContainText('12 筆');
  await mode(page, 'query', '自動');
  await expect(page.locator('#query-pagination-summary')).toContainText('共 13 筆');
  await expect(page.locator('#search-feedback')).toHaveText('');
  await mode(page, 'query', '手動');
  await page.locator('#open-query-calendar').click();
  await page.locator('[data-date="2026-09-05"]').click();
  await page.locator('[data-date="2026-09-06"]').click();
  await page.getByRole('button', { name: '套用日期' }).click();
  await expect(page.locator('#query-table .mode-label')).toHaveText(Array(5).fill('手動'));
  await expect(page.locator('#query-pagination-summary')).toContainText('共 5 筆');
  await mode(page, 'query', '自動');
  await expect(page.locator('#query-table .mode-label')).toHaveText(Array(6).fill('自動'));
  await page.locator('#query-table .view-button').first().click();
  await page.locator('#back-to-batches').click();
  await expect(page.locator('#query-mode')).toHaveText('自動');
  await expect(page.locator('#query-pagination-summary')).toContainText('共 6 筆');
  await page.getByRole('button', { name: '顯示全部' }).click();
  await expect(page.locator('#query-mode')).toHaveText('作業方式');
  await expect(page.locator('#query-pagination-summary')).toContainText('共 25 筆');
  await capture(page, info, 'query-filters');
  await page.locator('#query-mode').click();
  await capture(page, info, 'query-mode-options');
  await page.keyboard.press('Escape');
});

test('U04 workbench dropdown immediately filters without a dialog', async ({ page }, info) => {
  await page.goto('/workbench');
  const select = page.locator('#workbench-mode');
  await expect(select).toHaveRole('combobox');
  await modePlaceholder(page, 'workbench');
  for (const width of [1280, 1366, 1440, 1920]) {
    await viewport(page, width);
    await select.click();
    const popup = page.getByRole('listbox', { name: '作業方式' });
    const box = await popup.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await popup.evaluate(el => getComputedStyle(el).fontFamily)).toBe(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily));
    if ([1280, 1440].includes(width)) await capture(page, info, `mode-options-${width}`);
    await page.locator('h1').click();
    await expect(popup).toHaveCount(0);
    await expect(select).toHaveText('作業方式');
  }
  await expect(page.locator('#dashboard-table .mode-label')).toHaveText(['自動', '手動', '自動', '自動']);
  await expect(page.locator('.batch-table select')).toHaveCount(0);
  await mode(page, 'workbench', '手動');
  await expect(page.locator('#dashboard-table .mode-label')).toHaveText(['手動']);
  await mode(page, 'workbench', '自動');
  await expect(page.locator('#dashboard-table .mode-label')).toHaveText(Array(3).fill('自動'));
  await expect(page.locator('.stat.failed .stat-number')).toHaveText('3');
  await page.locator('[data-status="reviewing"]').click();
  await expect(page.locator('#dashboard-table')).toContainText('查無符合的批次');
  await expect(select).toBeVisible();
  await page.getByRole('button', { name: '清除作業方式' }).click();
  await expect(select).toHaveText('作業方式');
  await expect(select).toBeFocused();
  await modePlaceholder(page, 'workbench');
  await expect(page.locator('#dashboard-table tbody tr')).toHaveCount(2);
  await mode(page, 'workbench', '自動');
  await select.focus();
  await select.press('Home');
  await select.press('Enter');
  await expect(select).toHaveText('手動');
  await expect(page.locator('#dashboard-table tbody tr')).toHaveCount(2);
  await select.click();
  await expect(page.getByRole('option', { name: '手動', exact: true })).toHaveAttribute('aria-selected', 'true');
  await select.press('ArrowDown');
  await select.press('Escape');
  await expect(select).toHaveText('手動');
  await select.press('ArrowDown');
  await select.press('ArrowDown');
  await select.press('Enter');
  await expect(select).toHaveText('自動');
  await expect(page.locator('#dashboard-table')).toContainText('查無符合的批次');
  await select.click();
  await select.press('Tab');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '清除作業方式' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(select).toHaveText('作業方式');
  await expect(page.locator('#dashboard-table tbody tr')).toHaveCount(2);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await capture(page, info, 'workbench-dropdown');
});

test('U05 role visibility supervisor default and two review entry points', async ({ page }, info) => {
  await page.goto('/workbench');
  await role(page, 'clerk');
  await expect(page.locator('#workbench-mode')).toHaveCount(0);
  await expect(page.locator('#dashboard-table .mode-label')).toHaveText(['手動']);
  await nav(page, 'query');
  await search(page, 'ABC-20260907-001');
  await expect(page.locator('#query-table')).toContainText('查無符合的批次');
  await page.getByRole('button', { name: '顯示全部' }).click();
  await role(page, 'supervisor');
  await nav(page, 'query');
  const ids = await page.locator('#query-table [data-batch]').evaluateAll(els => els.map(el => el.dataset.batch));
  expect(ids).toContain('ABC-20260907-013');
  expect(ids).not.toContain('ABC-20260907-012');
  await nav(page, 'dashboard');
  await expect(page.locator('.stat[aria-pressed="true"] .stat-label')).toHaveText('待審核');
  await page.locator('[data-batch="ABC-20260907-008"]').click();
  await expect(page).toHaveURL(/workbench/);
  await expect(page.locator('#review-entry-feedback')).toContainText('審核頁尚未接入');
  await nav(page, 'query');
  await search(page, 'ABC-20260907-008');
  await expect(page.locator('.detail-identity h2')).toHaveText('ABC-20260907-008');
  await expect(page.locator('#cancel-upload')).toHaveCount(0);
  await expect(page.locator('.stage')).toHaveCount(8);
  await capture(page, info, 'supervisor-query-detail');
});

test('U06 clerk upload creates one shared batch and durable actor record', async ({ page }, info) => {
  await page.goto('/workbench');
  await role(page, 'clerk');
  // Use the sidebar to retain the selected role while opening the upload page.
  await page.getByRole('link', { name: '上傳', exact: true }).click();
  await page.locator('.upload-job-table tbody tr').first().getByRole('button', { name: '開啟' }).click();
  await page.locator('.native-file-input').setInputFiles({ name: 'clerk-record.txt', mimeType: 'text/plain', buffer: Buffer.from('clerk payload') });
  const count = (await audit(page)).length;
  await page.locator('.upload-submit-button').click();
  await page.locator('.confirm-modal .primary-button').dblclick();
  await expect(page.locator('.upload-result-modal')).toBeVisible();
  const records = await audit(page);
  expect(records).toHaveLength(count + 1);
  const record = records.at(-1);
  expect(record.actor.id).toBe('clerk');
  expect(record.batchId).toMatch(/^ABC-20260921-/);
  await page.locator('.upload-result-modal .modal-actions .primary-button').click();
  await expect(page.locator('.upload-job-table tbody tr').first().locator('.batch-badge')).toHaveText('1');
  await nav(page, 'query'); await search(page, record.batchId);
  await expect(page.locator('.detail-actions .badge')).toHaveText('審核中');
  await role(page, 'supervisor'); await nav(page, 'dashboard');
  await expect(page.locator(`[data-batch="${record.batchId}"]`)).toBeVisible();
  await role(page, 'admin'); await nav(page, 'audit');
  await expect(page.locator('.audit-table th')).toHaveText(['批次編號', '操作人員', '操作紀錄', '時間']);
  await expect(page.locator('.audit-table tbody tr').first().locator('.audit-actor')).toHaveText('經辦人員');
  const before = await snapshot(page);
  await page.reload();
  await expect(page.locator('.audit-table tbody tr')).not.toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  expect(await audit(page)).toEqual(records);
  await capture(page, info, 'persisted-clerk-record');
});

test('U07 file preview failures dismissal and success preserve audit rules', async ({ page }, info) => {
  for (const operation of ['upload', 'transfer']) {
    await page.goto(`/operation/${operation}`);
    const before = (await audit(page)).length;
    await page.locator(`.${operation}-job-table tbody tr`).first().getByRole('button', { name: '開啟' }).click();
    await page.locator('.native-file-input').setInputFiles({ name: 'fail.txt', mimeType: 'text/plain', buffer: Buffer.from('fail') });
    await page.locator(`.${operation}-submit-button`).click();
    await page.locator('.confirm-modal .text-button').click();
    expect(await audit(page)).toHaveLength(before);
    await page.locator(`.${operation}-submit-button`).click();
    await page.locator('.confirm-modal .primary-button').click();
    await expect(page.locator(`.${operation}-toast.is-error`)).toBeVisible();
    expect(await audit(page)).toHaveLength(before);
    await page.locator('.native-file-input').setInputFiles({ name: 'valid.txt', mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n')) });
    await page.locator(`.${operation}-submit-button`).click(); await page.locator('.confirm-modal .primary-button').click();
    await expect(page.locator(`.${operation}-result-modal`)).toBeVisible();
    await expect(page.locator(`.${operation}-toast.is-success`)).toHaveCount(0);
    await page.getByRole('button', { name: '前 10 行', exact: true }).click();
    await expect(page.locator('.file-preview-text')).toHaveText(Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'));
    await page.getByRole('button', { name: '後 10 行', exact: true }).click();
    await expect(page.locator('.file-preview-text')).toHaveText(Array.from({ length: 10 }, (_, i) => `line ${i + 3}`).join('\n'));
    expect(await audit(page)).toHaveLength(before + 1);
    await page.locator(`.${operation}-result-modal .modal-actions .primary-button`).click();
    await expect(page.locator(`.${operation}-toast.is-success`)).toBeVisible();
    await capture(page, info, operation + '-success');
  }
});

test('U08 download across pages records names once and excludes failure', async ({ page }, info) => {
  await page.goto('/operation/download');
  await expect(page.locator('.download-file-table tbody tr')).toHaveCount(20);
  const before = (await audit(page)).length;
  const first = await page.locator('.download-file-table tbody tr').first().innerText();
  await page.locator('.download-file-table tbody tr').first().click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  const second = await page.locator('.download-file-table tbody tr').first().innerText();
  await page.locator('.download-file-table tbody tr').first().click();
  await page.locator('.download-submit-button').click(); await page.locator('.confirm-modal .primary-button').click();
  await expect(page.locator('.download-toast.is-success')).toBeVisible();
  const entries = await audit(page);
  expect(entries).toHaveLength(before + 1);
  for (const text of [first, second]) expect(entries.at(-1).action).toContain(text.match(/DT\d+_\S+\.(?:txt|csv|dat)/)[0]);
  await page.locator('.download-file-table tbody tr').nth(16).click();
  await page.locator('.download-submit-button').click(); await page.locator('.confirm-modal .primary-button').click();
  await expect(page.locator('.download-toast.is-error')).toBeVisible();
  expect(await audit(page)).toEqual(entries);
  await nav(page, 'audit'); await capture(page, info, 'download-record');
});

test('U09 query paging history date clearing and invisible detail permissions', async ({ page }, info) => {
  await page.goto('/search');
  await page.locator('#query-pagination [aria-label="下一頁"]').click();
  await expect(page.locator('#query-table tbody tr')).toHaveCount(5);
  await page.locator('#query-table .view-button').first().click();
  await page.locator('#back-to-batches').click();
  await expect(page.locator('#query-pagination [aria-current]')).toHaveText('2');
  await search(page, '  abc-20260907-001  ');
  await expect(page.locator('.detail-identity h2')).toHaveText('ABC-20260907-001');
  await role(page, 'clerk');
  await expect(page.locator('.detail-identity h2')).toHaveCount(0);
  await expect(page.locator('#query-mode')).toHaveCount(0);
  await nav(page, 'query');
  await page.getByRole('button', { name: '顯示全部' }).click();
  expect(await page.locator('#query-table .mode-label').allTextContents()).toEqual(Array(12).fill('手動'));
  await nav(page, 'audit');
  await expect(page.locator('.audit-table th')).toHaveCount(3);
  for (const user of ['clerk', 'supervisor', 'admin']) {
    await role(page, user);
    await nav(page, 'audit');
    const expected = (await audit(page)).map((entry, index) => ({ ...entry, index }))
      .filter(entry => user === 'admin' || entry.actor?.id === user)
      .sort((a, b) => b.time.localeCompare(a.time) || b.index - a.index)
      .slice(0, 20).map(entry => entry.action);
    expect(expected.length).toBeGreaterThan(0);
    await expect(page.locator('.audit-action')).toHaveText(expected);
    await expect(page.locator('.audit-action').locator('..')).toHaveText(expected);
    await capture(page, info, `operation-log-${user}`);
  }
});

test('U10 breadcrumbs diagnosis and role-menu keyboard behavior', async ({ page }, info) => {
  for (const [route, label] of [['workbench', '工作台'], ['search', '查詢批次'], ['logs', '操作紀錄']]) {
    await page.goto('/' + route);
    await expect(page.locator('#breadcrumb')).toHaveText(new RegExp(`Batch-Console\\s*/\\s*${label}`));
    await expect(page.locator('main')).not.toContainText('Vue 畫面確認版');
    await expect(page.locator('main')).not.toContainText('重新整理後恢復');
  }
  await page.goto('/search?batch=ABC-20260907-001');
  await expect(page.locator('.solution-details dt')).toHaveText(['問題位置', '問題說明', '聯絡人員']);
  await expect(page.locator('.solution-details')).toContainText('蕭文賢');
  await expect(page.locator('.solution-details')).toContainText('TRANSFER_TIMEOUT');
  await expect(page.locator('#cancel-upload')).toHaveCount(0);
  await page.locator('.user-menu').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.user-dropdown')).toHaveCount(0);
  await expect(page.locator('.user-menu')).toBeFocused();
  await capture(page, info, 'diagnosis');
});

test('U11 desktop controls and four-column audit text remain readable', async ({ page }, info) => {
  for (const route of ['/workbench', '/search', '/logs', '/operation/upload', '/operation/download', '/operation/transfer']) {
    await page.goto(route);
    await expect(page.locator('h1')).toBeVisible();
    for (const width of [1280, 1366, 1440, 1920]) {
      await viewport(page, width);
      await pageFits(page);
      const clipped = await page.locator('main th, main td').evaluateAll(els => els.filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1).map(el => el.textContent));
      expect(clipped).toEqual([]);
      const wrapped = await page.locator('main h1, main h2, main label, main th').evaluateAll(els => els.filter(el => {
        if (!el.getClientRects().length) return false;
        const range = document.createRange(); range.selectNodeContents(el);
        const lines = [...range.getClientRects()].filter(r => r.width && r.height).map(r => Math.round(r.top));
        return new Set(lines).size > 1;
      }).map(el => el.textContent));
      expect(wrapped).toEqual([]);
    }
    await capture(page, info, route.replaceAll('/', '-') + '-desktop');
  }
});

test('U12 saved dataset survives a real browser restart and later date', async ({ headless, launchOptions }, info) => {
  const profile = info.outputPath('browser-profile');
  let context = await chromium.launchPersistentContext(profile, { ...launchOptions, headless, viewport: { width: 1440, height: 1000 }, baseURL: 'http://127.0.0.1:5173' });
  try {
    let page = await context.newPage(); await freeze(page);
    const first = await upload(page, 'restart-one.txt');
    const second = await upload(page, 'restart-two.txt');
    expect(first.batchId).not.toBe(second.batchId);
    const saved = await snapshot(page);
    expect(saved.batches).toHaveLength(27);
    await context.close();
    context = await chromium.launchPersistentContext(profile, { ...launchOptions, headless, viewport: { width: 1440, height: 1000 }, baseURL: 'http://127.0.0.1:5173' });
    page = await context.newPage(); await freeze(page, '2026-09-24T04:00:00.000Z');
    await page.goto('/search'); await expect(page.locator('#query-table tbody tr')).toHaveCount(20);
    expect(await snapshot(page)).toEqual(saved);
    await search(page, first.batchId);
    await expect(page.locator('.detail-identity h2')).toHaveText(first.batchId);
    await expect(page.locator('.detail-actions .badge')).toHaveText('審核中');
    await capture(page, info, 'browser-restarted-batch');
  } finally { await context.close(); }
});

test('U13 desktop navigation opens all pages', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/workbench');
  await expect(page.locator('h1')).toBeVisible();
  const toggle = page.locator('#sidebar-toggle');
  expect((await toggle.boundingBox()).width).toBeGreaterThanOrEqual(32);
  expect((await toggle.locator('span').first().boundingBox()).width).toBeGreaterThanOrEqual(16);
  for (const [name, route] of [['查詢批次', 'search'], ['上傳', 'operation/upload'], ['下傳', 'operation/download'], ['轉送', 'operation/transfer'], ['操作紀錄', 'logs'], ['工作台', 'workbench']]) {
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#primary-navigation').getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/' + route + '$'));
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await pageFits(page);
  }
  await role(page, 'supervisor');
  await expect(page.locator('[data-status="reviewing"]')).toHaveAttribute('aria-pressed', 'true');
  await capture(page, info, 'desktop-navigation');
});

test('U14 switching any role returns to its default workbench from every page', async ({ page }, info) => {
  await page.goto('/workbench');
  for (const [name, route] of [['查詢批次', 'search'], ['上傳', 'operation/upload'], ['下傳', 'operation/download'], ['轉送', 'operation/transfer'], ['操作紀錄', 'logs'], ['工作台', 'workbench']]) {
    for (const user of ['clerk', 'supervisor', 'admin']) {
      await page.locator('#primary-navigation').getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp('/' + route + '$'));
      if (route === 'workbench') await page.locator('[data-status="success"]').click();
      await role(page, user);
      await expect(page.locator('h1')).toHaveText('我的工作台');
      await expect(page.locator('[data-route="dashboard"]')).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.stat[aria-pressed="true"] .stat-label')).toHaveText(user === 'supervisor' ? '待審核' : '異常');
      await expect(page.locator('.user-dropdown')).toHaveCount(0);
      await expect(page.locator('.user-menu')).toBeFocused();
      if (user === 'admin') await expect(page.locator('#workbench-mode')).toHaveText('作業方式');
    }
  }
  await capture(page, info, 'role-default-workbench');
});
