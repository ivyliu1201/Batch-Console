// Run against the isolated browser used by the existing CDP regression scripts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const target = targets.find(t => t.type === 'page' && !t.url.startsWith('edge://'));
  assert.ok(target, 'An isolated browser page is required');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout')); }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function waitFor(expression) {
    const deadline = Date.now() + 8000;
    while (!(await evaluate(expression))) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + expression);
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  }
  async function click(selector) {
    const point = await evaluate(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)});
      if(!el || el.disabled || !el.getClientRects().length) throw new Error('Unavailable: '+${JSON.stringify(selector)});
      el.scrollIntoView({block:'center'});
      const r=el.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
      const hit=document.elementFromPoint(x,y);
      if(hit!==el&&!el.contains(hit)) throw new Error('Covered: '+${JSON.stringify(selector)});
      return {x,y};
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  }
  async function selectRole(role) {
    await click('.user-menu'); await click(`[data-role="${role}"]`);
    await waitFor('location.pathname === "/workbench" && document.querySelector("#dashboard-view")');
  }
  async function selectAutomaticMode(selector) {
    await click(selector);
    for (const [key, windowsVirtualKeyCode] of [['End', 35], ['Enter', 13]]) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode });
    }
  }
  async function go(route) {
    await click(`[data-route="${route}"]`);
  }
  async function persistedSnapshot() {
    return evaluate(`new Promise((resolve,reject)=>{
      const request=indexedDB.open('batch-console',1);
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result, transaction=db.transaction('state','readonly');
        const read=transaction.objectStore('state').get('console');
        transaction.oncomplete=()=>{db.close();resolve(read.result)};
        transaction.onabort=()=>{db.close();reject(transaction.error)};
      };
    })`);
  }
  const output = path.join(__dirname, '..', 'artifacts', 'roles', new Date().toISOString().replaceAll(':', '-'));
  const restartFile = path.join(__dirname, '..', 'artifacts', 'roles', 'restart-expectation.json');
  fs.mkdirSync(output, { recursive: true });
  const checks = [];
  function check(name, fn) { fn(); checks.push(name); console.log('OK ' + name); }
  async function screenshot(name) {
    await evaluate('document.fonts.ready');
    await evaluate('window.scrollTo(0,0); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(capture.data, 'base64'));
  }
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    if (process.argv.includes('--verify-restart')) {
      const expected = JSON.parse(fs.readFileSync(restartFile, 'utf8'));
      const later = new Date(Date.now() + 3 * 86400000).toISOString();
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const NativeDate=Date; window.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[${JSON.stringify(later)}]));} static now(){return new NativeDate(${JSON.stringify(later)}).getTime();} }; })();` });
      await send('Page.navigate', { url: 'http://127.0.0.1:5173/logs' });
      await waitFor('document.querySelector(".audit-table tbody tr")');
      assert.deepEqual(await evaluate('window.BatchConsoleAudit.list()'), expected.records);
      assert.deepEqual((await persistedSnapshot()).batches, expected.batches);
      await go('query');
      await evaluate(`document.querySelector('#batch-id-input').value=${JSON.stringify(expected.batchId)};document.querySelector('#batch-search').requestSubmit()`);
      await waitFor('document.querySelector(".detail-identity h2")');
      assert.equal(await evaluate('document.querySelector(".detail-identity h2").textContent'), expected.batchId);
      assert.equal(await evaluate('document.querySelector(".detail-actions .badge").textContent'), '審核中');
      await screenshot('restart-persisted-detail');
      check('R07: service/browser restart and a later date preserve the full dataset', () => {});
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks, later, batchId: expected.batchId }, null, 2));
      console.log('Report: ' + output);
      return;
    }
    // Clear only this test browser's local application data, never the user's browser.
    await send('Page.navigate', { url: 'about:blank' });
    await send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:5173', storageTypes: 'indexeddb,local_storage' });
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/operation/upload' });
    await waitFor('document.querySelector(".upload-job-table tbody tr")');
    // This assertion exercises the original successful upload path before relying on new controls.
    await click('.upload-job-table tbody tr:first-child .outline-button');
    await evaluate(`(() => { const dt=new DataTransfer(); dt.items.add(new File(['role test content'],'role-persistence.txt',{type:'text/plain'})); const input=document.querySelector('.native-file-input');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await click('.upload-submit-button'); await click('.confirm-modal .primary-button');
    await waitFor('document.querySelector(".upload-result-modal")');
    const firstRecord = await evaluate('window.BatchConsoleAudit.list().at(-1)');
    check('R05: successful upload creates a related batch ID', () => assert.ok(firstRecord.batchId));
    await click('.upload-result-modal .modal-actions .primary-button');
    assert.equal(await evaluate('document.querySelector(".upload-job-table tbody tr:first-child .batch-badge").textContent.trim()'), '1');
    await go('query');
    await evaluate(`document.querySelector('#batch-id-input').value=${JSON.stringify(firstRecord.batchId)}; document.querySelector('#batch-search').requestSubmit()`);
    await waitFor('document.querySelector(".detail-identity h2")');
    check('R05: uploaded batch is awaiting review with no cancellation action', () => {});
    assert.equal(await evaluate('document.querySelector(".detail-actions .badge").textContent'), '審核中');
    assert.equal(await evaluate('!!document.querySelector("#cancel-upload")'), false);
    await selectRole('clerk');
    await go('dashboard');
    await click('[data-status="reviewing"]');
    assert.ok(await evaluate(`!!document.querySelector('[data-batch="${firstRecord.batchId}"]')`));
    await selectRole('supervisor');
    check('R02: supervisor defaults to pending review', () => {});
    assert.equal(await evaluate('document.querySelector(".stat[aria-pressed=true]").dataset.status'), 'reviewing');
    assert.equal(await evaluate('document.querySelector(".stat.reviewing .stat-label").textContent'), '待審核');
    await click(`[data-batch="${firstRecord.batchId}"]`);
    assert.equal(await evaluate('location.pathname'), '/workbench');
    assert.match(await evaluate('document.querySelector("#review-entry-feedback").textContent'), /審核頁尚未接入/);
    await screenshot('supervisor-pending');
    await click('[data-status="success"]');
    const reviewedIds = await evaluate('[...document.querySelectorAll("#dashboard-table [data-batch]")].map(e=>e.dataset.batch)');
    assert.ok(reviewedIds.includes('ABC-20260907-013'));
    assert.ok(!reviewedIds.includes('ABC-20260907-012'));
    await go('query');
    await evaluate(`document.querySelector('#batch-id-input').value=${JSON.stringify(firstRecord.batchId)};document.querySelector('#batch-search').requestSubmit()`);
    await waitFor('document.querySelector(".detail-identity h2")');
    assert.equal(await evaluate('document.querySelector(".detail-identity h2").textContent'), firstRecord.batchId);
    assert.equal(await evaluate('!!document.querySelector("#cancel-upload")'), false);
    check('R06: supervisor query opens the same detail without cancellation', () => {});
    await go('dashboard'); await selectRole('admin');
    await click('[data-status="stopped"]');
    await selectAutomaticMode('#workbench-mode');
    await waitFor('document.querySelectorAll("#dashboard-table tbody tr").length === 3');
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#dashboard-table .mode-label")].map(e=>e.textContent)'), ['自動','自動','自動']);
    await go('query');
    await selectAutomaticMode('#query-mode');
    await waitFor('document.querySelectorAll("#query-table tbody tr").length > 0');
    assert.ok((await evaluate('[...document.querySelectorAll("#query-table .mode-label")].map(e=>e.textContent)')).every(m=>m==='自動'));
    check('R03: administrator filters mode on both pages', () => {});
    await click('#query-table [data-batch="ABC-20260907-001"]');
    await selectRole('clerk');
    await waitFor('!document.querySelector(".detail-identity h2")');
    await go('query');
    assert.ok((await evaluate('[...document.querySelectorAll("#query-table .mode-label")].map(e=>e.textContent)')).every(m=>m==='手動'));
    check('R01: switching role removes inaccessible detail and auto batches', () => {});
    await selectRole('admin');
    await go('audit');
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".audit-table th")].map(e=>e.textContent)'), ['批次編號','操作人員','操作紀錄','時間']);
    assert.equal(await evaluate('document.querySelector(".audit-table tbody tr .audit-actor").textContent'), '管理人員');
    await screenshot('admin-audit');
    await selectRole('clerk');
    await go('audit');
    assert.equal(await evaluate('document.querySelectorAll(".audit-table th").length'), 3);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".audit-action")].map(e=>e.textContent)'), await evaluate('window.BatchConsoleAudit.list().map((e,index)=>({...e,index})).filter(e=>e.actor?.id === "clerk").sort((a,b)=>b.time.localeCompare(a.time)||b.index-a.index).slice(0,20).map(e=>e.action)'));
    await selectRole('supervisor');
    await go('audit');
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".audit-action")].map(e=>e.textContent)'), await evaluate('window.BatchConsoleAudit.list().map((e,index)=>({...e,index})).filter(e=>e.actor?.id === "supervisor").sort((a,b)=>b.time.localeCompare(a.time)||b.index-a.index).slice(0,20).map(e=>e.action)'));
    await selectRole('admin');
    await go('audit');
    const before = await evaluate('window.BatchConsoleAudit.list()');
    await send('Page.reload'); await waitFor('document.querySelector(".audit-table tbody tr")');
    assert.deepEqual(await evaluate('window.BatchConsoleAudit.list()'), before);
    check('R07: reload preserves all operations and original actors', () => {});
    await go('query');
    await evaluate(`document.querySelector('#batch-id-input').value=${JSON.stringify(firstRecord.batchId)};document.querySelector('#batch-search').requestSubmit()`);
    await waitFor('document.querySelector(".detail-identity h2")');
    assert.equal(await evaluate('document.querySelector(".detail-identity h2").textContent'), firstRecord.batchId);
    check('R07: reload preserves batch and pending stage', () => {});
    for (const width of [1440, 390, 320]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await evaluate('new Promise(r=>setTimeout(r,250))');
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
      await screenshot('batch-detail-' + width);
    }
    check('R08: shared detail fits desktop and mobile', () => {});
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate('new Promise(r=>setTimeout(r,250))');
    await go('audit');
    for (const width of [390, 320]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await evaluate('new Promise(r=>setTimeout(r,250))');
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
      await screenshot('admin-audit-' + width);
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.audit-table th,.audit-table td')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent)`), []);
    }
    const saved = await persistedSnapshot();
    assert.equal(saved.batches.length, 26);
    assert.deepEqual(saved.records, before);
    assert.equal(saved.batches[0].sourceFileName, 'role-persistence.txt');
    assert.ok(!JSON.stringify(saved.batches).includes('role test content'));
    fs.writeFileSync(restartFile, JSON.stringify({ batchId: firstRecord.batchId, batches: saved.batches, records: before }, null, 2));
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks, errors, batchId: firstRecord.batchId }, null, 2));
    console.log('Report: ' + output);
  } catch (error) {
    await screenshot('failure'); throw error;
  } finally { socket.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
