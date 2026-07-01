import type {
  Candidate,
  CandidateRuntimeState,
  Evidence,
  EvidencePolarity,
  NikoMessage,
  NikoMood,
  RatingDirection,
} from '../types/game'

export const getRatingDirection = (
  value: number,
  baseline: number,
): RatingDirection | null =>
  value === baseline ? null : value > baseline ? 'higher' : 'lower'

export const getNikoMood = (
  polarity: EvidencePolarity,
  direction: RatingDirection,
): NikoMood =>
  (polarity === 'positive' && direction === 'higher') ||
  (polarity === 'negative' && direction === 'lower')
    ? 'happy'
    : 'angry'

const stableVariant = (evidenceId: string) =>
  [...evidenceId].reduce((total, character) => total + character.charCodeAt(0), 0) % 2

const evidenceFocus = (evidence: Evidence) => {
  const firstSentence = evidence.content.split(/[。！？]/)[0]?.trim()
  return firstSentence ? `${firstSentence}。` : evidence.content
}

const buildFeedbackText = (
  evidence: Evidence,
  mood: NikoMood,
): string => {
  const focus = evidenceFocus(evidence)
  const variant = stableVariant(evidence.id)

  if (mood === 'happy' && evidence.polarity === 'positive') {
    return variant === 0
      ? `“${evidence.title}”已经说明：${focus}你能把握住这类稳定信号，很好。`
      : `你抓住了“${evidence.title}”里的正面信息——${focus}这次修正有依据。`
  }

  if (mood === 'happy') {
    return variant === 0
      ? `“${evidence.title}”已经暴露出风险：${focus}你能及时收紧评分，说明你注意到了问题。`
      : `你没有放过“${evidence.title}”这个风险点。${focus}保持这种警觉。`
  }

  if (evidence.polarity === 'positive') {
    return variant === 0
      ? `材料里的“${evidence.title}”明明给出了正向信号：${focus}你却还在压分，是不是漏看了关键点？`
      : `“${evidence.title}”体现了可验证的优势。${focus}为什么你的判断反而更低？`
  }

  return variant === 0
    ? `都已经看到“${evidence.title}”的风险了：${focus}你还往上提分？这个判断太冒进了。`
    : `“${evidence.title}”不是可以忽略的小问题。${focus}你为什么还在提高评价？`
}

type CreateNikoFeedbackInput = {
  candidate: Candidate
  runtime: CandidateRuntimeState
  stage: 'T2' | 'T3'
  value: number
  timestamp: number
}

export const createNikoFeedback = ({
  candidate,
  runtime,
  stage,
  value,
  timestamp,
}: CreateNikoFeedbackInput): NikoMessage | null => {
  const baselineRecord =
    stage === 'T2'
      ? runtime.ratings.T1
      : runtime.ratings.T2 ?? runtime.ratings.T1
  if (!baselineRecord) return null

  const direction = getRatingDirection(value, baselineRecord.value)
  if (!direction) return null

  const evidence =
    stage === 'T2' ? candidate.shallowEvidence : candidate.deepEvidence
  const mood = getNikoMood(evidence.polarity, direction)

  return {
    id: `niko-${candidate.id}-${stage}-${evidence.id}`,
    candidateId: candidate.id,
    stage,
    mood,
    text: buildFeedbackText(evidence, mood),
    relatedEvidenceId: evidence.id,
    timestamp,
  }
}
