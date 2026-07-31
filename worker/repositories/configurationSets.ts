export type ConfigurationSet = {
  configSetId: string
  taskVersion: string
  materialVersion: string
  pointRuleVersion: string
  scoringVersion: string
  benchmarkVersion: string
  normVersion: string | null
}

type ConfigurationSetRow = {
  config_set_id: string
  task_version: string
  material_version: string
  point_rule_version: string
  scoring_version: string
  benchmark_version: string
  norm_version: string | null
}

export async function findActiveConfigurationSet(
  db: D1Database,
): Promise<ConfigurationSet | null> {
  const rows = await db.prepare(
    `SELECT config_set_id, task_version, material_version,
            point_rule_version, scoring_version, benchmark_version,
            norm_version
     FROM configuration_sets
     WHERE is_active = 1 AND status = 'published'
     LIMIT 2`,
  ).all<ConfigurationSetRow>()

  if (rows.results.length !== 1) return null
  const row = rows.results[0]
  return {
    configSetId: row.config_set_id,
    taskVersion: row.task_version,
    materialVersion: row.material_version,
    pointRuleVersion: row.point_rule_version,
    scoringVersion: row.scoring_version,
    benchmarkVersion: row.benchmark_version,
    normVersion: row.norm_version,
  }
}
