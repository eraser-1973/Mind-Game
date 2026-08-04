import { fingerprintValue } from './configurationFingerprint'
import { analysisCandidateIds, type ExpertBenchmarkDocument } from './analysisConfiguration'

/**
 * Hashes only the facts that define an expert benchmark. Lifecycle metadata,
 * revision numbers and administrator/request identity intentionally stay out
 * so equal sealed matrices have equal digests.
 */
export function fingerprintExpertBenchmarkContent(
  document: Pick<ExpertBenchmarkDocument, 'displayName' | 'ratedAt' | 'candidatePolicies' | 'experts'>,
): Promise<string> {
  return fingerprintValue({
    algorithm: 'expert-benchmark-content-v1',
    displayName: document.displayName,
    ratedAt: document.ratedAt,
    candidatePolicies: [...document.candidatePolicies]
      .map((policy) => ({
        candidateId: policy.candidateId,
        direction: policy.direction,
        includeInCoreEac: policy.includeInCoreEac,
      }))
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
    experts: [...document.experts]
      .map((expert) => ({
        expertCode: expert.expertCode,
        scores: analysisCandidateIds.map((candidateId) => ({
          candidateId,
          score: expert.scores[candidateId],
        })),
      }))
      .sort((left, right) => left.expertCode.localeCompare(right.expertCode)),
  })
}

export function fingerprintNormContent(value: {
  displayName: string; scoringVersion: string; sourceType: string; sampleSize: number; populationNote: string
  parameters: Record<string, { mean: number; sd: number }>
}): Promise<string> {
  return fingerprintValue({ algorithm: 'norm-content-v1', displayName: value.displayName,
    scoringVersion: value.scoringVersion, sourceType: value.sourceType, sampleSize: value.sampleSize,
    populationNote: value.populationNote,
    parameters: ['RES', 'EACS', 'DDS', 'GDS', 'SLS'].map((metric) => ({ metric, ...value.parameters[metric] })),
  })
}

function withoutLifecycleFields(value: Record<string, unknown>): Record<string, unknown> {
  const { expectedRevision, revision, revisionNo, status, validationStatus, validationReport, createdAt, updatedAt, validatedAt, publishedAt, adminUserId, createdByAdminUserId, updatedByAdminUserId, publishedByAdminUserId, requestId, ...content } = value
  void expectedRevision; void revision; void revisionNo; void status; void validationStatus
  void validationReport; void createdAt; void updatedAt; void validatedAt; void publishedAt
  void adminUserId; void createdByAdminUserId; void updatedByAdminUserId; void publishedByAdminUserId; void requestId
  return content
}

export function fingerprintReliabilityContent(value: {
  displayName: string; scoringVersion: string; metricCode: string; sd: number; reliability: number; sampleSize: number; populationNote: string
  expectedRevision?: number
}): Promise<string> {
  return fingerprintValue({ algorithm: 'reliability-content-v1', ...withoutLifecycleFields(value) })
}

export function fingerprintScoringDefinitionContent(value: Record<string, unknown>): Promise<string> {
  return fingerprintValue({ algorithm: 'scoring-definition-content-v1', ...withoutLifecycleFields(value) })
}

export type FormalAnalysisFingerprintInput = {
  sourceFacts: Record<string, unknown>
  versions: {
    scoringVersion: string
    benchmarkVersion: string
    normVersion: string | null
    reliabilityVersion: string | null
  }
  fingerprints: {
    scoring: string
    benchmark: string
    norm: string | null
    reliability: string | null
  }
  /** Formula-relevant version content, kept alongside the content digests. */
  parameterFacts: Record<string, unknown>
}

/**
 * Version names are not enough for reproducibility.  The fingerprint binds the
 * sealed source facts and every effective parameter payload/digest so a later
 * immutable rerun can be reused only when the complete analytical input is
 * identical.
 */
export function fingerprintFormalAnalysisRun(input: FormalAnalysisFingerprintInput): Promise<string> {
  return fingerprintValue({
    algorithm: 'formal-analysis-run-v1',
    sourceFacts: input.sourceFacts,
    versions: input.versions,
    contentFingerprints: input.fingerprints,
    parameterFacts: input.parameterFacts,
  })
}

export function fingerprintAnalysisConfiguration(value: Record<string, unknown>): Promise<string> {
  return fingerprintValue({ algorithm: 'analysis-configuration-v1', ...value })
}
