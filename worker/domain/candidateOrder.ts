const CANDIDATE_IDS = ['A', 'B', 'C', 'D', 'E'] as const
const UINT32_RANGE = 0x1_0000_0000

export type CandidateId = (typeof CANDIDATE_IDS)[number]
export type CandidateDisplayOrder = [
  CandidateId,
  CandidateId,
  CandidateId,
  CandidateId,
  CandidateId,
]

function secureUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

function unbiasedIndex(maxInclusive: number, randomUint32: () => number): number {
  const choices = maxInclusive + 1
  const limit = Math.floor(UINT32_RANGE / choices) * choices
  let value: number

  do {
    value = randomUint32() >>> 0
  } while (value >= limit)

  return value % choices
}

export function generateCandidateDisplayOrder(
  randomUint32: () => number = secureUint32,
): CandidateDisplayOrder {
  const order = [...CANDIDATE_IDS]

  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = unbiasedIndex(index, randomUint32)
    ;[order[index], order[swapIndex]] = [order[swapIndex], order[index]]
  }

  return order as CandidateDisplayOrder
}

export function isCandidateDisplayOrder(
  value: unknown,
): value is CandidateDisplayOrder {
  return (
    Array.isArray(value) &&
    value.length === CANDIDATE_IDS.length &&
    [...value].sort().join(',') === CANDIDATE_IDS.join(',')
  )
}
