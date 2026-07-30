import { describe, expect, it } from 'vitest'
import { createInitialGameState, gameReducer } from './gameReducer'

describe('gameReducer', () => {
  it('can attach anonymous research data to a formal game session', () => {
    const researchData = {
      participantId: 'MG-TEST-123',
      consent: {
        accepted: true,
        acceptedAt: '2026-07-26T00:00:00.000Z',
      },
      demographics: null,
      preTask: null,
      postTask: null,
      taskExperience: null,
      startedAt: '2026-07-26T00:00:00.000Z',
      completedAt: null,
    }
    const initial = createInitialGameState('formal', 1_000, researchData)

    expect(initial.participantId).toBe('MG-TEST-123')
    expect(initial.researchData?.consent.accepted).toBe(true)
    expect(initial.durationSec).toBe(900)
  })

  it('starts without Niko feedback messages', () => {
    const initial = createInitialGameState('formal', 1_000)

    expect(initial.nikoMessages).toEqual([])
  })

  it('adds Niko feedback and replaces the same evidence-stage message', () => {
    const initial = createInitialGameState('formal', 1_000)
    const happyMessage = {
      id: 'niko-C-T2-C-shallow',
      candidateId: 'C',
      stage: 'T2' as const,
      mood: 'happy' as const,
      text: '抓住了正向证据。',
      relatedEvidenceId: 'C-shallow',
      timestamp: 20,
    }
    const added = gameReducer(initial, {
      type: 'NIKO_FEEDBACK',
      message: happyMessage,
    })
    const replaced = gameReducer(added, {
      type: 'NIKO_FEEDBACK',
      message: {
        ...happyMessage,
        mood: 'angry',
        text: '忽略了正向证据。',
        timestamp: 21,
      },
    })

    expect(added.nikoMessages).toHaveLength(1)
    expect(replaced.nikoMessages).toHaveLength(1)
    expect(replaced.nikoMessages[0].mood).toBe('angry')
    expect(replaced.nikoMessages[0].timestamp).toBe(21)
  })

  it('starts without preloaded HR broadcast messages', () => {
    const initial = createInitialGameState('quick', 1_000)

    expect(initial.chats).toHaveLength(0)
  })

  it('keeps one candidate display order stable through interactions', () => {
    const initial = createInitialGameState('quick', 1_000)
    const order = initial.candidateDisplayOrder
    const selected = gameReducer(initial, {
      type: 'SELECT_CANDIDATE',
      candidateId: 'B',
      nowMs: 2_000,
    })

    expect(order.slice().sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(selected.candidateDisplayOrder).toEqual(order)
  })

  it('spends one point for shallow evidence and never unlocks it twice', () => {
    const initial = createInitialGameState('quick', 1_000)
    const once = gameReducer(initial, {
      type: 'VERIFY',
      candidateId: 'A',
      verifyType: 'shallow',
    })
    const twice = gameReducer(once, {
      type: 'VERIFY',
      candidateId: 'A',
      verifyType: 'shallow',
    })

    expect(once.availablePoints).toBe(4)
    expect(once.runtime.A.shallowUnlocked).toBe(true)
    expect(twice.availablePoints).toBe(4)
  })

  it('records one immutable evidence event with conserved points for a successful verification', () => {
    const initial = createInitialGameState('formal', 1_000)
    const verified = gameReducer(initial, {
      type: 'VERIFY',
      candidateId: 'A',
      verifyType: 'shallow',
      eventId: 'verify-A-1',
      occurredAt: '2026-07-30T00:00:10.000Z',
    })

    expect(verified.evidenceEvents).toHaveLength(1)
    expect(verified.evidenceEvents[0]).toMatchObject({
      eventId: 'verify-A-1',
      candidateId: 'A',
      pointsBefore: 5,
      pointsCost: 1,
      pointsAfter: 4,
    })
    expect(verified.availablePoints).toBe(4)
    expect(
      verified.availablePoints +
        verified.evidenceEvents.reduce((sum, event) => sum + event.pointsCost, 0),
    ).toBe(5)
  })

  it('uses only actually unlocked evidence ids in a T2 rating event', () => {
    let state = createInitialGameState('formal', 1_000)
    state = gameReducer(state, {
      type: 'VERIFY',
      candidateId: 'B',
      verifyType: 'shallow',
      eventId: 'verify-B-1',
      occurredAt: '2026-07-30T00:00:10.000Z',
    })
    state = gameReducer(state, {
      type: 'RATE',
      candidateId: 'B',
      stage: 'T2',
      value: 71,
      eventId: 'rate-B-T2-1',
      occurredAt: '2026-07-30T00:00:12.000Z',
    })

    expect(state.ratingEvents).toHaveLength(1)
    expect(state.ratingEvents[0].relatedEvidenceIds).toEqual(
      state.runtime.B.viewedEvidenceIds,
    )
    expect(state.ratingEvents[0].relatedEvidenceIds).not.toEqual(
      expect.arrayContaining(['B-deep-1', 'B-deep-2']),
    )
  })

  it('refuses deep verification when fewer than three points remain', () => {
    let state = createInitialGameState('quick', 1_000)
    state = gameReducer(state, {
      type: 'VERIFY',
      candidateId: 'C',
      verifyType: 'deep',
    })
    state = gameReducer(state, {
      type: 'VERIFY',
      candidateId: 'A',
      verifyType: 'shallow',
    })
    const refused = gameReducer(state, {
      type: 'VERIFY',
      candidateId: 'D',
      verifyType: 'deep',
    })

    expect(state.availablePoints).toBe(1)
    expect(refused.availablePoints).toBe(1)
    expect(refused.runtime.D.deepUnlocked).toBe(false)
    expect(refused.notice).toContain('不足')
  })

  it('clamps ratings and blocks T2 before shallow evidence', () => {
    const initial = createInitialGameState('quick', 1_000)
    const blocked = gameReducer(initial, {
      type: 'RATE',
      candidateId: 'A',
      stage: 'T2',
      value: 150,
    })
    const rated = gameReducer(initial, {
      type: 'RATE',
      candidateId: 'A',
      stage: 'T1',
      value: 150,
    })

    expect(blocked.runtime.A.ratings.T2).toBeUndefined()
    expect(rated.runtime.A.ratings.T1?.value).toBe(100)
  })

  it('records and warns about investment after toxic negative evidence', () => {
    let state = createInitialGameState('quick', 1_000)
    state = gameReducer(state, {
      type: 'VERIFY',
      candidateId: 'A',
      verifyType: 'shallow',
    })
    state = gameReducer(state, {
      type: 'VERIFY',
      candidateId: 'A',
      verifyType: 'deep',
    })

    expect(state.runtime.A.addedAfterNegative).toBe(true)
    expect(state.logs.at(-1)?.addedAfterNegative).toBe(true)
    expect(state.chats.at(-1)?.tone).toBe('warning')
  })

  it('settles candidate view time when switching profiles', () => {
    const initial = createInitialGameState('quick', 1_000)
    const switched = gameReducer(initial, {
      type: 'SELECT_CANDIDATE',
      candidateId: 'B',
      nowMs: 4_500,
    })

    expect(switched.runtime.A.viewTimeMs).toBe(3_500)
    expect(switched.selectedCandidateId).toBe('B')
  })

  it('opens the sunk-cost event in the final third after toxic investment', () => {
    let state = createInitialGameState('quick', 1_000)
    state = gameReducer(state, {
      type: 'VERIFY',
      candidateId: 'A',
      verifyType: 'deep',
    })
    state = gameReducer(state, { type: 'TICK', deltaSec: 121 })

    expect(state.sunkCostShown).toBe(true)
  })

  it('returns from a voluntary final-decision preview while time remains', () => {
    let state = createInitialGameState('quick', 1_000)
    for (const candidateId of ['A', 'B', 'C', 'D', 'E']) {
      state = gameReducer(state, {
        type: 'RATE',
        candidateId,
        stage: 'T1',
        value: 50,
      })
    }
    state = gameReducer(state, { type: 'OPEN_DECISION' })
    state = gameReducer(state, { type: 'RESUME_PLAYING' })

    expect(state.phase).toBe('playing')
  })

  it('captures a T1 preference snapshot with explicit confidence', () => {
    const state = gameReducer(createInitialGameState('formal', 1_000), {
      type: 'CAPTURE_STAGE_SNAPSHOT', stage: 'T1', preferredCandidateId: 'B', confidence: 78,
      eventId: 'snapshot-t1', occurredAt: '2026-07-30T00:01:00.000Z',
    })
    expect(state.stageSnapshots[0]).toMatchObject({ stage: 'T1', preferredCandidateId: 'B', confidence: 78 })
  })

  it('requests T2 or T3 snapshots only for formal evidence stages', () => {
    const rated = (mode: 'formal' | 'quick') => {
      let state = createInitialGameState(mode, 1_000)
      for (const candidateId of ['A', 'B', 'C', 'D', 'E']) {
        state = gameReducer(state, { type: 'RATE', candidateId, stage: 'T1', value: 50 })
      }
      return state
    }
    let shallow = gameReducer(rated('formal'), { type: 'VERIFY', candidateId: 'B', verifyType: 'shallow' })
    shallow = gameReducer(shallow, { type: 'OPEN_DECISION' })
    expect(shallow.pendingSnapshotStage).toBe('T2')

    let deep = gameReducer(rated('formal'), { type: 'VERIFY', candidateId: 'D', verifyType: 'deep' })
    deep = gameReducer(deep, { type: 'OPEN_DECISION' })
    expect(deep.pendingSnapshotStage).toBe('T3')

    const quick = gameReducer(rated('quick'), { type: 'OPEN_DECISION' })
    expect(quick.phase).toBe('decision')
    expect(quick.pendingSnapshotStage).toBeNull()
  })

  it('accumulates technical pause time without assigning it to assessment validity', () => {
    let state = gameReducer(createInitialGameState('formal', 1_000), {
      type: 'TECHNICAL_ERROR', reason: 'render failed', occurredAt: '2026-07-30T00:00:01.000Z',
    })
    state = gameReducer(state, {
      type: 'TECHNICAL_RESUME', occurredAt: '2026-07-30T00:00:06.000Z',
    })
    expect(state.invalidForAssessment).toBe(true)
    expect(state.technicalPauseMs).toBe(5_000)
    expect(state.technicalPauseStartedAt).toBeNull()
  })

  it('distinguishes manual and timeout-confirmed final decisions', () => {
    const initial = createInitialGameState('formal', 1_000)
    const manual = gameReducer(initial, { type: 'FINAL_SELECT', candidateId: 'B', confidence: 82, submissionType: 'manual', nowMs: 2_000, eventId: 'final-manual', occurredAt: '2026-07-30T00:10:00.000Z' })
    const timeout = gameReducer(initial, { type: 'FINAL_SELECT', candidateId: 'D', confidence: 61, submissionType: 'timeout_confirmed', nowMs: 2_000, eventId: 'final-timeout', occurredAt: '2026-07-30T00:15:00.000Z' })
    expect(manual.finalDecision?.submissionType).toBe('manual')
    expect(timeout.finalDecision?.submissionType).toBe('timeout_confirmed')
    expect(timeout.stageSnapshots.at(-1)?.stage).toBe('FINAL')
  })

  it('updates structured sunk-cost behavior after the choice', () => {
    let state = createInitialGameState('formal', 1_000)
    state = gameReducer(state, { type: 'VERIFY', candidateId: 'A', verifyType: 'shallow', eventId: 'verify-risk-a', occurredAt: '2026-07-30T00:01:00.000Z' })
    state = gameReducer(state, { type: 'SUNK_COST_CHOICE', choice: 'continue', eventId: 'sunk-1', occurredAt: '2026-07-30T00:02:00.000Z' })
    state = gameReducer(state, { type: 'VERIFY', candidateId: 'A', verifyType: 'deep', eventId: 'verify-after-a', occurredAt: '2026-07-30T00:03:00.000Z' })
    state = gameReducer(state, { type: 'SELECT_CANDIDATE', candidateId: 'B', nowMs: 4_000 })
    state = gameReducer(state, { type: 'RATE', candidateId: 'A', stage: 'T2', value: 42 })
    state = gameReducer(state, { type: 'FINAL_SELECT', candidateId: 'B', confidence: 79, submissionType: 'manual', nowMs: 5_000 })
    expect(state.sunkCostEvents[0]).toMatchObject({
      choice: 'continue', subsequentAdditionalPoints: 3,
      subsequentCandidateSwitches: 1, subsequentRatingChanges: 1,
      finalCandidateId: 'B', finalConfidence: 79,
    })
  })

  it.each(['A', 'C'])('tracks actual risk evidence ids before later investment for %s', (candidateId) => {
    let state = createInitialGameState('formal', 1_000)
    state = gameReducer(state, { type: 'VERIFY', candidateId, verifyType: 'shallow', eventId: `risk-${candidateId}`, occurredAt: '2026-07-30T00:01:00.000Z' })
    state = gameReducer(state, { type: 'VERIFY', candidateId, verifyType: 'deep', eventId: `after-${candidateId}`, occurredAt: '2026-07-30T00:02:00.000Z' })
    const event = state.evidenceEvents.at(-1)
    expect(event?.addedAfterRiskEvidence).toBe(true)
    expect(event?.riskEvidenceIdsPreviouslySeen.length).toBeGreaterThan(0)
    expect(event?.additionalPointsThisEvent).toBe(3)
  })

  it('creates server-valid log ids scoped to the formal session', () => {
    const first = gameReducer(
      { ...createInitialGameState('formal', 1_000), sessionId: 'sess-first-1234' },
      { type: 'SELECT_CANDIDATE', candidateId: 'B', nowMs: 2_000 },
    )
    const second = gameReducer(
      { ...createInitialGameState('formal', 1_000), sessionId: 'sess-second-1234' },
      { type: 'SELECT_CANDIDATE', candidateId: 'B', nowMs: 2_000 },
    )

    expect(first.logs[0].id).toMatch(/^[a-zA-Z0-9_-]{6,128}$/)
    expect(first.logs[0].id).not.toBe(second.logs[0].id)
  })
})
