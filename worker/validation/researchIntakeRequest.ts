const MAX_BODY_BYTES = 16 * 1024
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONSENT_VERSION = 'consent-1.0.0'
const PRE_INSTRUMENT_VERSION = 'state-assessment-pre-1.0.0'
const PRE_ITEM_IDS = [
  'stress',
  'fatigue',
  'attention',
  'mood',
  'physicalDiscomfort',
] as const

const demographicValues = {
  ageRange: ['18–20', '21–23', '24及以上', '不愿透露'],
  gender: ['男', '女', '其他', '不愿透露'],
  education: ['本科', '硕士', '其他', '不愿透露'],
  grade: ['大一', '大二', '大三', '大四', '研究生', '不愿透露'],
  majorCategory: [
    '心理学', '计算机或人工智能', '经管', '理工科',
    '人文社科', '其他', '不愿透露',
  ],
  relatedExperience: [
    '企业实习经历', '学生科研经历', '数据分析相关经历',
    '招聘或人才评估相关经历', '无相关经历',
  ],
} as const

export class ResearchIntakeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ResearchIntakeRequestError'
  }
}

type JsonRecord = Record<string, unknown>

export type ConsentInput = {
  eventId: string
  sessionId: string
  accepted: true
  consentVersion: typeof CONSENT_VERSION
  clientAcceptedAt: string
}

export type DemographicsInput = {
  eventId: string
  sessionId: string
  demographics: {
    ageRange: string
    gender: string
    education: string
    grade: string
    majorCategory: string
    relatedExperience: string[]
  }
  clientSubmittedAt: string
}

export type QuestionnaireAnswerInput = {
  itemId: string
  value: number
  touched: true
  answeredAt: string
}

export type PreTaskQuestionnaireInput = {
  eventId: string
  sessionId: string
  phase: 'pre'
  instrumentVersion: typeof PRE_INSTRUMENT_VERSION
  clientStartedAt: string
  clientSubmittedAt: string
  answers: QuestionnaireAnswerInput[]
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(record: JsonRecord, keys: string[]): boolean {
  const actual = Object.keys(record).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function requestError(code = 'INVALID_REQUEST', message = 'The research intake request is invalid.') {
  return new ResearchIntakeRequestError(400, code, message)
}

function parseIsoTimestamp(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw requestError('INVALID_TIMESTAMP', 'A valid ISO timestamp is required.')
  }
  const timestamp = Date.parse(value)
  if (timestamp > Date.now() + 24 * 60 * 60 * 1000) {
    throw requestError('INVALID_TIMESTAMP', 'The timestamp is outside the accepted range.')
  }
  return value
}

export function requireUuid(value: unknown, code = 'INVALID_REQUEST'): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw requestError(code, 'A valid UUID is required.')
  }
  return value.toLowerCase()
}

export async function readResearchJson(request: Request): Promise<JsonRecord> {
  const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new ResearchIntakeRequestError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Content-Type must be application/json.',
    )
  }

  const declaredLength = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ResearchIntakeRequestError(413, 'REQUEST_TOO_LARGE', 'The request body is too large.')
  }

  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new ResearchIntakeRequestError(413, 'REQUEST_TOO_LARGE', 'The request body is too large.')
  }

  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw requestError('INVALID_JSON', 'The request body must contain valid JSON.')
  }
  if (!isRecord(body)) throw requestError()
  return body
}

export function readIdempotencyKey(request: Request): string {
  return requireUuid(
    request.headers.get('Idempotency-Key')?.trim(),
    'INVALID_IDEMPOTENCY_KEY',
  )
}

export async function parseConsentRequest(request: Request): Promise<ConsentInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  if (!hasExactKeys(body, ['sessionId', 'accepted', 'consentVersion', 'clientAcceptedAt'])) {
    throw requestError()
  }
  if (body.accepted !== true) {
    throw requestError('CONSENT_REQUIRED', 'Consent must be explicitly accepted.')
  }
  if (body.consentVersion !== CONSENT_VERSION) {
    throw requestError('INVALID_CONSENT_VERSION', 'The consent version is not accepted.')
  }
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    accepted: true,
    consentVersion: CONSENT_VERSION,
    clientAcceptedAt: parseIsoTimestamp(body.clientAcceptedAt),
  }
}

function isAllowed(value: unknown, options: readonly string[]): value is string {
  return typeof value === 'string' && options.includes(value)
}

export async function parseDemographicsRequest(request: Request): Promise<DemographicsInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  if (!hasExactKeys(body, ['sessionId', 'demographics', 'clientSubmittedAt']) || !isRecord(body.demographics)) {
    throw requestError()
  }
  const data = body.demographics
  if (!hasExactKeys(data, [
    'ageRange', 'gender', 'education', 'grade', 'majorCategory', 'relatedExperience',
  ])) throw requestError()

  const related = data.relatedExperience
  const demographicsValid =
    isAllowed(data.ageRange, demographicValues.ageRange) &&
    isAllowed(data.gender, demographicValues.gender) &&
    isAllowed(data.education, demographicValues.education) &&
    isAllowed(data.grade, demographicValues.grade) &&
    isAllowed(data.majorCategory, demographicValues.majorCategory) &&
    Array.isArray(related) && related.length > 0 &&
    related.every((value) => isAllowed(value, demographicValues.relatedExperience)) &&
    new Set(related).size === related.length &&
    !(related.includes('无相关经历') && related.length > 1)

  if (!demographicsValid) {
    throw requestError('INVALID_DEMOGRAPHICS', 'The demographic response is invalid.')
  }

  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    demographics: {
      ageRange: data.ageRange as string,
      gender: data.gender as string,
      education: data.education as string,
      grade: data.grade as string,
      majorCategory: data.majorCategory as string,
      relatedExperience: [...related] as string[],
    },
    clientSubmittedAt: parseIsoTimestamp(body.clientSubmittedAt),
  }
}

export async function parsePreTaskQuestionnaireRequest(
  request: Request,
): Promise<PreTaskQuestionnaireInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  if (!hasExactKeys(body, [
    'sessionId', 'phase', 'instrumentVersion', 'clientStartedAt',
    'clientSubmittedAt', 'answers',
  ])) throw requestError('INVALID_QUESTIONNAIRE', 'The questionnaire response is invalid.')
  if (
    body.phase !== 'pre' ||
    body.instrumentVersion !== PRE_INSTRUMENT_VERSION ||
    !Array.isArray(body.answers) ||
    body.answers.length !== PRE_ITEM_IDS.length
  ) throw requestError('INVALID_QUESTIONNAIRE', 'The questionnaire response is invalid.')

  const answers: QuestionnaireAnswerInput[] = []
  for (const raw of body.answers) {
    if (!isRecord(raw) || !hasExactKeys(raw, ['itemId', 'value', 'touched', 'answeredAt'])) {
      throw requestError('INVALID_QUESTIONNAIRE', 'The questionnaire response is invalid.')
    }
    if (raw.touched !== true) {
      throw requestError('QUESTIONNAIRE_INCOMPLETE', 'Every questionnaire item must be answered explicitly.')
    }
    if (
      typeof raw.itemId !== 'string' ||
      !PRE_ITEM_IDS.some((itemId) => itemId === raw.itemId) ||
      !Number.isInteger(raw.value) ||
      (raw.value as number) < 0 ||
      (raw.value as number) > 10
    ) throw requestError('INVALID_QUESTIONNAIRE', 'The questionnaire response is invalid.')
    answers.push({
      itemId: raw.itemId,
      value: raw.value as number,
      touched: true,
      answeredAt: parseIsoTimestamp(raw.answeredAt),
    })
  }
  if (new Set(answers.map((answer) => answer.itemId)).size !== PRE_ITEM_IDS.length) {
    throw requestError('INVALID_QUESTIONNAIRE', 'The questionnaire response is invalid.')
  }

  const clientStartedAt = parseIsoTimestamp(body.clientStartedAt)
  const clientSubmittedAt = parseIsoTimestamp(body.clientSubmittedAt)
  if (Date.parse(clientSubmittedAt) < Date.parse(clientStartedAt)) {
    throw requestError('INVALID_TIMESTAMP', 'Questionnaire timestamps are inconsistent.')
  }
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    phase: 'pre',
    instrumentVersion: PRE_INSTRUMENT_VERSION,
    clientStartedAt,
    clientSubmittedAt,
    answers,
  }
}
