const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main(operation, label, fileTypeCode) {
  const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json()
  const target = targets.find((item) => item.type === 'page' && !item.url.startsWith('edge://'))
  assert.ok(target, 'An isolated Edge page must be available')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let sequence = 0
  const pending = new Map()

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (!message.id || !pending.has(message.id)) return

    const waiter = pending.get(message.id)
    clearTimeout(waiter.timeout)
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
  })

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 15000)
      pending.set(id, { resolve, reject, timeout })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`${result.exceptionDetails.text} ${JSON.stringify(result.exceptionDetails.exception)}`)
    }
    return result.result.value
  }

  async function waitFor(expression) {
    const deadline = Date.now() + 6000
    while (!(await evaluate(expression))) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${expression}`)
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
  }

  async function click(selector) {
    const point = await evaluate(`(() => {
      const element=document.querySelector(${JSON.stringify(selector)});
      if(!element||element.disabled||!element.getClientRects().length)throw new Error('Unavailable control');
      element.scrollIntoView({block:'center'});
      const box=element.getBoundingClientRect();
      return {x:box.x+box.width/2,y:box.y+box.height/2};
    })()`)
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      clickCount: 1,
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      clickCount: 1,
    })
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  }

  async function viewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await evaluate('new Promise(resolve=>setTimeout(resolve,250))')
  }

  const evidenceDirectory = path.join(__dirname, '..', 'artifacts', `${operation}-browser`)
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  async function screenshot(name) {
    const result = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(evidenceDirectory, `${name}.png`), Buffer.from(result.data, 'base64'))
  }

  function check(name, assertion) {
    assertion()
    console.log(`OK ${operation}: ${name}`)
  }

  async function chooseFile(name, content, type) {
    await evaluate(`(() => {
      const input=document.querySelector('.native-file-input');
      const transfer=new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(content)}],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));
      input.files=transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`)
  }

  try {
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const NativeDate=Date;
        class DemoDate extends NativeDate {
          constructor(...args){super(...(args.length?args:['2026-09-07T09:00:00.000Z']));}
          static now(){return new NativeDate('2026-09-07T09:00:00.000Z').getTime();}
        }
        window.Date=DemoDate;
        window.__uploadTestErrors=[];
        window.addEventListener('error',event=>window.__uploadTestErrors.push(event.message));
        window.addEventListener('unhandledrejection',event=>window.__uploadTestErrors.push(String(event.reason)));
      })();`,
    })

    await viewport(1440, 1000)
    await send('Page.navigate', { url: `http://127.0.0.1:5173/operation/${operation}` })
    await waitFor(`document.querySelector('.${operation}-job-table tbody tr')`)
    await evaluate('localStorage.removeItem("batch-console-upload-sequence")')
    const initialAuditCount = await evaluate('window.BatchConsoleAudit.list().length')

    const initial = await evaluate(`({
      accept:document.querySelector('.native-file-input')?.getAttribute('accept')??null,
      text:document.querySelector('.${operation}-view').textContent
    })`)
    check('source files have no extension restriction', () => {
      assert.equal(initial.accept, null)
      assert.doesNotMatch(initial.text, /支援格式/)
    })

    await click(`.${operation}-job-table tbody tr:first-child .outline-button`)
    await chooseFile('upload-fail.csv', 'failed content', 'text/csv')
    await click(`.${operation}-submit-button`)
    await click('.confirm-modal .text-button')
    const auditAfterDismissal = await evaluate('window.BatchConsoleAudit.list().length')
    check('dismissing file-operation confirmation creates no audit entry', () => assert.equal(auditAfterDismissal, initialAuditCount))
    await click(`.${operation}-submit-button`)
    await click('.confirm-modal .primary-button')
    await waitFor(`document.querySelector('.${operation}-toast.is-error')`)
    const sequenceAfterFailure = await evaluate('localStorage.getItem("batch-console-upload-sequence")')
    check('simulated failure does not consume a serial', () =>
      assert.equal(sequenceAfterFailure, null),
    )
    const auditAfterFailure = await evaluate('window.BatchConsoleAudit.list().length')
    check('failed file operation creates no audit entry', () => assert.equal(auditAfterFailure, initialAuditCount))

    const content = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n')
    await chooseFile('source.pdf', content, 'application/pdf')
    await click(`.${operation}-submit-button`)
    await click('.confirm-modal .primary-button')
    await waitFor(`document.querySelector('.${operation}-result-modal')`)
    const prematureNotice = await evaluate(`!!document.querySelector('.${operation}-toast.is-success')`)
    check('success notification is deferred while the preview is open', () => assert.equal(prematureNotice, false))

    const result = await evaluate(`({
      request:document.querySelector('.request-file-info dd').textContent,
      source:document.querySelector('.result-info-list div:nth-child(2) dd').textContent,
      content:document.querySelector('.file-preview-text').textContent,
      modes:[...document.querySelectorAll('.preview-mode-group button')].map(button=>button.textContent.trim()),
      sequence:JSON.parse(localStorage.getItem('batch-console-upload-sequence'))
    })`)
    check('success creates the DAT result and all preview choices', () => {
      assert.equal(result.request, `${fileTypeCode}20260907170000001.DAT`)
      assert.equal(result.source, 'source.pdf')
      assert.match(result.content, /line 1[\s\S]*line 12/)
      assert.deepEqual(result.modes, ['全部', '前 10 行', '後 10 行'])
      assert.deepEqual(result.sequence, { dateKey: '20260907', lastSerial: 1 })
    })
    const completedAudit = await evaluate('window.BatchConsoleAudit.list()')
    check('successful file operation records exactly one filename and timestamp without inventing a batch ID', () => {
      assert.equal(completedAudit.length, initialAuditCount + 1)
      const entry = completedAudit.at(-1)
      assert.equal(entry.page, label); assert.equal(entry.batchId, null)
      assert.ok(entry.action.includes('source.pdf')); assert.ok(entry.action.includes(result.request))
      assert.equal(entry.time, '2026-09-07T17:00:00+08:00')
    })
    await click('.preview-mode-group button:nth-child(2)')
    const firstTen = await evaluate('document.querySelector(".file-preview-text").textContent.split("\\n")')
    check('first ten preview is correct', () => {
      assert.equal(firstTen.length, 10)
      assert.equal(firstTen[0], 'line 1')
      assert.equal(firstTen.at(-1), 'line 10')
    })

    await click('.preview-mode-group button:nth-child(3)')
    const lastTen = await evaluate('document.querySelector(".file-preview-text").textContent.split("\\n")')
    check('last ten preview is correct', () => {
      assert.equal(lastTen.length, 10)
      assert.equal(lastTen[0], 'line 3')
      assert.equal(lastTen.at(-1), 'line 12')
    })

    const desktopWidth = await evaluate('({page:document.documentElement.scrollWidth,viewport:innerWidth})')
    check('desktop result has no horizontal page overflow', () =>
      assert.ok(desktopWidth.page <= desktopWidth.viewport),
    )
    await screenshot('upload-result-desktop')

    await viewport(320, 640)
    const sidebarExpanded = await evaluate('document.querySelector("#sidebar-toggle").getAttribute("aria-expanded") === "true"')
    if (sidebarExpanded) {
      await click('#sidebar-toggle')
      await evaluate('new Promise(resolve=>setTimeout(resolve,250))')
    }
    const mobile = await evaluate(`(() => {
      const modal=document.querySelector('.${operation}-result-modal');
      const box=modal.getBoundingClientRect();
      const controls=[...modal.querySelectorAll('button')].map(element=>element.getBoundingClientRect());
      const outside=[...document.querySelectorAll('body *')].filter(element=>{const item=element.getBoundingClientRect();return item.right>innerWidth+1||item.left< -1;}).map(element=>({tag:element.tagName,className:element.className?.baseVal??element.className,left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,scrollWidth:element.scrollWidth})).slice(0,20);
      return {page:document.documentElement.scrollWidth,viewport:innerWidth,height:innerHeight,box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},controls:controls.map(item=>({left:item.left,right:item.right,top:item.top,bottom:item.bottom})),outside};
    })()`)
    check('320px result dialog stays within the viewport', () => {
      assert.ok(mobile.page <= mobile.viewport, JSON.stringify(mobile))
      assert.ok(mobile.box.left >= 0 && mobile.box.right <= mobile.viewport)
      assert.ok(mobile.box.top >= 0 && mobile.box.bottom <= mobile.height)
      assert.ok(mobile.controls.every((control) => control.left >= 0 && control.right <= mobile.viewport && control.top >= 0 && control.bottom <= mobile.height))
    })
    await screenshot('upload-result-mobile')

    const noticeWhileReading = await evaluate(`!!document.querySelector('.${operation}-toast.is-success')`)
    check('reading all and first/last ten lines never shows the success notification', () => assert.equal(noticeWhileReading, false))
    await click(`.${operation}-result-modal .modal-actions .primary-button`)
    const completed = await evaluate(`({notice:document.querySelector('.${operation}-toast.is-success')?.textContent || '',preview:!!document.querySelector('.${operation}-result-modal'),list:!!document.querySelector('.${operation}-job-table')})`)
    check('closing the preview returns to the list and displays one success notification', () => {
      assert.match(completed.notice, new RegExp(`${label}成功`)); assert.ok(completed.notice.includes('source.pdf'))
      assert.equal(completed.preview, false); assert.equal(completed.list, true)
    })
    const toastBounds = await evaluate(`(() => {
      const toast=document.querySelector('.${operation}-toast'); const box=toast.getBoundingClientRect();
      const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
      return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,visible:toast===hit||toast.contains(hit)};
    })()`)
    check('mobile notification is visible within the viewport after closing the preview', () => {
      assert.ok(toastBounds.left>=0 && toastBounds.right<=320 && toastBounds.top>=0 && toastBounds.bottom<=640)
      assert.equal(toastBounds.visible, true)
    })
    await waitFor(`getComputedStyle(document.querySelector('.${operation}-toast')).opacity === '1'`)
    await screenshot(`${operation}-success-notice-mobile`)
    await viewport(1440, 1000); await screenshot(`${operation}-success-notice-desktop`)
    await waitFor(`!document.querySelector('.${operation}-toast')`)
    check('success notification automatically disappears after returning to the list', () => {})
    await click(`.${operation}-job-table tbody tr:first-child .outline-button`)
    await click(`.${operation}-page-heading-row .text-button`)
    const repeatNotice = await evaluate(`!!document.querySelector('.${operation}-toast.is-success')`)
    check('returning without completing another operation does not repeat the success notice', () => assert.equal(repeatNotice, false))
    const auditAfterPreview = await evaluate('window.BatchConsoleAudit.list()')
    check('switching previews, closing the result and returning cannot duplicate the audit entry', () => assert.deepEqual(auditAfterPreview, completedAudit))
    await click('[data-route="audit"]')
    await waitFor('document.querySelector(".audit-table tbody tr")')
    const auditRow = await evaluate(`(() => {
      const row=document.querySelector('.audit-table tbody tr');
      return {batch:row.querySelector('.batch-code').textContent,action:row.querySelector('.audit-action').textContent,source:row.querySelector('.audit-source').textContent,time:row.querySelector('.audit-time').textContent};
    })()`)
    check('operation log page displays the new operation first with an empty batch reference', () => {
      assert.equal(auditRow.batch, '—'); assert.equal(auditRow.action, completedAudit.at(-1).action)
      assert.equal(auditRow.source, label); assert.match(auditRow.time, /2026\/09\/07.*17:00:00/)
    })
    await screenshot(`${operation}-audit-record`)

    // Complete the existing long-name confirmation at desktop width, then inspect the new mobile notice.
    await viewport(1920, 1000)
    await send('Page.navigate', { url: `http://127.0.0.1:5173/operation/${operation}` })
    await waitFor(`document.querySelector('.${operation}-job-table tbody tr')`)
    await click(`.${operation}-job-table tbody tr:first-child .outline-button`)
    const longFileName = 'source-' + 'a'.repeat(160) + '.txt'
    await chooseFile(longFileName, 'preview content', 'text/plain')
    await click(`.${operation}-submit-button`)
    await click('.confirm-modal .primary-button')
    await waitFor(`document.querySelector('.${operation}-result-modal')`)
    await click(`.${operation}-result-modal .modal-actions .primary-button`)
    await waitFor(`document.querySelector('.${operation}-toast.is-success')`)
    await viewport(320, 640)
    const longNotice = await evaluate(`(() => {
      const toast=document.querySelector('.${operation}-toast'); const text=toast.querySelector('span');
      const box=toast.getBoundingClientRect(); const textBox=text.getBoundingClientRect();
      return {message:text.textContent,inside:textBox.right<=box.right && text.scrollWidth<=text.clientWidth};
    })()`)
    check('long source filenames wrap within the mobile notification', () => {
      assert.ok(longNotice.message.includes(longFileName)); assert.equal(longNotice.inside, true)
    })
    await screenshot(`${operation}-long-name-notice-mobile`)
    const pageErrors = await evaluate('window.__uploadTestErrors')
    check('file operation has no uncaught JavaScript exceptions', () =>
      assert.deepEqual(pageErrors, []),
    )
  } catch (error) {
    await screenshot(`${operation}-failure`)
    console.error(await evaluate('document.querySelector("main")?.textContent'))
    throw error
  } finally {
    socket.close()
  }
}

async function run() {
  const operations = [['upload', '上傳', 'DT01'], ['transfer', '轉送', 'EXD1']]
  for (const args of operations) await main(...args)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
