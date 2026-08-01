import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const origin = process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:8787'
const database = process.env.SMOKE_D1_DATABASE ?? 'mind-game-production'
const wranglerBin = resolve('node_modules/wrangler/bin/wrangler.js')
const participants = []

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const now = () => new Date().toISOString()

async function request(path, { body, cookie = '', key, method = 'POST' } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (key) headers['Idempotency-Key'] = key
  if (cookie) headers.Cookie = cookie
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  return { response, payload }
}

async function post(session, path, body, key = crypto.randomUUID()) {
  return request(path, { body, cookie: session?.cookie, key })
}

function localSql(command) {
  return execFileSync(process.execPath, [
    wranglerBin, 'd1', 'execute', database, '--local', '--command', command,
  ], { cwd: process.cwd(), encoding: 'utf8' })
}

function setRemaining(sessionId, remainingSec) {
  const deadline = new Date(Date.now() + remainingSec * 1000).toISOString()
  const started = new Date(Date.parse(deadline) - 900_000).toISOString()
  localSql(`UPDATE sessions SET started_at='${started}',deadline_at='${deadline}' WHERE session_id='${sessionId}';
    UPDATE game_runs SET started_at='${started}',deadline_at='${deadline}' WHERE session_id='${sessionId}';`)
}

async function createReadySession(label) {
  const created = await request('/api/sessions', {
    key: crypto.randomUUID(),
    body: {
      mode: 'formal',
      identity: { studentId: `STAGE6-SMOKE-${label}-${crypto.randomUUID().slice(0, 8)}` },
      clientVersion: 'stage-6-local-smoke',
    },
  })
  assert(created.response.status === 201, `create ${label}: ${JSON.stringify(created.payload)}`)
  const session = {
    label,
    sessionId: created.payload.data.sessionId,
    participantId: created.payload.data.participantId,
    cookie: (created.response.headers.get('set-cookie') ?? '').split(';')[0],
    order: [],
  }
  participants.push(session.participantId)
  assert(session.cookie.startsWith('mg_session='), `cookie ${label}`)

  const consent = await post(session, '/api/consent', {
    sessionId: session.sessionId,
    accepted: true,
    consentVersion: 'consent-1.0.0',
    clientAcceptedAt: now(),
  })
  assert(consent.response.status === 201, `consent ${label}`)

  const demographics = await post(session, '/api/demographics', {
    sessionId: session.sessionId,
    demographics: {
      ageRange: '21–23',
      gender: '不愿透露',
      education: '本科',
      grade: '大三',
      majorCategory: '计算机或人工智能',
      relatedExperience: ['数据分析相关经历'],
    },
    clientSubmittedAt: now(),
  })
  assert(demographics.response.status === 201, `demographics ${label}: ${JSON.stringify(demographics.payload)}`)

  const itemIds = ['stress', 'fatigue', 'attention', 'mood', 'physicalDiscomfort']
  const questionnaire = await post(session, '/api/questionnaires', {
    sessionId: session.sessionId,
    phase: 'pre',
    instrumentVersion: 'state-assessment-pre-1.0.0',
    clientStartedAt: now(),
    clientSubmittedAt: now(),
    answers: itemIds.map((itemId, index) => ({
      itemId,
      value: index,
      touched: true,
      answeredAt: now(),
    })),
  })
  assert(questionnaire.response.status === 201, `questionnaire ${label}`)

  const started = await post(session, `/api/sessions/${session.sessionId}/start`, {
    sessionId: session.sessionId,
    clientStartedAt: now(),
    clientVersion: 'stage-6-local-smoke',
  })
  assert(started.response.status === 201, `start ${label}: ${JSON.stringify(started.payload)}`)
  session.order = started.payload.data.candidateDisplayOrder

  for (const [index, candidateId] of session.order.entries()) {
    const rating = await post(session, '/api/ratings', {
      sessionId: session.sessionId,
      candidateId,
      stage: 'T1',
      ratingValue: 50 + index,
      clientSubmittedAt: now(),
    })
    assert(rating.response.status === 201, `T1 ${label}/${candidateId}`)
  }
  const choice = await post(session, '/api/stage-choices', {
    sessionId: session.sessionId,
    stage: 'T1',
    candidateId: session.order[0],
    confidence: 60,
    clientSubmittedAt: now(),
  })
  assert(choice.response.status === 201, `T1 choice ${label}`)
  return session
}

async function unlock(session, candidateId, level) {
  return post(session, '/api/evidence/unlock', {
    sessionId: session.sessionId,
    candidateId,
    level,
    clientAt: now(),
  })
}

async function rate(session, candidateId, stage, ratingValue) {
  return post(session, '/api/ratings', {
    sessionId: session.sessionId,
    candidateId,
    stage,
    ratingValue,
    clientSubmittedAt: now(),
  })
}

async function choose(session, stage, candidateId, confidence) {
  return post(session, '/api/stage-choices', {
    sessionId: session.sessionId,
    stage,
    candidateId,
    confidence,
    clientSubmittedAt: now(),
  })
}

async function shallowT2(session, candidateId = 'B') {
  assert((await unlock(session, candidateId, 'shallow')).response.status === 201, `${session.label} shallow`)
  assert((await rate(session, candidateId, 'T2', 62)).response.status === 201, `${session.label} T2 rating`)
  assert((await choose(session, 'T2', candidateId, 64)).response.status === 201, `${session.label} T2 choice`)
}

async function deepT3(session, candidateId = 'B') {
  await shallowT2(session, candidateId)
  assert((await unlock(session, candidateId, 'deep')).response.status === 201, `${session.label} deep`)
  assert((await rate(session, candidateId, 'T3', 67)).response.status === 201, `${session.label} T3 rating`)
  assert((await choose(session, 'T3', candidateId, 69)).response.status === 201, `${session.label} T3 choice`)
}

async function riskReady(session) {
  await shallowT2(session, 'A')
  assert((await unlock(session, 'A', 'deep')).response.status === 201, `${session.label} risk deep`)
  setRemaining(session.sessionId, 250)
  const shown = await post(session, '/api/sunk-cost/show', {
    sessionId: session.sessionId,
    clientShownAt: now(),
  })
  assert(shown.response.status === 201, `${session.label} show: ${JSON.stringify(shown.payload)}`)
  assert(shown.payload.data.required === true && shown.payload.data.targetCandidateId === 'A', `${session.label} target`)
  return shown.payload.data
}

async function answerSunk(session, sunk, choice) {
  const response = await post(session, '/api/sunk-cost/choice', {
    sessionId: session.sessionId,
    sunkEventId: sunk.sunkEventId,
    choice,
    clientSubmittedAt: now(),
  })
  assert(response.response.status === 201, `${session.label} ${choice}`)
  assert(response.payload.data.choice === choice && response.payload.data.required === false, `${session.label} sealed choice`)
}

async function submitFinal(session, candidateId, confidence = 73) {
  return post(session, '/api/final-decision', {
    sessionId: session.sessionId,
    candidateId,
    confidence,
    clientSubmittedAt: now(),
  })
}

async function timeout(session) {
  setRemaining(session.sessionId, -2)
  return post(session, '/api/final-decision/timeout', {
    sessionId: session.sessionId,
    clientObservedAt: now(),
  })
}

async function resume(session) {
  const result = await request(`/api/sessions/${session.sessionId}/resume`, {
    method: 'GET',
    cookie: session.cookie,
  })
  assert(result.response.status === 200, `resume ${session.label}`)
  return result.payload.data
}

async function notTriggeredScenario() {
  const session = await createReadySession('not-triggered')
  await shallowT2(session, 'B')
  setRemaining(session.sessionId, 250)
  const shown = await post(session, '/api/sunk-cost/show', { sessionId: session.sessionId, clientShownAt: now() })
  assert(shown.response.status === 200 && shown.payload.data.required === false, 'not-triggered show')
  const final = await submitFinal(session, 'B')
  assert(final.response.status === 201 && final.payload.data.submitMode === 'active', 'not-triggered final')
  const restored = await resume(session)
  assert(restored.sunkCost.choice === 'not_triggered', 'not-triggered resume')
}

async function answeredSunkScenario(choice) {
  const session = await createReadySession(choice)
  const sunk = await riskReady(session)
  await answerSunk(session, sunk, choice)
  if (choice !== 'give_up') {
    assert((await rate(session, 'A', 'T3', 45)).response.status === 201, `${choice} T3 rating`)
    assert((await choose(session, 'T3', 'A', 55)).response.status === 201, `${choice} T3 choice`)
  }
  const final = await submitFinal(session, 'A')
  assert(final.response.status === 201 && final.payload.data.sourceStage === (choice === 'give_up' ? 'T2' : 'T3'), `${choice} final`)
  const restored = await resume(session)
  assert(restored.sunkCost.choice === choice && restored.finalDecision.candidateId === 'A', `${choice} resume`)
}

async function activeScenario(stage) {
  const session = await createReadySession(`active-${stage.toLowerCase()}`)
  if (stage === 'T2') await shallowT2(session, 'B')
  else await deepT3(session, 'B')
  setRemaining(session.sessionId, 600)
  const final = await submitFinal(session, 'B', 71)
  assert(final.response.status === 201 && final.payload.data.sourceStage === stage, `active ${stage}`)
}

async function timeoutScenario(stage) {
  const session = await createReadySession(`timeout-${stage.toLowerCase()}`)
  if (stage === 'T2') await shallowT2(session, 'D')
  if (stage === 'T3') await deepT3(session, 'D')
  const final = await timeout(session)
  assert(final.response.status === 201, `timeout ${stage}: ${JSON.stringify(final.payload)}`)
  assert(final.payload.data.submitMode === 'timeout' && final.payload.data.sourceStage === stage, `timeout source ${stage}`)
  const restored = await resume(session)
  assert(restored.session.currentStep === 'post_task' && restored.finalDecision.submitMode === 'timeout', `timeout resume ${stage}`)
}

async function raceScenario() {
  const session = await createReadySession('active-timeout-race')
  await shallowT2(session, 'E')
  setRemaining(session.sessionId, -2)
  const [active, expired] = await Promise.all([
    submitFinal(session, 'E', 65),
    post(session, '/api/final-decision/timeout', { sessionId: session.sessionId, clientObservedAt: now() }),
  ])
  assert([active.response.status, expired.response.status].includes(200) ||
    [active.response.status, expired.response.status].includes(201), 'race final winner')
  const restored = await resume(session)
  assert(restored.finalDecision.submitMode === 'timeout', 'race resolves to timeout')
}

function cleanup() {
  if (participants.length === 0) return
  const ids = participants.map((id) => `'${id}'`).join(',')
  localSql(`DELETE FROM participants WHERE participant_id IN (${ids});`)
}

let failure
try {
  const health = await request('/api/health', { method: 'GET' })
  assert(health.response.status === 200 && health.payload.data.schemaVersion === '6', 'health schema 6')
  await notTriggeredScenario()
  await answeredSunkScenario('continue')
  await answeredSunkScenario('stop_loss')
  await answeredSunkScenario('give_up')
  await activeScenario('T2')
  await activeScenario('T3')
  await timeoutScenario('T1')
  await timeoutScenario('T2')
  await timeoutScenario('T3')
  await raceScenario()

  const quick = await request('/api/sessions', {
    key: crypto.randomUUID(),
    body: { mode: 'quick', identity: { studentId: 'STAGE6-QUICK-REJECT' }, clientVersion: 'stage-6-local-smoke' },
  })
  assert(quick.response.status === 400, 'quick mode rejected by formal API')

  console.log(JSON.stringify({
    ok: true,
    scenarios: [
      'not-triggered', 'continue', 'stop-loss', 'give-up', 'active-t2', 'active-t3',
      'timeout-t1', 'timeout-t2', 'timeout-t3', 'active-timeout-race',
    ],
    quickFormalSessionRejected: true,
    syntheticParticipantsRemoved: participants.length,
  }, null, 2))
} catch (error) {
  failure = error
} finally {
  cleanup()
}

if (failure) throw failure
