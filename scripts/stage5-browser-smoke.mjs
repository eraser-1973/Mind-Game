import { chromium } from 'playwright-core'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const origin = process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:8787'
const executablePath = process.env.SMOKE_BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const outputDir = process.env.SMOKE_OUTPUT_DIR ?? tmpdir()
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })

try {
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /正式测评/ }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '开始任务' }).click()
  await page.locator('input[name="fullName"]').fill(`Stage5 Synthetic Browser ${crypto.randomUUID().slice(0, 8)}`)
  await page.getByRole('button', { name: '提交并继续' }).click()
  await page.getByRole('heading', { name: '基本信息登记（匿名）' }).waitFor()
  await page.getByRole('button', { name: '继续' }).click()
  await page.getByRole('heading', { name: '当前状态评估' }).waitFor()

  for (const slider of await page.locator('.scale-question input[type="range"]').all()) {
    await slider.click({ position: { x: 40, y: 5 } })
  }
  if (await page.locator('.scale-question input[data-touched="true"]').count() !== 5) {
    throw new Error('pre-task sliders were not all actively answered')
  }
  await page.getByRole('button', { name: '进入招聘决策任务' }).click()
  await page.getByTestId('formal-t1-game').waitFor()

  const candidateCount = await page.locator('.candidate-card').count()
  if (candidateCount !== 5) throw new Error(`expected five candidates, got ${candidateCount}`)
  for (let index = 0; index < candidateCount; index += 1) {
    await page.locator('.candidate-card').nth(index).click()
    const slider = page.locator('.candidate-detail input[aria-label^="T1"]')
    await slider.fill(String(50 + index))
    await page.getByRole('button', { name: '提交并封存 T1' }).click()
    if (index < candidateCount - 1) {
      await page.getByText(/服务器已封存/).waitFor()
    } else {
      await page.getByTestId('formal-t1-stage-choice').waitFor()
    }
  }

  await page.getByTestId('formal-t1-stage-choice').waitFor()
  await page.locator('.decision-card').first().click()
  await page.getByTestId('t1-confidence').focus()
  await page.getByTestId('t1-confidence').press('ArrowRight')
  await page.getByTestId('submit-t1-stage-choice').click()
  await page.getByTestId('formal-investigation-game').waitFor()

  const shallowPath = join(outputDir, 'mind-game-stage5-shallow.png')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: shallowPath, fullPage: true })
  await page.getByRole('button', { name: /浅度查证/ }).click()
  await page.getByTestId('formal-shallow-evidence').waitFor()
  const t2Slider = page.locator('input[aria-label^="T2"]')
  await t2Slider.fill('61')
  await page.getByRole('button', { name: '提交并封存 T2' }).click()
  await page.getByTestId('formal-t2-stage-choice').waitFor()
  await page.locator('.decision-card').first().click()
  await page.getByTestId('t2-confidence').focus()
  await page.getByTestId('t2-confidence').press('ArrowRight')
  await page.getByTestId('submit-t2-stage-choice').click()

  await page.getByTestId('formal-investigation-game').waitFor()
  const deepReadyPath = join(outputDir, 'mind-game-stage5-deep-ready.png')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: deepReadyPath, fullPage: true })
  await page.getByRole('button', { name: /深度查证/ }).click()
  await page.getByTestId('formal-deep-evidence').waitFor()
  const t3Slider = page.locator('input[aria-label^="T3"]')
  await t3Slider.fill('48')
  await page.getByRole('button', { name: '提交并封存 T3' }).click()
  await page.getByTestId('formal-t3-stage-choice').waitFor()
  await page.locator('.decision-card').first().click()
  await page.getByTestId('t3-confidence').focus()
  await page.getByTestId('t3-confidence').press('ArrowRight')
  await page.getByTestId('submit-t3-stage-choice').click()
  await page.getByTestId('formal-t3-complete').waitFor()

  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }))
  const localSerialized = JSON.stringify(storage.local)
  const sessionValues = Object.values(storage.session)
  if (/[A-E]-t[23]-|pointsRemaining|ratingValue/.test(localSerialized)) {
    throw new Error('formal evidence, points, or ratings leaked into localStorage')
  }
  if (!sessionValues.every((value) => /^[0-9a-f-]{36}$/i.test(String(value)))) {
    throw new Error('sessionStorage contains more than pending operation UUIDs')
  }

  await page.setViewportSize({ width: 390, height: 844 })
  const completePath = join(outputDir, 'mind-game-stage5-complete-mobile.png')
  await page.screenshot({ path: completePath, fullPage: true })
  console.log(JSON.stringify({
    ok: true,
    candidateCount,
    stage5Complete: true,
    browserStorageSafe: true,
    screenshots: [shallowPath, deepReadyPath, completePath],
  }, null, 2))
} finally {
  await browser.close()
}
