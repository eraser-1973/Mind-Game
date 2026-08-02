export interface ExistingAdminRecord {
  admin_user_id: string
  username_normalized: string
  password_version: number
}

export interface ProvisionAdminOptions {
  mode: 'local' | 'remote'
  rotate: boolean
  askUsername: () => Promise<string>
  askHiddenPassword: (prompt: string) => Promise<string>
  inspectAdmin: () => Promise<ExistingAdminRecord | null>
  executeSqlFile: (filePath: string) => Promise<void>
  writeOutput: (value: string) => void
  now: () => string
  randomUuid: () => string
  temporaryRoot: string
}

export interface AdminPasswordRecord {
  passwordAlgorithm: 'PBKDF2-HMAC-SHA256'
  passwordIterations: number
  passwordSaltBase64: string
  passwordHashBase64: string
}

export function deriveNodePasswordRecord(password: string): Promise<AdminPasswordRecord>

export function provisionAdmin(options: ProvisionAdminOptions): Promise<{
  operation: 'created' | 'rotated'
  username: string
}>

export function readProvisionSqlForTest(filePath: string): Promise<string>
