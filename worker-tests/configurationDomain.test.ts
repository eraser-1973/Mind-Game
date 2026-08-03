import { describe, expect, it } from 'vitest'
import {
  validateMaterialDocument,
  validatePointRule,
  validateSunkCostRule,
} from '../worker/domain/configuration'
import { canonicalJson, fingerprintValue } from '../worker/domain/configurationFingerprint'

const profile = (id: string, order: number) => ({
  candidateId: id,
  displayOrder: order,
  name: `Candidate ${id}`,
  role: 'Role',
  school: 'School',
  visibleHalo: ['halo'],
  resumeSummary: 'summary',
  education: 'education',
  skills: ['skill'],
  experiences: [{ title: 'experience', content: 'content' }],
  initialImage: 'image',
  publicTags: ['tag'],
})

const evidence = (candidateId: string, level: 'shallow' | 'deep', order: number) => ({
  evidenceId: `${candidateId}-${level}-${order}`,
  candidateId,
  level,
  order,
  title: 'title',
  content: 'content',
  polarity: candidateId === 'A' ? 'negative' as const : 'positive' as const,
  isKeyRisk: candidateId === 'A' && order === 1,
})

function validMaterial() {
  const ids = ['A', 'B', 'C', 'D', 'E']
  return {
    profiles: ids.map((id, index) => profile(id, index + 1)),
    evidence: ids.flatMap((id) => [
      evidence(id, 'shallow', 1), evidence(id, 'shallow', 2),
      evidence(id, 'deep', 1), evidence(id, 'deep', 2),
    ]),
  }
}

describe('configuration domain', () => {
  it('canonicalizes object keys and fingerprints equivalent values identically', async () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 } }))
      .toBe('{"nested":{"a":1,"b":2},"z":1}')
    expect(await fingerprintValue({ b: 2, a: 1 }))
      .toBe(await fingerprintValue({ a: 1, b: 2 }))
  })

  it('accepts a complete material and rejects missing evidence and hidden fields', () => {
    expect(validateMaterialDocument(validMaterial())).toEqual([])
    const missing = validMaterial()
    missing.evidence.pop()
    expect(validateMaterialDocument(missing)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EVIDENCE_COUNT_INVALID' }),
    ]))
    const hidden = validMaterial() as ReturnType<typeof validMaterial> & { trueAbility: number }
    hidden.trueAbility = 100
    expect(validateMaterialDocument(hidden)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HIDDEN_FIELD_FORBIDDEN' }),
    ]))
    const unknown = validMaterial() as ReturnType<typeof validMaterial> & { unexpected: string }
    unknown.unexpected = 'not part of the public schema'
    ;(unknown.profiles[0] as typeof unknown.profiles[0] & { extra: string }).extra = 'ignored field'
    expect(validateMaterialDocument(unknown)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNKNOWN_FIELD', path: 'unexpected' }),
      expect.objectContaining({ code: 'UNKNOWN_FIELD', path: 'profiles[0].extra' }),
    ]))
  })

  it('validates point and sunk-cost boundaries', () => {
    expect(validatePointRule({ totalPoints: 5, shallowCost: 1, deepCost: 3 })).toEqual([])
    expect(validatePointRule({ totalPoints: 3, shallowCost: 1, deepCost: 3 }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'POINT_TOTAL_INSUFFICIENT' })]))
    expect(validateSunkCostRule({ triggerRemainingSec: 300, minimumCandidateInvestment: 2, requiresKeyRisk: true })).toEqual([])
    expect(validateSunkCostRule({ triggerRemainingSec: 900, minimumCandidateInvestment: -1, requiresKeyRisk: true }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'SUNK_TRIGGER_INVALID' }),
        expect.objectContaining({ code: 'SUNK_INVESTMENT_INVALID' }),
      ]))
  })
})
