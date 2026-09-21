// Dependency-free, provisional UI checks against an isolated local Edge instance.
// This is not the formal frontend-ux-audit runner.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const target = targets.find(item => item.type === 'page' && !item.url.startsWith('edge://'));
  assert.ok(target, 'An isolated Edge page must be available');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + JSON.stringify(result.exceptionDetails.exception));
    return result.result.value;
  }
  async function waitFor(expression) {
    const deadline = Date.now() + 6000;
    while (!(await evaluate(expression))) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${expression}`);
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  }
  async function click(selector) {
    const point = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled || e.getClientRects().length === 0) throw new Error('Unavailable control: ' + ${JSON.stringify(selector)}); e.scrollIntoView({block:'center'}); const box=e.getBoundingClientRect();const x=box.x+box.width/2,y=box.y+box.height/2;const hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw new Error('Covered control: '+${JSON.stringify(selector)});return {x,y}; })()`);
    await send('Input.dispatchMouseEvent', { type:'mousePressed',...point,button:'left',clickCount:1 });
    await send('Input.dispatchMouseEvent', { type:'mouseReleased',...point,button:'left',clickCount:1 });
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  }
  async function navigate(selector) {
    const clickable = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if(!element||!element.getClientRects().length)return false; const box=element.getBoundingClientRect(); const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2); return hit===element||element.contains(hit); })()`);
    if (!clickable) {
      await click('#sidebar-toggle');
      await evaluate('new Promise(resolve=>setTimeout(resolve,250))');
    }
    await click(selector);
  }
  async function viewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate('new Promise(resolve => setTimeout(resolve,250))');
  }

  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-') + '-' + crypto.randomUUID().slice(0, 8);
  const runDirectory = path.join(__dirname, '..', 'artifacts', 'vue-integration', runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  const report = { runId, kind: 'provisional-local-browser-check', formalUxAuditStatus: 'SETUP_REQUIRED', startedAtUtc: new Date().toISOString(), browser: 'Microsoft Edge / CDP', checks: [], screenshots: [], layouts: [], runtimeErrors };
  function check(name, assertion) { assertion(); report.checks.push({ name, result: 'passed' }); console.log(`OK ${name}`); }
  async function screenshot(name) {
    await evaluate('document.fonts.ready');
    // Capture full pages from the top so fixed shell elements are not offset by CDP stitching.
    await evaluate(`if (!document.querySelector('dialog[open]')) window.scrollTo(0,0); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    const metrics = await send('Page.getLayoutMetrics');
    const dimensions = await evaluate('({width:innerWidth,height:innerHeight})');
    const dialogOpen = await evaluate('!!document.querySelector("dialog[open]")');
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !dialogOpen, ...(dialogOpen ? {} : { clip: { x: 0, y: 0, width: dimensions.width, height: Math.max(dimensions.height, metrics.cssContentSize.height), scale: 1 } }) });
    const filename = `${name}.png`;
    const bytes = Buffer.from(result.data, 'base64');
    fs.writeFileSync(path.join(runDirectory, filename), bytes);
    report.screenshots.push({ file: filename, capturedAtUtc: new Date().toISOString(), viewport: dimensions, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  async function layout(name) {
    const result = await evaluate(`(() => {
      const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
      const elements = [...document.querySelectorAll('main button,main input,main select,main a,.pipeline,.audit-scroll,.stats,.audit-table:not(.with-actor),.batch-table,.diagnosis')].filter(visible).filter(element => innerWidth >= 1280 || !element.closest('.pipeline'));
      const outside = elements.filter(element => { const box = element.getBoundingClientRect(); return box.left < -1 || box.right > innerWidth + 1; }).map(element => element.outerHTML.slice(0, 150));
      const pipelines = innerWidth < 1280 ? [] : [...document.querySelectorAll('.pipeline')].filter(visible).map(element => ({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,stages:element.children.length,tops:[...element.children].map(stage=>stage.getBoundingClientRect().top),scrollable:getComputedStyle(element.parentElement).overflowX==='auto'}));
      return {width:innerWidth,height:innerHeight,bodyWidth:document.documentElement.scrollWidth,outside,pipelines};
    })()`);
    report.layouts.push({ name, ...result });
    assert.ok(result.bodyWidth <= result.width, `${name}: horizontal page overflow`);
    assert.deepEqual(result.outside, [], `${name}: controls outside viewport`);
    for (const pipeline of result.pipelines) {
      assert.ok(Math.max(...pipeline.tops)-Math.min(...pipeline.tops)<2, `${name}: pipeline stages wrap`);
      assert.ok(!pipeline.scrollable, `${name}: desktop pipeline must not use a horizontal scroll region`);
      assert.ok(pipeline.scrollWidth <= pipeline.clientWidth + 1, `${name}: all desktop pipeline stages must fit`);
    }
  }
  async function calendarLayout(name) {
    const result = await evaluate(`(() => {
      const calendar=document.querySelector('.calendar-months');
      const controls=[...document.querySelectorAll('#date-dialog .calendar-day,#date-dialog .button,#selected-start,#selected-end')].filter(e=>e.getClientRects().length);
      const clipped=controls.filter(e=>{const b=e.getBoundingClientRect();return b.top<0||b.bottom>innerHeight||b.left<0||b.right>innerWidth;}).map(e=>e.textContent);
      return {clipped,scroll:calendar.scrollHeight>calendar.clientHeight+1,dialogScroll:document.querySelector('#date-dialog').scrollHeight>document.querySelector('#date-dialog').clientHeight+1};
    })()`);
    check(`B13 ${name}: complete calendar and actions without internal scrolling`,()=>{assert.deepEqual(result.clipped,[]);assert.equal(result.scroll,false);assert.equal(result.dialogScroll,false);});
  }
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    // Freeze only this isolated test page to the approved September demo date.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const NativeDate=Date; class DemoDate extends NativeDate { constructor(...args){super(...(args.length?args:['2026-09-07T09:00:00.000Z']));} static now(){return new NativeDate('2026-09-07T09:00:00.000Z').getTime();} } window.Date=DemoDate; })();` });
    await viewport(1440, 1000);
    await send('Page.navigate', { url: 'about:blank' });
    await send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:5173', storageTypes: 'indexeddb,local_storage' });
    await send('Page.navigate', { url: 'http://127.0.0.1:5173' });
    await waitFor('document.readyState === "complete" && document.querySelectorAll(".stat-number").length === 4');
    const initial = await evaluate(`({stats:[...document.querySelectorAll('.stat-number')].map(e=>e.textContent),rows:document.querySelectorAll('#dashboard-table tbody tr').length,modes:[...document.querySelectorAll('#dashboard-table .mode-label')].map(e=>e.textContent)})`);
    check('N01 workbench defaults to abnormal with four status cards', () => { assert.deepEqual(initial.stats, ['4', '2', '4', '15']); assert.equal(initial.rows, 4); assert.ok(initial.modes.every(mode => ['手動', '自動'].includes(mode))); });
    const workbenchTitle = await evaluate('document.querySelector("[data-route=dashboard]").textContent.trim()');
    check('B01 navigation uses the workbench name', () => assert.equal(workbenchTitle, '工作台'));
    const duplicateBrand = await evaluate('document.querySelector(".sidebar").textContent.includes("Batch Console")');
    check('Sidebar does not repeat the header brand above the workbench navigation', () => assert.equal(duplicateBrand, false));
    const shell = await evaluate(`(() => { const logo=document.querySelector('.brand-logo'); const box=logo.getBoundingClientRect(); return {sidebar:document.querySelector('.sidebar').getBoundingClientRect().width,top:document.querySelector('.sidebar').getBoundingClientRect().top,header:document.querySelector('.topbar').getBoundingClientRect().height,logoLoaded:logo.tagName==='IMG'&&logo.complete&&logo.naturalWidth>0,logoWidth:box.width,logoHeight:box.height}; })()`);
    check('B14 shell uses the restored flower image, sidebar below the header and 64px header',()=>{assert.equal(shell.sidebar,240);assert.equal(shell.top,64);assert.equal(shell.header,64);assert.equal(shell.logoLoaded,true);assert.equal(shell.logoWidth,40);assert.equal(shell.logoHeight,40);});
    const auditCountBeforeSidebarToggle = await evaluate('window.BatchConsoleAudit.list().length');
    await click('#sidebar-toggle');
    await evaluate('new Promise(resolve=>setTimeout(resolve,250))');
    const collapsed = await evaluate(`({width:document.querySelector('.sidebar').getBoundingClientRect().width,expanded:document.querySelector('#sidebar-toggle').getAttribute('aria-expanded'),labels:[...document.querySelectorAll('[data-route]')].map(e=>e.getAttribute('aria-label'))})`);
    check('B14 collapsed sidebar keeps accessible navigation',()=>{assert.equal(collapsed.width,0);assert.equal(collapsed.expanded,'false');assert.deepEqual(collapsed.labels,['工作台','查詢批次','操作紀錄']);});
    await screenshot('16-shell-collapsed');
    await click('#sidebar-toggle');
    await evaluate('new Promise(resolve=>setTimeout(resolve,250))');
    const auditCountAfterSidebarToggle = await evaluate('window.BatchConsoleAudit.list().length');
    check('B14 sidebar display changes do not create batch audit entries',()=>assert.equal(auditCountAfterSidebarToggle,auditCountBeforeSidebarToggle));
    await layout('dashboard-desktop'); await screenshot('01-dashboard-desktop');
    for (const [state, expectedCount, expectedLabel] of [['processing', 4, '處理中'], ['success', 15, '成功'], ['stopped', 4, '失敗']]) {
      await click(`#dashboard-stats [data-status="${state}"]`);
      const filtered = await evaluate(`({rows:document.querySelectorAll('#dashboard-table tbody tr').length,statuses:[...document.querySelectorAll('#dashboard-table .badge')].map(e=>e.textContent),selected:document.querySelector('#dashboard-stats [aria-pressed="true"]').dataset.status})`);
      check(`B09 ${state} card filters rows and marks selection`, () => { assert.equal(filtered.rows, expectedCount); assert.ok(filtered.statuses.every(label => label === expectedLabel)); assert.equal(filtered.selected, state); });
      if (state === 'success') await screenshot('12-workbench-success-filter');
    }
    await evaluate('document.querySelector("#dashboard-stats [data-status=processing]").focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor('document.querySelectorAll("#dashboard-table tbody tr").length === 4');
    check('B09 keyboard Enter activates the workbench filter', () => {});
    await click('#dashboard-stats [data-status="stopped"]');

    await click('#dashboard-table [data-batch="ABC-20260907-001"]');
    await waitFor('document.querySelectorAll(".stage").length === 6');
    const failure = await evaluate(`({count:document.querySelectorAll('.stage').length,summary:document.querySelector('.attempt-count').textContent,reason:document.querySelector('.diagnosis.error').textContent,solution:document.querySelector('.solution').textContent,attempts:document.querySelectorAll('.attempt-row').length,buttons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>e.textContent)})`);
    check('B02/B03/B04 full pipeline, stopped third execution, remedies and no manual retry', () => { assert.equal(failure.count, 6); assert.match(failure.summary, /執行 3 次.*自動重試 2 次/); assert.match(failure.reason, /第三次仍失敗/); assert.match(failure.solution, /問題位置[\s\S]*問題說明[\s\S]*聯絡人員[\s\S]*蕭文賢/); assert.equal(failure.attempts, 3); assert.ok(!failure.buttons.some(text => /人工重試|確認.*[Rr]etry/.test(text))); });
    const stageNames = await evaluate('[...document.querySelectorAll(".stage-name")].map(e=>e.textContent)');
    check('B11 pipeline uses all six complete stage names in order', () => assert.deepEqual(stageNames, ['接收前端來源檔', '處理前端來源檔', '傳送後端來源檔', '接收後端結果檔', '處理後端結果檔', '傳送前端結果檔']));
    const detailEmphasis = await evaluate(`(() => {
      const selectors=['#query-title','.detail-identity h2','.metadata-label','.stage-name','.diagnosis h3','.error-code','.diagnosis.error p strong','.solution-details dt','.attempt-row strong','.log-title'];
      return selectors.map(selector=>{const e=document.querySelector(selector);return {selector,bold:!!e&&Number(getComputedStyle(e).fontWeight)>=700};});
    })()`);
    check('B15 headings and diagnosis highlights are bold',()=>assert.deepEqual(detailEmphasis.filter(item=>!item.bold),[]));
    const terminal = await evaluate(`(() => {const e=document.querySelector('.log-text');const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color,bold:Number(s.fontWeight)>=700,mono:s.fontFamily.includes('monospace'),lines:e.textContent.split('\\n').length};})()`);
    check('B16 terminal log is black with bold white monospace text and original line breaks',()=>{assert.equal(terminal.background,'rgb(17, 19, 21)');assert.equal(terminal.color,'rgb(255, 255, 255)');assert.equal(terminal.bold,true);assert.equal(terminal.mono,true);assert.equal(terminal.lines,3);});
    await layout('query-desktop'); await screenshot('02-query-failure-desktop');
    await click('[data-attempt="0"]');
    const firstLog = await evaluate('document.querySelector(".log-text").textContent');
    check('B03 each execution has its own visible log', () => assert.match(firstLog, /首次執行/));
    await click('[data-stage="0"]');
    const successfulStage = await evaluate('document.querySelector("#stage-detail").textContent');
    check('B03 completed stage has one execution and no failure', () => { assert.match(successfulStage, /執行 1 次.*自動重試 0 次/); assert.match(successfulStage, /已成功完成/); });
    await click('[data-stage="5"]');
    const waitingStage = await evaluate('document.querySelector("#stage-detail").textContent');
    check('B04 downstream stage remains unexecuted', () => assert.match(waitingStage, /尚未執行/));
    await evaluate(`document.querySelector('#batch-id-input').value = 'NOT-FOUND'; document.querySelector('#batch-search').requestSubmit();`);
    await waitFor('!document.querySelector("#query-list").hidden && document.querySelector("#query-table").textContent.includes("查無")');
    check('B02 unknown batch gives an empty result', () => {}); await screenshot('03-query-empty');
    await click('#show-all-batches');
    await click('#query-table [data-batch="ABC-20260907-007"]');
    await waitFor('document.querySelectorAll(".stage.success").length === 6');
    check('B02 success example completes all six stages', () => {});
    await click('#back-to-batches');
    await click('#query-table [data-batch="ABC-20260907-006"]');
    await waitFor('document.querySelectorAll(".stage.processing").length === 1');
    const processingStages = await evaluate(`({count:document.querySelectorAll('.stage').length,waiting:document.querySelectorAll('.stage.waiting').length})`);
    check('B12 processing example includes all six stages and three pending stages', () => { assert.equal(processingStages.count,6); assert.equal(processingStages.waiting,3); });
    await screenshot('13-query-processing-desktop');
    await click('[data-stage="5"]');
    const pendingDetail = await evaluate('document.querySelector("#stage-detail").textContent');
    check('B12 pending stages remain interactive and have no executions', () => assert.match(pendingDetail,/執行 0 次.*自動重試 0 次[\s\S]*尚未執行/));
    await click('#back-to-batches');
    await evaluate(`document.querySelector('#batch-id-input').value='ABC-20260907-005';document.querySelector('#batch-search').requestSubmit()`);
    await waitFor('document.querySelector(".detail-identity h2").textContent === "ABC-20260907-005"');
    const secondProcessing = await evaluate(`({names:[...document.querySelectorAll('.stage-name')].map(e=>e.textContent),waiting:document.querySelectorAll('.stage.waiting').length})`);
    check('N02 manual processing batch 005 includes two preparation and six execution stages',()=>{assert.deepEqual(secondProcessing.names,['上傳檔案','審核完成',...stageNames]);assert.equal(secondProcessing.waiting,3);});
    await screenshot('19-query-processing-005');

    await navigate('[data-route="audit"]');
    await waitFor('!document.querySelector("#audit-view").hidden');
    const auditInitial = await evaluate(`({columns:[...document.querySelectorAll('.audit-table th')].map(e=>e.textContent),rows:document.querySelectorAll('.audit-table tbody tr').length,range:document.querySelector('#audit-range-description').textContent,text:document.querySelector('#audit-table').textContent})`);
    check('B05/B06 audit captures batch changes, excludes searches and opens without a date filter', () => { assert.deepEqual(auditInitial.columns, ['批次編號', '操作人員', '操作紀錄', '時間']); assert.equal(auditInitial.rows, 20); assert.match(auditInitial.range, /不限日期/); assert.doesNotMatch(auditInitial.text, /NOT-FOUND/); });
    const firstPageTimes = await evaluate('[...document.querySelectorAll(".audit-time")].map(e=>e.textContent)');
    check('B06 newest records are displayed first', () => assert.deepEqual(firstPageTimes, firstPageTimes.slice().sort().reverse()));
    await screenshot('04-audit-desktop'); await layout('audit-desktop');
    await click('#pagination [aria-label="下一頁"]');
    const secondPage = await evaluate(`({page:document.querySelector('#pagination [aria-current]').textContent,rows:document.querySelectorAll('.audit-table tbody tr').length})`);
    check('B07 next page contains the remaining 13 entries and is selected', () => { assert.equal(secondPage.page, '2'); assert.equal(secondPage.rows, 13); });
    const secondPageTimes = await evaluate('[...document.querySelectorAll(".audit-time")].map(e=>e.textContent)');
    check('B06 ordering is retained across pages', () => { assert.deepEqual(secondPageTimes, secondPageTimes.slice().sort().reverse()); assert.ok(firstPageTimes.at(-1) >= secondPageTimes[0]); });

    await click('#open-calendar');
    await viewport(1280,640); await calendarLayout('short desktop'); await screenshot('14-calendar-short-desktop'); await viewport(1440,1000);
    const dateAvailability = await evaluate(`(() => {
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const days=[...document.querySelectorAll('[data-date]')];
      return {future:days.filter(e=>e.dataset.date>today).map(e=>({disabled:e.disabled,color:getComputedStyle(e).color})),past:days.filter(e=>e.dataset.date<=today).map(e=>e.disabled),todayDisabled:document.querySelector('[data-date="'+today+'"]')?.disabled};
    })()`);
    check('B10 future days are disabled while today and past days remain selectable', () => { assert.ok(dateAvailability.future.length > 0); assert.ok(dateAvailability.future.every(day=>day.disabled)); assert.ok(dateAvailability.past.every(disabled=>!disabled)); assert.equal(dateAvailability.todayDisabled,false); });
    await evaluate(`document.querySelector('.calendar-day:disabled').click()`);
    const futureSelection = await evaluate('document.querySelector("#selected-start").textContent');
    check('B10 disabled future dates do not change the selection', () => assert.equal(futureSelection, '尚未選擇'));
    await evaluate(`document.querySelector('.calendar-day.today').focus()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    const focusRemainsToday = await evaluate('document.activeElement.classList.contains("today")');
    check('B10 keyboard cannot move selection into the future', () => assert.equal(focusRemainsToday, true));
    await click('[data-date="2026-09-05"]'); await click('[data-date="2026-09-06"]');
    const selectedDateColors = await evaluate(`[...document.querySelectorAll('.calendar-day.selected')].map(e=>getComputedStyle(e).backgroundColor)`);
    check('B13 hovering a selected endpoint preserves the selected date contrast',()=>{assert.equal(selectedDateColors.length,2);assert.equal(selectedDateColors[0],selectedDateColors[1]);});
    await screenshot('05-calendar-range-desktop');
    await click('#apply-calendar'); await waitFor('!document.querySelector("#date-dialog").open');
    const filtered = await evaluate(`({description:document.querySelector('#audit-range-description').textContent,summary:document.querySelector('#pagination-summary').textContent,dates:[...document.querySelectorAll('.audit-time')].map(e=>e.textContent.slice(0,10)),page:document.querySelector('#pagination [aria-current]').textContent,nextDisabled:document.querySelector('#pagination [aria-label="下一頁"]').disabled})`);
    check('B07/B08 date range includes all 15 records on one page and resets pagination', () => { assert.match(filtered.description, /2026\/09\/05 – 2026\/09\/06/); assert.match(filtered.summary, /共 15 筆/); assert.equal(filtered.page, '1'); assert.equal(filtered.dates.length,15); assert.ok(filtered.dates.every(date => ['2026/09/05', '2026/09/06'].includes(date))); assert.equal(filtered.nextDisabled,true); });
    await click('#open-calendar'); await click('[data-date-mode="single"]'); await click('[data-date="2026-09-05"]'); await click('#apply-calendar');
    await waitFor('document.querySelector("#audit-range-description").textContent.startsWith("2026/09/05 ·")');
    const single = await evaluate('document.querySelector("#pagination-summary").textContent');
    check('B08 single day contains all 7 historical entries', () => assert.match(single, /共 7 筆/));
    await click('#open-calendar'); await click('#previous-month'); await click('[data-date="2026-08-01"]'); await click('#cancel-calendar');
    const afterCancel = await evaluate('document.querySelector("#audit-range-description").textContent');
    check('B08 cancelling date selection preserves applied date', () => assert.match(afterCancel, /^2026\/09\/05 ·/));
    await click('#open-calendar'); await click('#previous-month'); await click('[data-date="2026-08-01"]'); await click('#apply-calendar');
    await waitFor('document.querySelector("#audit-table").textContent.includes("這段日期沒有")');
    check('B08 an empty date range has an explicit empty state', () => {}); await screenshot('06-audit-empty');
    await click('#clear-date-filter');
    await waitFor('document.querySelector("#audit-range-description").textContent.startsWith("不限日期")');
    check('B08 clearing dates restores all records', () => {});

    // Exercise the approved public registration point, not a third page hardcoded into the view.
    await evaluate(`BatchConsoleAudit.record('未來新增頁面', '已完成新頁面作業', 'ABC-FUTURE-001')`);
    const future = await evaluate('document.querySelector("#audit-table").textContent');
    check('B05 future page events appear through the same public recording entry point', () => { assert.match(future, /未來新增頁面/); assert.match(future, /ABC-FUTURE-001/); });
    await click('#open-calendar'); await click('[data-date-mode="single"]'); await click('[data-date="2026-09-05"]'); await click('#apply-calendar');
    await navigate('[data-route="dashboard"]'); await navigate('[data-route="audit"]');
    await waitFor('document.querySelector("#audit-range-description").textContent.startsWith("不限日期")');
    check('B06 returning to audit opens all dates on page one', () => {});

    await viewport(390, 844); await layout('audit-mobile'); await screenshot('07-audit-mobile');
    await click('#open-calendar'); await click('[data-date="2026-09-05"]'); await click('[data-date="2026-09-07"]');
    await screenshot('08-calendar-mobile');
    await calendarLayout('mobile');
    await viewport(320,640); await calendarLayout('small mobile'); await screenshot('15-calendar-small-mobile'); await viewport(390,844);
    await click('#previous-month'); await viewport(320,640); await calendarLayout('six-row month on small mobile');
    await click('[data-date-mode="range"]'); await click('[data-date="2026-08-31"]'); await click('#next-month'); await click('[data-date="2026-09-05"]');
    const crossMonthSelection = await evaluate(`({start:document.querySelector('#selected-start').textContent,end:document.querySelector('#selected-end').textContent})`);
    check('B13 single-month calendar supports a cross-month range',()=>assert.deepEqual(crossMonthSelection,{start:'2026/08/31',end:'2026/09/05'}));
    await screenshot('17-calendar-cross-month-mobile');
    await click('#apply-calendar');
    const appliedCrossMonth = await evaluate('document.querySelector("#date-trigger-label").textContent');
    check('B13 applied date trigger retains the full range',()=>assert.match(appliedCrossMonth,/2026\/08\/31.*2026\/09\/05/));
    await screenshot('18-audit-range-small-mobile');
    await click('#open-calendar'); await viewport(390,844);
    const dialogBox = await evaluate(`(() => {const r=document.querySelector('#date-dialog').getBoundingClientRect();return {x:r.x,right:r.right,width:innerWidth};})()`);
    check('B08 mobile date dialog stays within viewport', () => { assert.ok(dialogBox.x >= 0); assert.ok(dialogBox.right <= dialogBox.width); });
    const applyVisible = await evaluate(`(() => { const button=document.querySelector('#apply-calendar'); const box=button.getBoundingClientRect(); const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2); return box.bottom <= innerHeight && (hit === button || button.contains(hit)); })()`);
    check('B08 mobile calendar apply action stays visible while browsing months', () => assert.equal(applyVisible, true));
    await click('#cancel-calendar');
    await navigate('[data-route="dashboard"]'); await layout('dashboard-mobile'); await screenshot('09-dashboard-mobile');
    await click('#dashboard-table [data-batch="ABC-20260907-001"]'); await waitFor('document.querySelectorAll(".stage").length === 6');
    await layout('query-mobile'); await screenshot('10-query-mobile');
    for (const width of [320, 679, 680, 681, 759, 760, 761, 959, 960, 961, 1199, 1200, 1201, 1499, 1500, 1501]) {
      await viewport(width, 640); await layout(`query-width-${width}`);
    }
    await viewport(1280, 640); await screenshot('11-query-short-desktop');
    await viewport(1440, 1000);
    await navigate('[data-route="dashboard"]');
    const visitedBatches = [];
    const directions = { bidirectional: stageNames, upload: stageNames.slice(0,3), download: stageNames.slice(3) };
    const expectedFlows = [
      ['ABC-20260907-001','自動','bidirectional',3], ['ABC-20260907-002','手動','bidirectional',3],
      ['ABC-20260907-003','自動','bidirectional',3], ['ABC-20260907-004','自動','bidirectional',4],
      ['ABC-20260907-005','手動','bidirectional',3], ['ABC-20260907-006','自動','bidirectional',3],
      ['ABC-20260907-007','自動','bidirectional',0], ['ABC-20260907-008','手動','bidirectional',6],
      ['ABC-20260907-009','手動','upload',3], ['ABC-20260907-010','自動','upload',0],
      ['ABC-20260907-011','自動','download',0], ['ABC-20260907-012','手動','download',0],
      ['ABC-20260907-013','手動','upload',0], ['ABC-20260907-014','手動','bidirectional',0],
      ['ABC-20260905-015','自動','bidirectional',0], ['ABC-20260905-016','手動','upload',0],
      ['ABC-20260905-017','自動','download',0], ['ABC-20260905-018','手動','bidirectional',0],
      ['ABC-20260905-019','自動','upload',0], ['ABC-20260906-020','手動','download',0],
      ['ABC-20260906-021','自動','bidirectional',0], ['ABC-20260906-022','手動','upload',0],
      ['ABC-20260906-023','自動','download',0], ['ABC-20260906-024','手動','bidirectional',0],
      ['ABC-20260906-025','自動','upload',0]
    ];
    for (const state of ['stopped','reviewing','processing','success']) {
      await click(`#dashboard-stats [data-status="${state}"]`);
      const ids = await evaluate(`[...document.querySelectorAll('#dashboard-table [data-batch]')].map(e=>e.dataset.batch)`);
      for (const id of ids) {
        await click(`#dashboard-stats [data-status="${state}"]`);
        await click(`#dashboard-table [data-batch="${id}"]`);
        await waitFor(`document.querySelector('.detail-identity h2').textContent === '${id}'`);
        const flow = await evaluate(`({names:[...document.querySelectorAll('.stage-name')].map(e=>e.textContent),waiting:document.querySelectorAll('.stage.waiting').length,cancel:!!document.querySelector('#cancel-upload')})`);
        const [,mode,direction,waiting] = expectedFlows.find(item=>item[0]===id);
        const names = [...(mode==='手動'&&direction!=='download'?['上傳檔案','審核完成']:[]),...directions[direction]];
        check(`N02 every workbench batch ${id} shows its entire workflow`,()=>{assert.deepEqual(flow.names,names);assert.equal(flow.waiting,waiting);assert.equal(flow.cancel,false);});
        visitedBatches.push(id);
        if (id.endsWith('002')) await screenshot('20-query-failure-002');
        await navigate('[data-route="dashboard"]');
      }
    }
    check('N02 all twenty-five batches checked without omissions',()=>assert.deepEqual(visitedBatches.slice().sort(),expectedFlows.map(item=>item[0]).sort()));

    // Confirmed review-only detail, query dates and paging.
    await click('#dashboard-stats [data-status="reviewing"]');
    const reviewCard = await evaluate(`({rows:document.querySelectorAll('#dashboard-table tbody tr').length,statuses:[...document.querySelectorAll('#dashboard-table .badge')].map(e=>e.textContent),color:getComputedStyle(document.querySelector('.stat.reviewing .stat-number')).color})`);
    check('N01 brown review card filters two pending manual uploads',()=>{assert.equal(reviewCard.rows,2);assert.deepEqual(reviewCard.statuses,['審核中','審核中']);assert.equal(reviewCard.color,'rgb(121, 84, 59)');});
    await screenshot('21-workbench-review');
    await click('#dashboard-table [data-batch="ABC-20260907-008"]');
    await waitFor('document.querySelectorAll(".stage").length === 8');
    await screenshot('22-manual-review-eight-stages'); await layout('manual-review-desktop');
    await click('[data-stage="1"]');
    const reviewStage = await evaluate('document.querySelector("#stage-detail").textContent');
    check('N02 review is a separate preparation stage, not an execution attempt',()=>{assert.match(reviewStage,/手動作業前置階段/);assert.match(reviewStage,/等待審核/);assert.doesNotMatch(reviewStage,/執行 1 次/);});
    const auditBeforeReviewBrowsing = await evaluate('window.BatchConsoleAudit.list()');
    const reviewOnly = await evaluate(`({status:document.querySelector('.detail-actions .badge').textContent,cancel:!!document.querySelector('#cancel-upload'),waiting:document.querySelectorAll('.stage.waiting').length})`);
    check('R06 review detail is read-only for the administrator',()=>{assert.equal(reviewOnly.status,'審核中');assert.equal(reviewOnly.cancel,false);assert.equal(reviewOnly.waiting,6);});
    await navigate('[data-route="dashboard"]'); await click('#dashboard-stats [data-status="reviewing"]');
    const remainingReview = await evaluate(`({count:document.querySelector('.stat.reviewing .stat-number').textContent,ids:[...document.querySelectorAll('#dashboard-table [data-batch]')].map(e=>e.dataset.batch)})`);
    check('R06 viewing review details preserves the pending batches and audit',()=>{assert.equal(remainingReview.count,'2');assert.deepEqual(remainingReview.ids,['ABC-20260907-008','ABC-20260907-009']);});
    assert.deepEqual(await evaluate('window.BatchConsoleAudit.list()'), auditBeforeReviewBrowsing);

    await navigate('[data-route="query"]');
    await click('#show-all-batches');
    const firstQueryPage = await evaluate(`({ids:[...document.querySelectorAll('#query-table [data-batch]')].map(e=>e.dataset.batch),total:document.querySelector('#query-pagination-summary').textContent})`);
    check('N05 query first page shows twenty of twenty-five batches',()=>{assert.equal(firstQueryPage.ids.length,20);assert.match(firstQueryPage.total,/共 25 筆/);assert.ok(firstQueryPage.ids.includes('ABC-20260907-008'));});
    await screenshot('25-query-first-page');
    await click('#query-pagination [aria-label="下一頁"]');
    const secondQueryPage = await evaluate(`({ids:[...document.querySelectorAll('#query-table [data-batch]')].map(e=>e.dataset.batch),current:document.querySelector('#query-pagination [aria-current]').textContent})`);
    check('N05 query second page contains five distinct remaining batches',()=>{assert.equal(secondQueryPage.current,'2');assert.equal(secondQueryPage.ids.length,5);assert.equal(new Set([...firstQueryPage.ids,...secondQueryPage.ids]).size,25);});
    await screenshot('26-query-second-page');
    await click('#query-table [data-batch="' + secondQueryPage.ids[0] + '"]');
    await waitFor('!document.querySelector("#batch-detail").hidden');
    await click('#back-to-batches');
    const restoredPage = await evaluate(`({ids:[...document.querySelectorAll('#query-table [data-batch]')].map(e=>e.dataset.batch),current:document.querySelector('#query-pagination [aria-current]').textContent})`);
    check('Vue returning from detail retains page two and the same five batches',()=>assert.deepEqual(restoredPage,secondQueryPage));
    await click('#open-query-calendar'); await screenshot('27-query-date-desktop'); await calendarLayout('batch query desktop');
    await click('[data-date="2026-09-05"]'); await click('[data-date="2026-09-06"]'); await click('#apply-calendar');
    await waitFor('!document.querySelector("#date-dialog").open');
    const queryRange = await evaluate(`({rows:document.querySelectorAll('#query-table tbody tr').length,current:document.querySelector('#query-pagination [aria-current]').textContent,dates:[...document.querySelectorAll('#query-table .time-cell')].map(e=>e.firstChild.textContent),description:document.querySelector('#query-range-description').textContent})`);
    check('N04/N05 last-updated date range is inclusive and resets the query page',()=>{assert.equal(queryRange.rows,11);assert.equal(queryRange.current,'1');assert.equal(queryRange.dates.filter(d=>d==='2026/09/05').length,5);assert.equal(queryRange.dates.filter(d=>d==='2026/09/06').length,6);assert.match(queryRange.description,/最後更新日期/);});
    await click('#open-query-calendar'); await click('[data-date-mode="single"]'); await click('[data-date="2026-09-05"]'); await click('#apply-calendar');
    await waitFor('!document.querySelector("#date-dialog").open');
    const querySingleCount = await evaluate('document.querySelectorAll("#query-table tbody tr").length');
    check('N04 batch single-day filter shows five historical batches',()=>assert.equal(querySingleCount,5));
    await click('#query-table [data-batch="ABC-20260905-015"]');
    await waitFor('!document.querySelector("#batch-detail").hidden');
    await click('#back-to-batches');
    const restoredFilter = await evaluate(`({rows:document.querySelectorAll('#query-table tbody tr').length,date:document.querySelector('#query-date-label').textContent})`);
    check('Vue returning from detail retains the applied single-day filter',()=>{assert.equal(restoredFilter.rows,5);assert.equal(restoredFilter.date,'2026/09/05');});
    await evaluate(`document.querySelector('#batch-id-input').value='ABC-20260906';document.querySelector('#batch-search').requestSubmit()`);
    await waitFor('document.querySelector("#query-table").textContent.includes("查無")');
    check('N04 ID search and date conditions are intersected',()=>{});
    await screenshot('28-query-date-empty');
    await click('#clear-query-date');
    const clearedQuery = await evaluate(`({rows:document.querySelectorAll('#query-table tbody tr').length,input:document.querySelector('#batch-id-input').value,feedback:document.querySelector('#search-feedback').textContent})`);
    check('N04 clearing date keeps ID filter and removes stale result feedback',()=>{assert.equal(clearedQuery.rows,6);assert.equal(clearedQuery.input,'ABC-20260906');assert.equal(clearedQuery.feedback,'');});
    await click('#show-all-batches');
    await evaluate(`document.querySelector('#batch-id-input').value='ABC-20260907-008';document.querySelector('#batch-search').requestSubmit()`);
    await waitFor('!document.querySelector("#batch-detail").hidden');
    const foundPending = await evaluate('document.querySelector(".detail-actions .badge").textContent');
    check('R06 pending batch remains searchable without a state change',()=>assert.equal(foundPending,'審核中'));

    await click('#back-to-batches');
    await click('#show-all-batches');
    await click('#query-table [data-batch="ABC-20260907-009"]');
    for (const width of [320,679,680,681,959,960,961,1399,1400,1401]) {
      await viewport(width,640); await layout('manual-review-width-'+width);
    }
    await viewport(320,640); await screenshot('29-manual-review-mobile');
    const mobileCancelVisible = await evaluate('!!document.querySelector("#cancel-upload")');
    check('R06 mobile review detail has no cancellation action',()=>assert.equal(mobileCancelVisible,false));
    await click('#back-to-batches'); await click('#show-all-batches'); await click('#open-query-calendar');
    await calendarLayout('batch query small mobile'); await screenshot('31-query-calendar-mobile');
    await click('[data-date="2026-09-05"]'); await click('[data-date="2026-09-06"]'); await click('#apply-calendar');
    await waitFor('!document.querySelector("#date-dialog").open');
    await layout('query-filter-mobile'); await screenshot('32-query-range-mobile');
    await navigate('[data-route="audit"]');
    const separateAuditRange = await evaluate('document.querySelector("#audit-range-description").textContent');
    check('N04 batch filters do not change the operation-log date filter',()=>assert.match(separateAuditRange,/不限日期/));
    await viewport(1440,1000);
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/search?batch=ABC-20260907-004' });
    await waitFor('document.querySelector(".detail-identity h2")?.textContent === "ABC-20260907-004"');
    check('Vue direct detail URL loads all six stages',()=>{});
    await click('#back-to-batches');
    await waitFor('document.querySelectorAll("#query-table tbody tr").length === 20 && !document.querySelector("#query-list").hidden');
    check('Vue back-to-list action shows the first twenty batches',()=>{});
    await evaluate('history.back()');
    await waitFor('document.querySelector(".detail-identity h2")?.textContent === "ABC-20260907-004"');
    check('Vue browser history restores the detail URL and selection',()=>{});
    await click('.brand-row');
    await waitFor('document.querySelectorAll("#dashboard-table tbody tr").length === 4');
    check('Vue brand navigation returns to abnormal workbench',()=>{});
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/logs' });
    await waitFor('document.querySelectorAll(".audit-table tbody tr").length === 20');
    const directAudit = await evaluate('document.querySelector("#audit-range-description").textContent');
    check('Vue direct audit URL opens without a date filter',()=>assert.match(directAudit,/不限日期/));
    const auditCountBeforeEscape = await evaluate('window.BatchConsoleAudit.list().length');
    await click('#open-calendar');
    await send('Input.dispatchKeyEvent', { type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27 });
    await send('Input.dispatchKeyEvent', { type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27 });
    await waitFor('!document.querySelector("#date-dialog").open');
    const escaped = await evaluate('({focus:document.activeElement.id,auditCount:window.BatchConsoleAudit.list().length})');
    check('Vue Escape closes calendar, restores focus and does not record browsing',()=>{assert.equal(escaped.focus,'open-calendar');assert.equal(escaped.auditCount,auditCountBeforeEscape);});
    // User-confirmed keyword search scenarios. Use keyboard input and the real form.
    async function searchKeyword(value) {
      await click('#batch-id-input');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      if (value) await send('Input.insertText', { text: value });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    }
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/search' });
    await waitFor('document.querySelectorAll("#query-table tbody tr").length === 20');
    const keywordAuditCount = await evaluate('window.BatchConsoleAudit.list().length');
    await click('#query-pagination [aria-label="下一頁"]');
    await searchKeyword('  aBc-202609  ');
    const keywordResult = await evaluate(`({total:document.querySelector('#query-pagination-summary').textContent,page:document.querySelector('#query-pagination [aria-current]').textContent,input:document.querySelector('#batch-id-input').value})`);
    check('Keyword search ignores case and surrounding spaces and resets page two', () => {
      assert.match(keywordResult.total, /共 25 筆/); assert.equal(keywordResult.page, '1'); assert.equal(keywordResult.input, 'aBc-202609');
    });
    await click('#query-pagination [aria-label="下一頁"]');
    await click('#query-table [data-batch="ABC-20260906-021"]');
    await click('#back-to-batches');
    const keywordBack = await evaluate(`({page:document.querySelector('#query-pagination [aria-current]').textContent,input:document.querySelector('#batch-id-input').value})`);
    check('Returning from detail keeps the keyword and page two', () => assert.deepEqual(keywordBack, { page: '2', input: 'aBc-202609' }));
    await click('#query-table [data-batch="ABC-20260906-021"]');
    await click('#toggle-batch-search');
    const detailKeyword = await evaluate('document.querySelector("#batch-id-input").value');
    check('Adjusting conditions in detail keeps the keyword instead of replacing it with the selected ID', () => assert.equal(detailKeyword, 'aBc-202609'));
    await click('#open-query-calendar');
    await click('[data-date-mode="single"]'); await click('[data-date="2026-09-06"]'); await click('#apply-calendar');
    const keywordDate = await evaluate(`({ids:[...document.querySelectorAll('#query-table [data-batch]')].map(e=>e.dataset.batch),page:document.querySelector('#query-pagination [aria-current]').textContent,input:document.querySelector('#batch-id-input').value})`);
    check('Date selected in detail intersects the original keyword and returns all six matching batches', () => {
      assert.equal(keywordDate.ids.length, 6); assert.ok(keywordDate.ids.every(id => id.startsWith('ABC-20260906-'))); assert.equal(keywordDate.page, '1'); assert.equal(keywordDate.input, 'aBc-202609');
    });
    await click('#query-table [data-batch="ABC-20260906-020"]'); await click('#back-to-batches');
    const retainedDate = await evaluate('document.querySelector("#query-date-label").textContent');
    check('Returning from detail preserves the keyword date intersection', () => assert.equal(retainedDate, '2026/09/06'));
    await searchKeyword('');
    const clearedKeyword = await evaluate(`({rows:document.querySelectorAll('#query-table tbody tr').length,date:document.querySelector('#query-date-label').textContent,input:document.querySelector('#batch-id-input').value})`);
    check('Clearing and submitting the keyword keeps the date and its six matching batches', () => assert.deepEqual(clearedKeyword, { rows: 6, date: '2026/09/06', input: '' }));
    await click('#clear-query-date');
    await searchKeyword('025');
    await waitFor('document.querySelector(".detail-identity h2")?.textContent === "ABC-20260906-025"');
    check('A suffix with one match retains the existing automatic detail navigation', () => {});
    await click('#toggle-batch-search'); await searchKeyword('6090');
    const middleResult = await evaluate('document.querySelector("#query-pagination-summary").textContent');
    check('A middle keyword submitted from detail returns the matching list', () => assert.match(middleResult, /共 25 筆/));
    await searchKeyword('NO-SUCH-BATCH');
    const missingKeyword = await evaluate('document.querySelector("#query-table").textContent');
    check('An unmatched keyword shows the empty-result message', () => assert.match(missingKeyword, /查無符合的批次/));
    await click('#show-all-batches');
    await viewport(320, 640);
    if (await evaluate('document.querySelector("#sidebar-toggle").getAttribute("aria-expanded") === "true"')) {
      await click('#sidebar-toggle'); await evaluate('new Promise(resolve => setTimeout(resolve,250))');
    }
    await searchKeyword('  aBc-20260906  ');
    const mobileKeyword = await evaluate('document.querySelectorAll("#query-table tbody tr").length');
    check('Mobile keyword search returns all six matching batches', () => assert.equal(mobileKeyword, 6));
    await layout('keyword-search-mobile'); await screenshot('33-keyword-search-mobile');
    const finalKeywordAuditCount = await evaluate('window.BatchConsoleAudit.list().length');
    check('Keyword, date and detail browsing create no batch audit entries', () => assert.equal(finalKeywordAuditCount, keywordAuditCount));
    await viewport(1440, 1000);
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/workbench' });
    await waitFor('document.querySelectorAll(".stat-number").length === 4');
    await screenshot('34-readme-workbench');
    // Confirmed file-operation audit rules: one entry per successful multi-file download.
    await navigate('a[href="/operation/download"]');
    await waitFor('document.querySelectorAll(".download-file-table tbody tr").length === 20');
    const downloadAuditCount = await evaluate('window.BatchConsoleAudit.list().length');
    const firstDownloadName = await evaluate('document.querySelector(".download-file-table tbody tr td:nth-child(4)").textContent');
    await click('.download-file-table tbody tr:first-child');
    await click('.download-view [aria-label="下一頁"]');
    const secondDownloadName = await evaluate('document.querySelector(".download-file-table tbody tr td:nth-child(4)").textContent');
    await click('.download-file-table tbody tr:first-child');
    await click('.download-submit-button');
    await click('.confirm-modal .text-button');
    const dismissedDownload = await evaluate('window.BatchConsoleAudit.list().length');
    check('Selecting files across pages and dismissing download confirmation creates no audit entries', () => assert.equal(dismissedDownload, downloadAuditCount));
    await click('.download-submit-button'); await click('.confirm-modal .primary-button');
    const successfulDownload = await evaluate('window.BatchConsoleAudit.list()');
    check('A successful multi-file download records one entry containing both filenames and the completion time', () => {
      assert.equal(successfulDownload.length, downloadAuditCount+1);
      const entry=successfulDownload.at(-1);
      assert.equal(entry.page,'下傳'); assert.equal(entry.batchId,null);
      assert.ok(entry.action.includes(firstDownloadName)); assert.ok(entry.action.includes(secondDownloadName));
      assert.match(entry.action,/2 筆/); assert.equal(entry.time,'2026-09-07T17:00:00+08:00');
    });
    const resetDownload = await evaluate('document.querySelector(".selected-count").textContent');
    check('Successful download still clears the selected files', () => assert.match(resetDownload,/0 筆/));
    // Page two contains the existing simulated-failure file (ID 37).
    await click('.download-file-table tbody tr:nth-child(17)');
    await click('.download-submit-button'); await click('.confirm-modal .primary-button');
    await waitFor('document.querySelector(".download-toast.is-error")');
    const failedDownloadAudit = await evaluate('window.BatchConsoleAudit.list()');
    check('A failed download keeps the audit history unchanged', () => assert.deepEqual(failedDownloadAudit,successfulDownload));
    await navigate('[data-route="audit"]');
    const downloadAuditRow = await evaluate(`(() => { const row=document.querySelector('.audit-table tbody tr'); return {batch:row.querySelector('.batch-code').textContent,action:row.querySelector('.audit-action').textContent,source:row.querySelector('.audit-source')?.textContent ?? null}; })()`);
    check('Operation log renders one download entry with both filenames and a dash for the batch ID', () => {
      assert.equal(downloadAuditRow.batch,'—'); assert.equal(downloadAuditRow.action,successfulDownload.at(-1).action); assert.equal(downloadAuditRow.source,null); assert.equal(successfulDownload.at(-1).page,'下傳');
    });
    await screenshot('35-download-audit-record');
    check('No uncaught JavaScript exceptions', () => assert.deepEqual(runtimeErrors, []));
    report.completed = true;
  } catch (error) {
    report.completed = false;
    report.failure = error.stack;
    console.error(error);
    try { await screenshot('failure'); } catch {}
    process.exitCode = 1;
  } finally {
    report.finishedAtUtc = new Date().toISOString();
    fs.writeFileSync(path.join(runDirectory, 'checks.json'), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${runDirectory}`);
    socket.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
