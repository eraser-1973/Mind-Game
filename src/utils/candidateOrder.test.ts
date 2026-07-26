import { describe, expect, it } from 'vitest'
import { shuffleCandidateIds } from './candidateOrder'

describe('shuffleCandidateIds', () => {
  it('returns every candidate exactly once without mutating the input', () => {
    const source = ['A', 'B', 'C', 'D', 'E']
    const result = shuffleCandidateIds(source, () => 0)

    expect(result).toEqual(['B', 'C', 'D', 'E', 'A'])
    expect(result.slice().sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(source).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})
