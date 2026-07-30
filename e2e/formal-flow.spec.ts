import { expect, test, type Page } from '@playwright/test'

type MockBackend = {
  online: boolean
  created: number
  resumed: number
  events: Map<string, Record<string, unknown>>
  snapshots: Map<string, Record<string, unknown>>
  errors: Map<string, Record<string, unknown>>
  completions: Record<string, unknown>[]
  heartbeatCount: number
}

const sessionId = 'sess-e2e-formal-0001'
const recoveryToken = 'e2e-recovery-token'

const installMockBackend = async (page: Page): Promise<MockBackend> => {
  const backend: MockBackend = {
    online: true,
    created: 0,
    resumed: 0,
    events: new Map(),
    snapshots: new Map(),
    errors: new Map(),
    completions: [],
    heartbeatCount: 0,
  }
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    if (!backend.online) return route.abort('internetdisconnected')
    const request = route.request()
    const url = new URL(request.url())
    const body = request.postDataJSON?.() as Record<string, unknown> | null
    let data: Record<string, unknown> = {}

    if (url.pathname === '/api/sessions' && request.method() === 'POST') {
      backend.created += 1
      data = { sessionId, recoveryToken, participantId: body?.participantId, status: 'in_progress', serverTime: new Date().toISOString() }
    } else if (url.pathname.endsWith('/resume')) {
      backend.resumed += 1
      data = { sessionId, status: 'in_progress', serverTime: new Date().toISOString() }
    } else if (url.pathname.endsWith('/events')) {
      const events = (body?.events ?? []) as Record<string, unknown>[]
      for (const event of events) backend.events.set(String(event.eventId), event)
      data = { accepted: events.length, inserted: events.length }
    } else if (url.pathname.endsWith('/snapshots')) {
      const snapshots = (body?.snapshots ?? []) as Record<string, unknown>[]
      for (const snapshot of snapshots) backend.snapshots.set(String(snapshot.snapshotId), snapshot)
      data = { accepted: snapshots.length }
    } else if (url.pathname.endsWith('/heartbeat')) {
      backend.heartbeatCount += 1
      data = { lastHeartbeatAt: new Date().toISOString() }
    } else if (url.pathname.endsWith('/complete')) {
      backend.completions.push(body ?? {})
      data = { status: 'completed', completedAt: new Date().toISOString() }
    } else if (url.pathname.endsWith('/abandon')) {
      data = { status: 'abandoned' }
    } else if (url.pathname === '/api/client-errors') {
      backend.errors.set(String(body?.errorId), body ?? {})
      data = { accepted: true }
    } else {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'mock route missing' } }) })
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
  return backend
}

const setAllRanges = async (page: Page, root = 'main') => {
  const ranges = page.locator(`${root} input[type="range"]`)
  for (let index = 0; index < await ranges.count(); index += 1) {
    const range = ranges.nth(index)
    const min = Number(await range.getAttribute('min') ?? 0)
    const max = Number(await range.getAttribute('max') ?? 10)
    await range.fill(String(Math.round((min + max) / 2)))
  }
}

const enterFormalGame = async (page: Page) => {
  await page.goto('/')
  await page.getByRole('button', { name: /正式测评/ }).click()
  await page.getByLabel('我已阅读并理解上述说明，并自愿参与本研究。').check()
  await page.getByRole('button', { name: '开始任务' }).click()
  await expect(page.getByRole('heading', { name: '基本信息登记（匿名）' })).toBeVisible()
  await page.getByRole('button', { name: '继续' }).click()
  await expect(page.getByRole('heading', { name: '当前状态评估' })).toBeVisible()
  await setAllRanges(page)
  await page.getByRole('button', { name: '进入招聘决策任务' }).click()
  await expect(page.getByText('正式测评 / FORMAL')).toBeVisible()
}

const rateAllT1 = async (page: Page) => {
  for (const id of ['A', 'B', 'C', 'D', 'E']) {
    await page.getByRole('button', { name: new RegExp(`候选人 ${id}`) }).first().click()
    await page.getByLabel('T1 评分').fill(String(50 + id.charCodeAt(0) - 65))
    await page.getByRole('button', { name: '提交并封存 T1' }).click()
  }
  await expect(page.getByRole('heading', { name: '记录当前首选与决策信心' })).toBeVisible()
  await page.locator('.decision-modal .decision-card').first().click()
  await page.getByLabel('T1 决策信心').fill('72')
  await page.getByRole('button', { name: '提交阶段判断' }).click()
}

const rateAllQuickT1 = async (page: Page) => {
  await page.goto('/')
  await page.getByRole('button', { name: /快速测试/ }).click()
  for (const id of ['A', 'B', 'C', 'D', 'E']) {
    await page.getByRole('button', { name: new RegExp(`候选人 ${id}`) }).first().click()
    await page.getByLabel('T1 评分').fill(String(50 + id.charCodeAt(0) - 65))
    await page.getByRole('button', { name: '提交并封存 T1' }).click()
  }
  await expect(page.getByRole('heading', { name: '记录当前首选与决策信心' })).toBeVisible()
}

const selectCandidate = async (page: Page, id: 'A' | 'B' | 'C' | 'D' | 'E') => {
  await page.getByRole('button', { name: new RegExp(`候选人 ${id}`) }).first().click()
}

const openFinalDecision = async (page: Page) => {
  await page.getByRole('button', { name: '进入最终决策' }).click()
  const snapshotHeading = page.getByRole('heading', { name: '记录当前首选与决策信心' })
  if (await snapshotHeading.isVisible().catch(() => false)) {
    await page.locator('.decision-modal .decision-card').first().click()
    const stage = await page.locator('.decision-modal .eyebrow').textContent()
    await page.getByLabel(stage?.includes('T3') ? 'T3 决策信心' : 'T2 决策信心').fill('70')
    await page.getByRole('button', { name: '提交阶段判断' }).click()
  }
  await expect(page.getByRole('heading', { name: /锁定最终录用者|时间到：提交最终人选/ })).toBeVisible()
}

const submitFinal = async (page: Page, id: 'A' | 'B' | 'C' | 'D' | 'E' = 'B') => {
  await openFinalDecision(page)
  await page.locator('.decision-modal').getByRole('button', { name: new RegExp(`候选人 ${id}`) }).click()
  await page.getByLabel('最终决策信心').fill('84')
  await page.getByRole('button', { name: /提交最终录用|确认超时决策/ }).click()
  await expect(page.getByRole('heading', { name: '任务后状态评估' })).toBeVisible()
}

const finishQuestionnaires = async (page: Page) => {
  await setAllRanges(page)
  await page.getByRole('button', { name: '继续' }).click()
  await expect(page.getByRole('heading', { name: '任务体验与压力操纵检验' })).toBeVisible()
  await setAllRanges(page)
  await page.getByRole('button', { name: '生成抗压决策报告' }).click()
  await expect(page.getByRole('heading', { name: '抗压决策报告' })).toBeVisible()
}

const readSnapshot = async (page: Page) => page.evaluate(async () => {
  const pointer = JSON.parse(localStorage.getItem('mind-game:formal:recovery:v1') ?? 'null') as { sessionId: string } | null
  if (!pointer) return null
  return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
    const open = indexedDB.open('mind-game-formal-v1', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const request = open.result.transaction('snapshots', 'readonly').objectStore('snapshots').get(pointer.sessionId)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result ?? null)
    }
  })
})

test.beforeEach(async ({ page }) => {
  await installMockBackend(page)
})

test('formal mode completes consent through the confirmed report', async ({ page }) => {
  const backend = await installMockBackend(page)
  await enterFormalGame(page)
  await rateAllT1(page)
  await submitFinal(page)
  await finishQuestionnaires(page)
  expect(backend.created).toBe(1)
  expect(backend.completions).toHaveLength(1)
  expect(backend.completions[0]).toMatchObject({ finalCandidateId: 'B', finalConfidence: 84, submissionType: 'manual' })
})

test('unanswered post-task items block report progression', async ({ page }) => {
  await enterFormalGame(page); await rateAllT1(page); await submitFinal(page)
  await page.getByRole('button', { name: '继续' }).click()
  await expect(page.getByRole('alert')).toContainText('请完成所有题目后再继续')
})

test('partially answered post-task items remain unanswered instead of using defaults', async ({ page }) => {
  await enterFormalGame(page); await rateAllT1(page); await submitFinal(page)
  await page.locator('input[type="range"]').first().fill('7')
  await page.getByRole('button', { name: '继续' }).click()
  await expect(page.getByText('未作答')).toHaveCount(0)
  await expect(page.locator('.scale-question__head strong', { hasText: /^0$/ })).toHaveCount(4)
  const snapshot = await readSnapshot(page)
  expect((snapshot?.researchData as { postTask: unknown }).postTask).toBeNull()
})

test('quick T1 snapshot appears once and tracks the selected candidate accessibly', async ({ page }) => {
  await rateAllQuickT1(page)

  const submit = page.getByRole('button', { name: '提交阶段判断' })
  await expect(page.locator('.decision-modal output')).toHaveText('0')
  await expect(page.getByText('未作答')).toHaveCount(0)
  await expect(submit).toBeDisabled()

  const candidateB = page.getByRole('button', { name: /选择候选人 B/ })
  const candidateD = page.getByRole('button', { name: /选择候选人 D/ })
  await candidateB.click()
  await expect(candidateB).toHaveAttribute('aria-pressed', 'true')
  await expect(candidateB).toHaveClass(/is-selected/)
  await candidateD.click()
  await expect(candidateD).toHaveAttribute('aria-pressed', 'true')
  await expect(candidateD).toHaveClass(/is-selected/)
  await expect(candidateB).toHaveAttribute('aria-pressed', 'false')
  await expect(candidateB).not.toHaveClass(/is-selected/)

  await page.getByLabel('T1 决策信心').fill('68')
  await submit.click()
  await expect(page.getByRole('heading', { name: '记录当前首选与决策信心' })).toHaveCount(0)

  await selectCandidate(page, 'A')
  await selectCandidate(page, 'C')
  await page.getByRole('button', { name: '进入最终决策' }).click()
  await expect(page.getByText('T1 DECISION SNAPSHOT')).toHaveCount(0)
})

test('final decision selection highlight switches and clears consistently after returning', async ({ page }) => {
  await rateAllQuickT1(page)
  await page.getByRole('button', { name: /选择候选人 B/ }).click()
  await page.getByLabel('T1 决策信心').fill('65')
  await page.getByRole('button', { name: '提交阶段判断' }).click()
  await page.getByRole('button', { name: '进入最终决策' }).click()

  const submit = page.getByRole('button', { name: '提交最终录用' })
  await expect(submit).toBeDisabled()
  const candidateC = page.getByRole('button', { name: /选择候选人 C/ })
  const candidateA = page.getByRole('button', { name: /选择候选人 A/ })
  await candidateC.click()
  await expect(candidateC).toHaveAttribute('aria-pressed', 'true')
  await expect(candidateC).toHaveClass(/is-selected/)
  await candidateA.click()
  await expect(candidateA).toHaveAttribute('aria-pressed', 'true')
  await expect(candidateA).toHaveClass(/is-selected/)
  await expect(candidateC).toHaveAttribute('aria-pressed', 'false')

  const selectedBox = await candidateA.boundingBox()
  const viewport = page.viewportSize()
  expect(selectedBox).not.toBeNull()
  expect(selectedBox!.x).toBeGreaterThanOrEqual(0)
  expect(selectedBox!.x + selectedBox!.width).toBeLessThanOrEqual(viewport!.width)

  await page.getByRole('button', { name: '返回继续查证' }).click()
  await page.getByRole('button', { name: '进入最终决策' }).click()
  await expect(page.locator('.decision-modal .decision-card[aria-pressed="true"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '提交最终录用' })).toBeDisabled()
})

test('decision selection remains visible and unclipped on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await rateAllQuickT1(page)

  const stageCandidate = page.getByRole('button', { name: /选择候选人 D/ })
  await stageCandidate.click()
  const stageCardBox = await stageCandidate.boundingBox()
  const stageMarkBox = await stageCandidate.locator('.decision-card__selection').boundingBox()
  expect(stageCardBox).not.toBeNull()
  expect(stageMarkBox).not.toBeNull()
  expect(stageCardBox!.x).toBeGreaterThanOrEqual(0)
  expect(stageCardBox!.x + stageCardBox!.width).toBeLessThanOrEqual(390)
  expect(stageMarkBox!.x + stageMarkBox!.width).toBeLessThanOrEqual(
    stageCardBox!.x + stageCardBox!.width,
  )

  await page.getByLabel('T1 决策信心').fill('60')
  await page.getByRole('button', { name: '提交阶段判断' }).click()
  await page.getByRole('button', { name: '进入最终决策' }).click()
  await page.getByRole('button', { name: /选择候选人 A/ }).click()

  const submit = page.getByRole('button', { name: '提交最终录用' })
  const back = page.getByRole('button', { name: '返回继续查证' })
  await submit.scrollIntoViewIfNeeded()
  await back.scrollIntoViewIfNeeded()
  const submitBox = await submit.boundingBox()
  const backBox = await back.boundingBox()
  expect(submitBox).not.toBeNull()
  expect(backBox).not.toBeNull()
  const overlaps = !(
    submitBox!.x + submitBox!.width <= backBox!.x ||
    backBox!.x + backBox!.width <= submitBox!.x ||
    submitBox!.y + submitBox!.height <= backBox!.y ||
    backBox!.y + backBox!.height <= submitBox!.y
  )
  expect(overlaps).toBe(false)
})

test('unanswered manipulation-check items cannot generate a report', async ({ page }) => {
  await enterFormalGame(page); await rateAllT1(page); await submitFinal(page)
  await setAllRanges(page); await page.getByRole('button', { name: '继续' }).click()
  await page.getByRole('button', { name: '生成抗压决策报告' }).click()
  await expect(page.getByRole('alert')).toContainText('请完成所有题目后再生成报告')
})

test('double-clicking shallow verification spends exactly one point', async ({ page }) => {
  await enterFormalGame(page); await rateAllT1(page); await selectCandidate(page, 'A')
  await page.getByRole('button', { name: /浅度查证/ }).dblclick()
  await expect(page.getByText('4 / 5')).toBeVisible()
  const snapshot = await readSnapshot(page)
  expect((snapshot?.gameState as { evidenceEvents: unknown[] }).evidenceEvents).toHaveLength(1)
})

for (const id of ['A', 'C'] as const) {
  test(`${id} risk evidence tracks additional points after actual viewing`, async ({ page }) => {
    await enterFormalGame(page); await rateAllT1(page); await selectCandidate(page, id)
    await page.getByRole('button', { name: /浅度查证/ }).click()
    await page.getByRole('button', { name: /深度查证/ }).click()
    await expect(page.getByText('1 / 5')).toBeVisible()
    const snapshot = await readSnapshot(page)
    const events = (snapshot?.gameState as { evidenceEvents: Array<Record<string, unknown>> }).evidenceEvents.filter((event) => event.candidateId === id)
    expect(events.at(-1)).toMatchObject({ addedAfterRiskEvidence: true, additionalPointsThisEvent: 3, cumulativeAdditionalPointsAfterRisk: 3 })
    expect(events.at(-1)?.riskEvidenceIdsPreviouslySeen).toEqual(expect.arrayContaining([`${id}-t2-1`, `${id}-t2-2`]))
  })
}

test('refresh restores ratings, evidence, points and session id', async ({ page }) => {
  await enterFormalGame(page); await rateAllT1(page); await selectCandidate(page, 'A')
  await page.getByRole('button', { name: /浅度查证/ }).click()
  await expect(page.getByText('4 / 5')).toBeVisible()
  const before = await page.evaluate(() => localStorage.getItem('mind-game:formal:recovery:v1'))
  await page.reload()
  await expect(page.getByText('5/5 初评')).toBeVisible()
  await expect(page.getByText('4 / 5')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('mind-game:formal:recovery:v1'))).toBe(before)
})

test('offline events upload once after the online signal', async ({ page }) => {
  const backend = await installMockBackend(page)
  await enterFormalGame(page); await rateAllT1(page); await selectCandidate(page, 'A')
  backend.online = false
  await page.getByRole('button', { name: /浅度查证/ }).click()
  await expect(page.getByText('4 / 5')).toBeVisible()
  backend.online = true
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => [...backend.events.values()].filter((event) => event.eventType === 'verify').length).toBe(1)
  const ids = [...backend.events.keys()]
  expect(new Set(ids).size).toBe(ids.length)
})

test('manual submission is recorded as manual', async ({ page }) => {
  await enterFormalGame(page); await rateAllT1(page); await submitFinal(page)
  const snapshot = await readSnapshot(page)
  expect((snapshot?.gameState as { finalDecision: Record<string, unknown> }).finalDecision.submissionType).toBe('manual')
})

test('timeout requires confirmation and records timeout_confirmed', async ({ page }) => {
  await page.clock.install()
  await enterFormalGame(page)
  await page.clock.runFor(15 * 60 * 1_000)
  await expect(page.getByRole('heading', { name: '时间到：提交最终人选' })).toBeVisible()
  await page.locator('.decision-modal .decision-card').first().click()
  await page.getByLabel('最终决策信心').fill('55')
  await page.getByRole('button', { name: '确认超时决策' }).click()
  const snapshot = await readSnapshot(page)
  expect((snapshot?.gameState as { finalDecision: Record<string, unknown> }).finalDecision.submissionType).toBe('timeout_confirmed')
})

test('timeout never auto-selects the first candidate', async ({ page }) => {
  await page.clock.install()
  await enterFormalGame(page)
  await page.clock.runFor(15 * 60 * 1_000)
  await expect(page.getByRole('heading', { name: '时间到：提交最终人选' })).toBeVisible()
  const snapshot = await readSnapshot(page)
  expect((snapshot?.gameState as { finalDecision: unknown }).finalDecision).toBeNull()
})

test('formal mode contains no evaluative Niko feedback', async ({ page }) => {
  await enterFormalGame(page); await rateAllT1(page); await selectCandidate(page, 'A')
  await page.getByRole('button', { name: /浅度查证/ }).click()
  await page.getByLabel('T2 评分').fill('20')
  await page.waitForTimeout(700)
  await expect(page.getByText('Niko 对话')).toHaveCount(0)
  await expect(page.locator('img[src*="niko-happy"], img[src*="niko-angry"]')).toHaveCount(0)
})

test('formal evidence cards use one neutral visual class', async ({ page }) => {
  await enterFormalGame(page); await rateAllT1(page); await selectCandidate(page, 'A')
  await page.getByRole('button', { name: /浅度查证/ }).click()
  await expect(page.locator('.evidence-card')).toHaveCount(2)
  await expect(page.locator('.evidence-card.is-negative, .evidence-card.is-positive')).toHaveCount(0)
})

test('quick mode never creates a formal API session', async ({ page }) => {
  const backend = await installMockBackend(page)
  await page.goto('/')
  await page.getByRole('button', { name: /快速测试/ }).click()
  await expect(page.getByText('QUICK TEST')).toBeVisible()
  expect(backend.created).toBe(0)
})

test('JavaScript errors are uploaded and mark the local session invalid', async ({ page }) => {
  const backend = await installMockBackend(page)
  await enterFormalGame(page)
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'e2e boom', error: new Error('e2e boom') })))
  await expect.poll(() => backend.errors.size).toBe(1)
  const snapshot = await readSnapshot(page)
  expect((snapshot?.gameState as { invalidForAssessment: boolean }).invalidForAssessment).toBe(true)
})

test('a technical-error session reports technical invalidity, never fragile resilience', async ({ page }) => {
  await enterFormalGame(page)
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'assessment interrupted', error: new Error('assessment interrupted') })))
  await rateAllT1(page); await submitFinal(page); await finishQuestionnaires(page)
  await expect(page.getByRole('heading', { name: '本次结果不作为有效测评数据' })).toBeVisible()
  await expect(page.getByText('脆弱型', { exact: true })).toHaveCount(0)
})

test('formal report does not depend on a JSON export button', async ({ page }) => {
  await enterFormalGame(page); await rateAllT1(page); await submitFinal(page); await finishQuestionnaires(page)
  await expect(page.getByRole('button', { name: '导出 JSON 数据' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新开始' })).toBeVisible()
})
