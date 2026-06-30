import { describe, expect, it } from 'vitest'
import { createInitialGameState, gameReducer } from './gameReducer'

describe('gameReducer', () => {
  it('starts without preloaded HR broadcast messages', () => {
    const initial = createInitialGameState('quick', 1_000)

    expect(initial.chats).toHaveLength(0)
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
})
