import { fingerprintValue } from './configurationFingerprint'

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
