import type { FormalEvidenceItem } from '../types/formalGame'
import type { NikoMessage } from '../types/game'

export function createFormalNikoFeedback(input: {
  candidateId: string
  stage: 'T2' | 'T3'
  evidence: FormalEvidenceItem
  timestamp: number
}): NikoMessage {
  return {
    id: `formal-niko-${input.candidateId}-${input.stage}-${input.evidence.id}`,
    candidateId: input.candidateId,
    stage: input.stage,
    mood: 'neutral',
    text: `已记录你对候选人 ${input.candidateId} 的 ${input.stage} 评分调整；材料“${input.evidence.title}”已纳入本次判断记录。`,
    relatedEvidenceId: input.evidence.id,
    timestamp: input.timestamp,
  }
}
