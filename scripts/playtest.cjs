const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')

const outputDir = path.join(process.cwd(), 'playtest-artifacts')
fs.mkdirSync(outputDir, { recursive: true })

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text())
  })
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message))

  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '压力择才' }).waitFor()
  await page.screenshot({
    path: path.join(outputDir, '01-start-desktop.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: /快速测试/ }).click()
  await page.getByText('候选终端').waitFor()

  const candidateCards = page.locator('.candidate-card')
  for (let index = 0; index < 5; index += 1) {
    await candidateCards.nth(index).click()
    await page.getByRole('button', { name: /提交并封存 T1/ }).click()
  }

  await candidateCards.nth(0).click()
  await page.getByRole('button', { name: /浅度查证/ }).click()
  await page.getByRole('button', { name: /深度查证/ }).click()
  await page.getByText(/你还要继续投入/).waitFor()
  const resourceText = await page.locator('.timer-bar__resource strong').textContent()
  if (!resourceText || !resourceText.includes('1 / 5')) {
    throw new Error('Expected one remaining verification point, got ' + resourceText)
  }
  await page.screenshot({
    path: path.join(outputDir, '02-evidence-warning.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: /推进到最后 1 分钟/ }).click()
  await page.getByRole('heading', { name: '资源投入正在影响判断' }).waitFor()
  await page.screenshot({
    path: path.join(outputDir, '03-sunk-cost.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: /立即止损/ }).click()
  await page.getByRole('button', { name: '进入最终决策' }).click()
  await page.locator('.decision-card').nth(2).click()
  await page.getByRole('heading', { name: '抗压决策报告' }).waitFor()
  await page.getByText('周予安').first().waitFor()
  await page.screenshot({
    path: path.join(outputDir, '04-report.png'),
    fullPage: true,
  })

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mobile.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' })
  await mobile.screenshot({
    path: path.join(outputDir, '05-start-mobile.png'),
    fullPage: true,
  })
  await mobile.close()
  await browser.close()

  if (errors.length) {
    throw new Error(errors.join('\n'))
  }

  console.log(
    JSON.stringify(
      {
        flow: 'start -> T1 x5 -> toxic shallow/deep -> HR warning -> sunk cost -> final C -> report',
        screenshots: 5,
        consoleErrors: 0,
      },
      null,
      2,
    ),
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
