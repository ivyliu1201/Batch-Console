import { test, expect } from './runtime.mjs';

async function ready(page, route) {
  await page.goto(route);
  await expect(page.locator('h1')).toBeVisible();
}
async function records(page) { return page.evaluate(() => window.BatchConsoleAudit.list()); }
async function stored(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('batch-console', 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('state', 'readonly');
      const request = tx.objectStore('state').get('console');
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => reject(tx.error);
    };
  }));
}
async function confirmation(page, operation) {
  await ready(page, `/operation/${operation}`);
  if (operation === 'download') {
    await page.locator('.download-file-table tbody tr').first().click();
    await page.locator('.download-submit-button').click();
  } else {
    await page.locator(`.${operation}-job-table tbody tr`).first().getByRole('button', { name: '開啟' }).click();
    await page.locator('.native-file-input').setInputFiles({name: 'review-source.txt', mimeType: 'text/plain', buffer: Buffer.from('review example')});
    await page.locator(`.${operation}-submit-button`).click();
  }
  await expect(page.locator('.confirm-modal')).toBeVisible();
}
for (const operation of ['upload', 'download', 'transfer']) {
  test(`R01 ${operation}: storage failure must not leave a success record`, async ({ page }, info) => {
    await confirmation(page, operation);
    const before = await stored(page);
    // Fault injection only in an isolated test browser, after initialization.
    await page.evaluate(() => {
      window.reviewOriginalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('Review: storage quota fault', 'QuotaExceededError'); };
    });
    await page.locator('.confirm-modal .primary-button').click();
    await expect(page.locator(`.${operation}-toast.is-error`)).toBeVisible();
    const afterFailure = await records(page);
    expect.soft(await stored(page), 'Failed operation must leave the saved dataset unchanged').toEqual(before);
    const firstLink = page.getByRole('link', { name: '工作台', exact: true });
    const linkBox = await firstLink.boundingBox();
    const headerBox = await page.locator('.topbar').boundingBox();
    expect.soft(linkBox.y, 'Storage warning must not place navigation behind the header').toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
    expect.soft(await page.locator(`.${operation}-toast.is-error span`).evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), 'Storage warning must not cover the operation error message').toBe(true);
    await page.screenshot({path: info.outputPath('storage-error.png'), fullPage: true});
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.reviewOriginalPut; });
    // Retry the same operation using the actual UI after storage recovers.
    await page.locator(`.${operation}-submit-button`).click();
    await page.locator('.confirm-modal .primary-button').click();
    if (operation === 'download') await expect(page.locator('.download-toast.is-success')).toBeVisible();
    else await expect(page.locator(`.${operation}-result-modal`)).toBeVisible();
    const recovered = await stored(page);
    await info.attach('diagnosis', {body: JSON.stringify({beforeRecords: before.records.length, afterFailureRecords: afterFailure.length, recoveredRecords: recovered.records.length, beforeBatches: before.batches.length, recoveredBatches: recovered.batches.length, entries: recovered.records.slice(before.records.length)}, null, 2), contentType: 'application/json'});
    expect.soft(afterFailure.length, 'Failed operation should not leave a success record').toBe(before.records.length);
    expect(recovered.records.length, 'Retry should persist only one successful operation').toBe(before.records.length + 1);
    expect(recovered.batches.length).toBe(before.batches.length + (operation === 'upload' ? 1 : 0));
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    expect(await records(page)).toEqual(recovered.records);
    expect(await stored(page)).toEqual(recovered);
  });
}
for (const operation of ['upload', 'download', 'transfer']) {
  test(`R02 ${operation}: modal keyboard focus must stay inside`, async ({ page }, info) => {
    await confirmation(page, operation);
    const initial = await page.evaluate(() => ({inside: !!document.activeElement.closest('[role="dialog"]'), text: document.activeElement.textContent}));
    await page.locator('.confirm-modal .primary-button').focus();
    await page.keyboard.press('Tab');
    const afterTab = await page.evaluate(() => ({inside: !!document.activeElement.closest('[role="dialog"]'), text: document.activeElement.textContent?.slice(0, 80)}));
    await info.attach('focus', {body: JSON.stringify({initial, afterTab}), contentType: 'application/json'});
    expect.soft(initial.inside, 'Opening modal must move focus inside').toBe(true);
    expect(afterTab.inside, 'Tab must not focus the obscured background').toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))).toBe(true);
    const before = await records(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.confirm-modal')).toHaveCount(0);
    await expect(page.locator(`.${operation}-submit-button`)).toBeFocused();
    expect(await records(page)).toEqual(before);
  });
}
test('R03 repeated batch URL parameter should not crash search', async ({page}, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/search?batch=ABC-20260907-001&batch=ABC-20260907-002');
  await expect(page.locator('.topbar')).toBeVisible();
  await page.screenshot({path: info.outputPath('array-query.png'), fullPage: true});
  await info.attach('errors', {body: JSON.stringify(errors), contentType:'application/json'});
  expect(errors).toEqual([]);
  await expect(page.locator('h1')).toHaveText('查詢批次');
  await expect(page.locator('.detail-identity h2')).toHaveText('ABC-20260907-001');
  await page.reload();
  await expect(page.locator('.detail-identity h2')).toHaveText('ABC-20260907-001');
  await page.locator('.user-menu').click();
  await page.locator('[data-role="clerk"]').click();
  await page.getByRole('link', {name:'查詢批次',exact:true}).click();
  await page.getByRole('searchbox', {name:'批次編號'}).fill('ABC-20260907-001');
  await page.getByRole('button', {name:'查詢批次',exact:true}).click();
  await expect(page.locator('.detail-identity h2')).toHaveCount(0);
  await page.goto('/search?batch');
  await expect(page.locator('#query-table tbody tr')).toHaveCount(20);
});
test('R04 HTML in file preview is displayed as text', async ({page}, info) => {
  await ready(page, '/operation/upload');
  await page.locator('.upload-job-table tbody tr').first().getByRole('button', {name:'開啟'}).click();
  const content = '<img src=x onerror="window.reviewXss=1"><script>window.reviewXss=2</script>';
  await page.locator('.native-file-input').setInputFiles({name: 'review-html.txt', mimeType:'text/plain', buffer:Buffer.from(content)});
  await page.locator('.upload-submit-button').click();
  await page.locator('.confirm-modal .primary-button').click();
  await expect(page.locator('.file-preview-text')).toHaveText(content);
  await expect(page.locator('.file-preview-text img, .file-preview-text script')).toHaveCount(0);
  expect(await page.evaluate(() => window.reviewXss)).toBeUndefined();
  await page.screenshot({path:info.outputPath('escaped-preview.png'),fullPage:true});
});
test('R05 query and audit keep the same pagination boundaries', async ({page}) => {
  await ready(page, '/search');
  // Isolated fixture: enough rows to exercise both ellipses, without changing production seeds.
  const fixture = await stored(page);
  fixture.batches = Array.from({length:200}, (_, i) => ({...structuredClone(fixture.batches[0]), id:`REVIEW-${String(i + 1).padStart(3, '0')}`}));
  fixture.records = Array.from({length:200}, (_, i) => ({page:'測試', action:`分頁測試 ${i+1}`, batchId:`REVIEW-${i+1}`, time:'2026-09-21T12:00:00+08:00', actor:{id:'admin',name:'管理人員',role:'admin'}}));
  // Seed through storage, avoiding a second module instance after Vite hot updates.
  await page.evaluate(value => new Promise((resolve, reject) => {
    const open = indexedDB.open('batch-console', 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(value, 'console');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => reject(tx.error);
    };
  }), fixture);
  await page.reload();
  for (const [name, selector] of [['查詢批次', '#query-pagination'], ['操作紀錄', '#pagination']]) {
    await page.getByRole('link', {name,exact:true}).click();
    const pagination = page.locator(selector);
    const labels = () => pagination.locator('button:not([aria-label="上一頁"]):not([aria-label="下一頁"]), .page-ellipsis');
    await expect(labels()).toHaveText(['1','2','…','10']);
    for (let i=1; i<5; i++) await pagination.getByRole('button', {name:'下一頁',exact:true}).click();
    await expect(labels()).toHaveText(['1','…','4','5','6','…','10']);
    await expect(pagination.locator('[aria-current="page"]')).toBeFocused();
    if (name === '查詢批次') {
      const id = await page.locator('#query-table .batch-code').first().innerText();
      await page.locator('#query-table .view-button').first().click();
      await expect(page.locator('.detail-identity h2')).toHaveText(id);
      await page.locator('#back-to-batches').click();
      await expect(pagination.locator('[aria-current="page"]')).toHaveText('5');
    }
    await pagination.getByRole('button', {name:'第 10 頁',exact:true}).click();
    await expect(labels()).toHaveText(['1','…','9','10']);
    await expect(pagination.getByRole('button', {name:'下一頁',exact:true})).toBeDisabled();
  }
});
for (const operation of ['upload', 'transfer']) {
  test(`R06 ${operation}: busy confirmation and preview keep keyboard behavior`, async ({page}, info) => {
    await page.setViewportSize({width:1280,height:720});
    await confirmation(page, operation);
    const before = await records(page);
    // Pause only file reading, so Escape and repeated Enter can be tested during processing.
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = async function () {
        await new Promise(resolve => { window.releaseReviewRead = resolve; });
        return original.call(this);
      };
    });
    await page.locator('.confirm-modal .primary-button').click();
    await expect(page.locator('.confirm-modal .primary-button')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('.confirm-modal')).toBeVisible();
    await page.keyboard.press('Enter');
    expect(await records(page)).toEqual(before);
    await page.evaluate(() => window.releaseReviewRead());
    const result = page.locator(`.${operation}-result-modal`);
    await expect(result).toBeVisible();
    const box = await result.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    await expect(page.locator(`.${operation}-toast.is-success`)).toHaveCount(0);
    await result.getByRole('button', {name:'完成',exact:true}).focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))).toBe(true);
    await page.screenshot({path:info.outputPath('preview.png'),fullPage:true});
    await page.keyboard.press('Escape');
    await expect(result).toHaveCount(0);
    await expect(page.locator(`.${operation}-job-table tbody tr`).first().getByRole('button',{name:'開啟'})).toBeFocused();
    await expect(page.locator(`.${operation}-toast.is-success`)).toBeVisible();
    expect(await records(page)).toHaveLength(before.length + 1);
  });
}
