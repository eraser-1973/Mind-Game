export type FormalStageStatus =
  | 'T1_ACTIVE'
  | 'T1_COMPLETE'
  | 'T2_ACTIVE'
  | 'T2_COMPLETE'
  | 'T3_ACTIVE'
  | 'T3_COMPLETE'

export function deriveFormalStageStatus(
  currentStage: string,
  sealedStages: readonly string[],
): FormalStageStatus {
  if (currentStage === 'T1') return 'T1_ACTIVE'
  if (currentStage === 'T1_COMPLETE') return 'T1_COMPLETE'
  if (currentStage === 'T2') {
    return sealedStages.includes('T2') ? 'T2_COMPLETE' : 'T2_ACTIVE'
  }
  if (currentStage === 'T3') {
    return sealedStages.includes('T3') ? 'T3_COMPLETE' : 'T3_ACTIVE'
  }
  throw new Error('Unsupported formal game stage.')
}
