import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const origin = process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:8787'
const executablePath = process.env.SMOKE_BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const outputDir = process.env.SMOKE_OUTPUT_DIR ?? tmpdir()
const database = process.env.SMOKE_D1_DATABASE ?? 'mind-game-production'
const wranglerBin = resolve('node_modules/wrangler/bin/wrangler.js')
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

try {
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.locator('.mode-actions button').nth(1).click()
  await page.getByRole('checkbox').check()
  await page.locator('.research-actions button').last().click()
  await page.locator('input[name="studentId"]').fill(`STAGE6-BROWSER-${crypto.randomUUID().slice(0, 8)}`)
  await page.locator('form button[type="submit"]').click()
  await page.locator('.research-actions button').last().click()

  const preTaskSliders = page.locator('.scale-question input[type="range"]')
  await preTaskSliders.first().waitFor()
  for (const slider of await preTaskSliders.all()) {
    await slider.focus()
    await slider.press('ArrowRight')
  }
  const touchedCount = await page.locator('.scale-question input[data-touched="true"]').count()
  assert(touchedCount === 5,
    `pre-task sliders were not all actively answered (sliders=${await preTaskSliders.count()}, touched=${touchedCount}, text=${(await page.locator('body').innerText()).slice(0, 200)})`)
  await page.locator('.research-actions button').last().click()
  await page.getByTestId('formal-t1-game').waitFor()

  const candidateCount = await page.locator('.candidate-card').count()
  assert(candidateCount === 5, `expected five candidates, got ${candidateCount}`)
  for (let index = 0; index < candidateCount; index += 1) {
    await page.locator('.candidate-card').nth(index).click()
    await page.locator('.candidate-detail input[aria-label^="T1"]').fill(String(50 + index))
    await page.locator('.candidate-detail .rating-panel button').click()
  }

  await page.locator('.decision-card').first().click()
  const t1Confidence = page.getByTestId('t1-confidence')
  await t1Confidence.focus()
  await t1Confidence.press('ArrowRight')
  await page.getByTestId('submit-t1-stage-choice').click()
  await page.getByTestId('formal-investigation-game').waitFor()

  await page.locator('.formal-evidence-panel button').filter({ hasText: /1/ }).first().click()
  await page.getByTestId('formal-shallow-evidence').waitFor()
  await page.locator('input[aria-label^="T2"]').fill('61')
  await page.locator('[data-testid^="formal-rating-T2"] button').click()
  await page.locator('.decision-card').first().click()
  const t2Confidence = page.getByTestId('t2-confidence')
  await t2Confidence.focus()
  await t2Confidence.press('ArrowRight')
  await page.getByTestId('submit-t2-stage-choice').click()

  await page.getByTestId('formal-investigation-game').waitFor()
  await page.locator('.formal-evidence-panel button').filter({ hasText: /3/ }).first().click()
  await page.getByTestId('formal-deep-evidence').waitFor()
  await page.locator('input[aria-label^="T3"]').fill('66')
  await page.locator('[data-testid^="formal-rating-T3"] button').click()
  await page.locator('.decision-card').first().click()
  const t3Confidence = page.getByTestId('t3-confidence')
  await t3Confidence.focus()
  await t3Confidence.press('ArrowRight')
  await page.getByTestId('submit-t3-stage-choice').click()

  await page.getByTestId('formal-final-decision').waitFor()
  const finalCards = page.locator('.formal-final-panel .decision-card')
  assert(await finalCards.count() === 5, 'formal final must show five public candidates')
  assert(await page.locator('.formal-final-panel .decision-card--selected').count() === 0,
    'formal final must not preselect a candidate')
  await finalCards.first().click()
  const finalConfidence = page.locator('.formal-final-confidence input[type="range"]')
  await finalConfidence.click({ position: { x: 1, y: 5 } })
  await page.waitForTimeout(50)
  const finalSubmitEnabled = await page.getByTestId('submit-formal-final').isEnabled()
  assert(finalSubmitEnabled,
    `explicit confidence 0 must be valid (selected=${await finalCards.first().getAttribute('aria-pressed')}, confidence=${await finalConfidence.inputValue()}, disabled=${await page.getByTestId('submit-formal-final').isDisabled()})`)

  const finalPath = join(outputDir, 'mind-game-stage6-final.png')
  await page.screenshot({ path: finalPath, fullPage: true })
  await page.getByTestId('submit-formal-final').click()
  await page.getByTestId('formal-post-task-pause').waitFor()

  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }))
  const localSerialized = JSON.stringify(storage.local)
  assert(!/[A-E]-t[23]-|pointsRemaining|ratingValue|finalConfidence/.test(localSerialized),
    'formal game answers leaked into localStorage')
  assert(Object.values(storage.session).every((value) => /^[0-9a-f-]{36}$/i.test(String(value))),
    'sessionStorage contains more than pending operation UUIDs')

  await page.setViewportSize({ width: 390, height: 844 })
  const pausePath = join(outputDir, 'mind-game-stage6-post-task-mobile.png')
  await page.screenshot({ path: pausePath, fullPage: true })

  const quickPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  let formalCreateCalls = 0
  quickPage.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/sessions')) formalCreateCalls += 1
  })
  await quickPage.goto(origin, { waitUntil: 'networkidle' })
  await quickPage.locator('.mode-actions button').first().click()
  await quickPage.waitForTimeout(300)
  assert(formalCreateCalls === 0, 'quick mode called the formal session API')
  await quickPage.close()

  console.log(JSON.stringify({
    ok: true,
    formalFinalCandidateCount: 5,
    explicitZeroConfidenceAccepted: true,
    postTaskPauseVisible: true,
    quickFormalSessionCalls: formalCreateCalls,
    browserStorageSafe: true,
    screenshots: [finalPath, pausePath],
  }, null, 2))
} finally {
  await browser.close()
  execFileSync(process.execPath, [
    wranglerBin, 'd1', 'execute', database, '--local', '--command',
    `DELETE FROM participants WHERE participant_id IN (
      SELECT participant_id FROM participant_identity
      WHERE student_id_normalized LIKE 'STAGE6-BROWSER-%'
    );`,
  ], { cwd: process.cwd(), stdio: 'ignore' })
}
