const origin = process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:8787'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

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

function now() {
  return new Date().toISOString()
}

async function createReadySession(label) {
  const created = await request('/api/sessions', {
    key: crypto.randomUUID(),
    body: {
      mode: 'formal',
      identity: { fullName: `Stage5 Synthetic Smoke ${label}` },
      clientVersion: 'stage-5-local-smoke',
    },
  })
  assert(created.response.status === 201, `create ${label}: ${JSON.stringify(created.payload)}`)
  const session = {
    sessionId: created.payload.data.sessionId,
    participantId: created.payload.data.participantId,
    cookie: (created.response.headers.get('set-cookie') ?? '').split(';')[0],
  }
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
  assert(demographics.response.status === 201, `demographics ${label}`)

  const ids = ['stress', 'fatigue', 'attention', 'mood', 'physicalDiscomfort']
  const questionnaire = await post(session, '/api/questionnaires', {
    sessionId: session.sessionId,
    phase: 'pre',
    instrumentVersion: 'state-assessment-pre-1.0.0',
    clientStartedAt: now(),
    clientSubmittedAt: now(),
    answers: ids.map((itemId, index) => ({
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
    clientVersion: 'stage-5-local-smoke',
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
      clientSequence: index + 1,
    })
    assert(rating.response.status === 201, `T1 ${label}/${candidateId}`)
  }
  const choice = await post(session, '/api/stage-choices', {
    sessionId: session.sessionId,
    stage: 'T1',
    candidateId: session.order[0],
    confidence: 60,
    clientSubmittedAt: now(),
    clientSequence: 6,
  })
  assert(choice.response.status === 201, `T1 choice ${label}`)
  return session
}

async function unlock(session, candidateId, level, key = crypto.randomUUID()) {
  return post(session, '/api/evidence/unlock', {
    sessionId: session.sessionId,
    candidateId,
    level,
    clientAt: now(),
    clientSequence: 7,
  }, key)
}

async function rate(session, candidateId, stage, ratingValue) {
  return post(session, '/api/ratings', {
    sessionId: session.sessionId,
    candidateId,
    stage,
    ratingValue,
    clientSubmittedAt: now(),
    clientSequence: 8,
  })
}

async function choose(session, stage, candidateId, confidence) {
  return post(session, '/api/stage-choices', {
    sessionId: session.sessionId,
    stage,
    candidateId,
    confidence,
    clientSubmittedAt: now(),
    clientSequence: 9,
  })
}

async function resume(session) {
  const result = await request(`/api/sessions/${session.sessionId}/resume`, {
    method: 'GET', cookie: session.cookie,
  })
  assert(result.response.status === 200, `resume ${session.sessionId}`)
  return result.payload.data.game
}

async function fiveShallowScenario() {
  const session = await createReadySession('five-shallow')
  let expected = 5
  for (const candidateId of session.order) {
    const result = await unlock(session, candidateId, 'shallow')
    expected -= 1
    assert(result.response.status === 201, `five shallow ${candidateId}`)
    assert(result.payload.data.points.after === expected, `five shallow points ${candidateId}`)
    const rating = await rate(session, candidateId, 'T2', 60)
    assert(rating.response.status === 201, `five T2 ${candidateId}`)
  }
  const replay = await unlock(session, session.order[0], 'shallow')
  assert(replay.response.status === 200 && replay.payload.data.alreadyUnlocked === true, 'different-key replay')
  const choice = await choose(session, 'T2', session.order[0], 0)
  assert(choice.response.status === 201 && choice.payload.data.stageStatus === 'T2_COMPLETE', 'five shallow T2 choice')
  const game = await resume(session)
  assert(game.points.remaining === 0 && game.stageStatus === 'T2_COMPLETE', 'five shallow resume')
  return session
}

async function shallowDeepScenario() {
  const session = await createReadySession('shallow-deep')
  const key = crypto.randomUUID()
  const shallow = await unlock(session, 'A', 'shallow', key)
  const replay = await unlock(session, 'A', 'shallow', key)
  assert(shallow.response.status === 201 && shallow.payload.data.points.after === 4, 'A shallow')
  assert(replay.response.status === 200 && replay.payload.data.created === false, 'same-key replay')
  assert((await rate(session, 'A', 'T2', 62)).response.status === 201, 'A T2')
  assert((await choose(session, 'T2', 'A', 65)).response.status === 201, 'A T2 choice')
  const deep = await unlock(session, 'A', 'deep')
  assert(deep.response.status === 201 && deep.payload.data.points.after === 1, 'A deep')
  const t3 = await rate(session, 'A', 'T3', 48)
  assert(t3.response.status === 201, 'A T3')
  assert(t3.payload.data.evidenceIdsSeen.length === 4, 'A T3 evidence snapshot')
  const choice = await choose(session, 'T3', 'A', 70)
  assert(choice.response.status === 201 && choice.payload.data.stageStatus === 'T3_COMPLETE', 'A T3 choice')
  const game = await resume(session)
  assert(game.stageStatus === 'T3_COMPLETE' && game.points.remaining === 1, 'A final resume')
  assert(game.evidenceUnlocks.length === 2 && game.ratings.some((item) => item.stage === 'T3'), 'A resume data')
  return session
}

async function competingDeepScenario() {
  const session = await createReadySession('competing-deep')
  for (const candidateId of ['A', 'B']) {
    assert((await unlock(session, candidateId, 'shallow')).response.status === 201, `competition shallow ${candidateId}`)
    assert((await rate(session, candidateId, 'T2', 60)).response.status === 201, `competition T2 ${candidateId}`)
  }
  assert((await choose(session, 'T2', 'A', 70)).response.status === 201, 'competition T2 choice')
  const results = await Promise.all([
    unlock(session, 'A', 'deep'),
    unlock(session, 'B', 'deep'),
  ])
  const statuses = results.map(({ response }) => response.status).sort()
  assert(JSON.stringify(statuses) === JSON.stringify([201, 409]), `competition statuses ${statuses}`)
  const game = await resume(session)
  assert(game.points.remaining === 0, 'competition points')
  assert(game.evidenceUnlocks.filter((item) => item.level === 'deep').length === 1, 'competition one winner')
  return session
}

const health = await request('/api/health', { method: 'GET' })
assert(health.response.status === 200 && health.payload.data.schemaVersion === '5', 'health schema 5')
const sessions = [
  await fiveShallowScenario(),
  await shallowDeepScenario(),
  await competingDeepScenario(),
]
const quick = await request('/api/sessions', {
  key: crypto.randomUUID(),
  body: { mode: 'quick', identity: { fullName: 'Rejected Quick Smoke' }, clientVersion: 'stage-5-local-smoke' },
})
assert(quick.response.status === 400, 'quick mode rejected by formal session API')

console.log(JSON.stringify({
  ok: true,
  scenarios: ['five-shallow', 'shallow-deep', 'competing-deep'],
  sessions: sessions.map(({ sessionId, participantId }) => ({ sessionId, participantId })),
  quickFormalSessionRejected: true,
}, null, 2))
