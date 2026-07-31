export interface AppMetadata {
  schemaVersion: string
  serviceName: string
}

interface MetadataRow {
  key: string
  value: string
}

export async function readAppMetadata(db: D1Database): Promise<AppMetadata> {
  const result = await db
    .prepare(
      "SELECT key, value FROM app_metadata WHERE key IN ('schema_version', 'service_name')",
    )
    .all<MetadataRow>()

  const metadata = new Map(result.results.map((row) => [row.key, row.value]))
  const schemaVersion = metadata.get('schema_version')
  const serviceName = metadata.get('service_name')

  if (!schemaVersion || !serviceName) {
    throw new Error('Required application metadata is missing')
  }

  return { schemaVersion, serviceName }
}
