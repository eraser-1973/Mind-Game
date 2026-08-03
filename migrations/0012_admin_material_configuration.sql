PRAGMA foreign_keys = OFF;

CREATE TABLE material_sets (
  material_version TEXT PRIMARY KEY CHECK (
    length(material_version) BETWEEN 3 AND 64
    AND material_version NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  source_material_version TEXT,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  validation_status TEXT NOT NULL CHECK (
    validation_status IN ('not_validated', 'valid', 'invalid', 'stale')
  ),
  validation_report_json TEXT NOT NULL CHECK (
    json_valid(validation_report_json) AND json_type(validation_report_json) = 'object'
  ),
  content_fingerprint TEXT CHECK (
    content_fingerprint IS NULL OR (
      length(content_fingerprint) = 64
      AND content_fingerprint = lower(content_fingerprint)
      AND content_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  ),
  created_by_admin_user_id TEXT,
  updated_by_admin_user_id TEXT,
  published_by_admin_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  validated_at TEXT,
  published_at TEXT,
  FOREIGN KEY (source_material_version) REFERENCES material_sets(material_version) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (published_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  CHECK (
    status <> 'published' OR (
      content_fingerprint IS NOT NULL
      AND validation_status = 'valid'
      AND validated_at IS NOT NULL
      AND published_at IS NOT NULL
    )
  )
);

INSERT INTO material_sets (
  material_version, display_name, status, source_material_version,
  revision_no, validation_status, validation_report_json, content_fingerprint,
  created_at, updated_at, validated_at, published_at
) VALUES (
  'material-1.0.0', '当前五名候选人材料', 'published', NULL,
  1, 'valid', json('{"errors":[],"warnings":[]}'),
  'fb03e7283f9f6aecd5d576aace905a8c0432d9f24d726491addfbe813922b91f',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TABLE candidate_material_profiles (
  material_version TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  display_order INTEGER NOT NULL CHECK (display_order BETWEEN 1 AND 5),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  role TEXT NOT NULL CHECK (length(trim(role)) > 0),
  school TEXT NOT NULL CHECK (length(trim(school)) > 0),
  visible_halo_json TEXT NOT NULL CHECK (
    json_valid(visible_halo_json) AND json_type(visible_halo_json) = 'array'
  ),
  resume_summary TEXT NOT NULL CHECK (length(trim(resume_summary)) > 0),
  education TEXT NOT NULL CHECK (length(trim(education)) > 0),
  skills_json TEXT NOT NULL CHECK (
    json_valid(skills_json) AND json_type(skills_json) = 'array'
  ),
  experiences_json TEXT NOT NULL CHECK (
    json_valid(experiences_json) AND json_type(experiences_json) = 'array'
    AND json_array_length(experiences_json) > 0
  ),
  initial_image TEXT NOT NULL CHECK (length(trim(initial_image)) > 0),
  public_tags_json TEXT NOT NULL CHECK (
    json_valid(public_tags_json) AND json_type(public_tags_json) = 'array'
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (material_version, candidate_id),
  UNIQUE (material_version, display_order),
  FOREIGN KEY (material_version) REFERENCES material_sets(material_version) ON DELETE CASCADE
);

CREATE INDEX candidate_material_profiles_version_order_idx
ON candidate_material_profiles (material_version, display_order);

INSERT INTO candidate_material_profiles (
  material_version, candidate_id, display_order, name, role, school,
  visible_halo_json, resume_summary, education, skills_json,
  experiences_json, initial_image, public_tags_json, created_at, updated_at
) VALUES
('material-1.0.0','A',1,'候选人 A','AI测评产品助理（实习生）','华东某985高校',json('["985高校","GPA 3.86/4.00","全国二等奖","头部互联网实习"]'),'计算机科学与技术专业，成绩与竞赛、互联网实习经历突出；简历自述参与简历匹配模型、数据处理与系统实现。','华东某985高校｜计算机科学与技术专业（2022.09—2026.06），GPA 3.86/4.00，专业排名前8%。相关课程：机器学习、数据结构、数据库系统、数据可视化。',json('["Python","Excel","SQL","机器学习基础","数据可视化","产品需求分析","Axure","PPT"]'),json('[{"title":"学院学生会科技部部长（2023.09—2024.06）","content":"负责活动策划、嘉宾沟通、宣传材料和现场执行，组织AI工具分享会、程序设计训练营和创新创业讲座共8场。"},{"title":"人工智能创新应用挑战赛全国二等奖（2024.05）","content":"项目为“基于简历文本的岗位匹配评分系统”；简历称担任核心成员，参与模型设计、数据处理、系统实现和答辩展示。"},{"title":"某头部互联网公司AI产品实习生（2025.07—2025.09）","content":"参与智能简历筛选产品优化，整理模型测试结果和误判案例，完成竞品分析、功能评价报告和阶段汇报材料，并参与产品评审。"},{"title":"ResumeMind智能简历筛选系统（2025.03—2025.06）","content":"简历称基于Python搭建简历匹配分析原型，包含关键词提取、候选人标签、匹配排序和报告页面，代码已上传GitHub。"}]'),'985高校、高绩点、全国奖项与头部互联网实习形成较强技术光环。',json('["技术光环","竞赛经历","贡献待核验"]'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('material-1.0.0','B',2,'候选人 B','AI测评产品助理（实习生）','广东某普通本科高校',json('["应用心理学","实验室助理","用户研究","初创公司实习"]'),'应用心理学专业，实验助理、小型调研和教育科技实习经历较为朴素，覆盖问卷、访谈、数据清洗与报告优化。','广东某普通本科高校｜应用心理学专业（2022.09—2026.06），GPA 3.42/4.00，专业排名前28%。相关课程：心理统计、心理测量、实验心理学、社会调查方法。',json('["Excel","SPSS","Python基础","问卷设计","用户访谈","数据清洗","报告写作","Figma基础"]'),json('[{"title":"心理学实验室学生助理（2023.10—2024.06）","content":"协助招募被试、整理实验材料和记录任务流程，参与注意力任务、压力感知问卷及学习行为记录表的数据整理。"},{"title":"大学生学习压力与时间管理行为调研（2024.09—2025.01）","content":"参与问卷和访谈提纲设计，回收139份问卷和12份访谈记录，使用Excel和SPSS完成数据清洗、描述统计、相关分析及结果图表。"},{"title":"AI学习助手使用体验分析（2025.03—2025.06）","content":"负责用户访谈、竞品功能表和问题归类，参与制作用户旅程图、需求优先级表和产品分析报告。"},{"title":"某教育科技初创公司（2025.07—2025.09）","content":"整理学生学习行为数据和用户反馈，负责访谈转写、标签归类、基础数据清洗及周报撰写，参与测评报告模板优化。"}]'),'学校和成绩普通，经历以实验助理、小型调研和初创公司实习为主。',json('["心理测评","用户研究","报告解释"]'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('material-1.0.0','C',3,'候选人 C','AI测评产品助理（实习生）','华南某211高校',json('["211高校","产品运营实习","协会主席","省级一等奖"]'),'工商管理专业，知名平台实习、学生组织负责人和产品竞赛奖项突出；自述主导研究方案、数据分析与产品迭代。','华南某211高校｜工商管理专业（2022.09—2026.06），GPA 3.72/4.00，专业排名前12%。相关课程：市场调研、商业分析、消费者行为、产品管理。',json('["Excel","SQL基础","Tableau","Axure","竞品分析","用户调研","产品需求文档","PPT"]'),json('[{"title":"大学生创新创业协会主席（2023.09—2024.06）","content":"负责项目招募、活动策划和校企合作，组织产品训练营、创业分享会和项目路演共10场。"},{"title":"市场调查与分析大赛省级一等奖（2024.04）","content":"担任项目负责人，围绕大学生AI工具使用需求开展调查；简历称负责研究方案、数据分析、产品建议和答辩展示。"},{"title":"某知名本地生活平台产品运营实习生（2025.07—2025.10）","content":"参与商家服务后台优化，整理用户需求、竞品信息和运营数据，协助推动两项功能需求进入评审流程。"},{"title":"校园实习信息助手（2025.03—2025.06）","content":"担任5人团队负责人，完成用户调研、需求分析和产品路演，形成20页产品方案及高保真原型。"}]'),'重点高校、知名平台实习、学生组织负责人和产品竞赛奖项突出。',json('["产品光环","领导力","贡献待核验"]'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('material-1.0.0','D',4,'候选人 D','AI测评产品助理（实习生）','福建某省属大学',json('["数据助理","行为日志分析","Python与SQL","稳定交付"]'),'信息管理与信息系统专业，数据助理、在线学习行为日志与教育公司数据运营经历偏执行型，缺少显性光环。','福建某省属大学｜信息管理与信息系统专业（2022.09—2026.06），GPA 3.51/4.00，专业排名前22%。相关课程：数据库、统计分析、Python程序设计、信息系统分析。',json('["Excel","Python","SQL","SPSS基础","Power BI","数据清洗","数据字典","可视化"]'),json('[{"title":"学校信息化办公室学生数据助理（2023.10—2024.06）","content":"协助整理校园服务平台访问记录和问题反馈，维护数据表、问题分类标签及月度使用情况报告。"},{"title":"在线学习平台使用行为分析（2024.09—2025.01）","content":"整理约1.8万条脱敏行为日志，处理重复记录、缺失字段和异常停留时间，生成访问频次和页面路径统计。"},{"title":"某在线教育公司数据运营实习生（2025.07—2025.10）","content":"负责课程使用数据清洗、用户问题分类和周报更新，协助维护数据字典，并向产品团队提供异常记录和功能使用情况。"},{"title":"学生任务管理小程序数据看板（2025.03—2025.06）","content":"完成数据表设计、基础查询和Power BI看板制作，展示任务完成率、活跃时段和功能使用频次。"}]'),'学校与奖项不突出，经历以数据助理和执行型岗位为主。',json('["数据执行","行为日志","项目落地"]'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('material-1.0.0','E',5,'候选人 E','AI测评产品助理（实习生）','湖南某普通本科高校',json('["人力资源管理","就业中心助理","基础调研","稳定执行"]'),'人力资源管理专业，学校、成绩、技能和经历均处于中等水平，主要覆盖资料管理、基础统计和常规报告。','湖南某普通本科高校｜人力资源管理专业（2022.09—2026.06），GPA 3.50/4.00，专业排名前25%。相关课程：人才测评、组织行为学、管理统计、市场调查。',json('["Excel","SPSS基础","Power BI基础","问卷整理","用户反馈分类","PPT","报告写作"]'),json('[{"title":"学校就业指导中心学生助理（2023.10—2024.06）","content":"协助整理招聘会报名信息、毕业生就业问卷和企业反馈表，负责信息核对、表格更新和活动资料准备。"},{"title":"大学生实习满意度调查（2024.09—2025.01）","content":"参与问卷发放、数据录入和基础统计，使用Excel制作样本分布、满意度均值及年级比较图表。"},{"title":"某人力资源服务公司项目助理（2025.07—2025.09）","content":"负责候选人信息整理、客户反馈汇总、面试记录检查和周报制作，协助更新招聘项目进度表。"},{"title":"校园招聘信息服务改进方案（2025.03—2025.06）","content":"根据学生访谈和问卷结果整理常见问题，参与制作需求清单、服务流程图和12页改进建议报告。"}]'),'学校、成绩、技能和经历均处于中等水平。',json('["稳定中性","资料管理","常规报告"]'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

ALTER TABLE candidate_evidence_items ADD COLUMN updated_at TEXT;
UPDATE candidate_evidence_items SET updated_at = created_at WHERE updated_at IS NULL;

CREATE TABLE point_rules_stage10 (
  point_rule_version TEXT PRIMARY KEY CHECK (
    length(point_rule_version) BETWEEN 3 AND 64
    AND point_rule_version NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  source_point_rule_version TEXT,
  total_points INTEGER NOT NULL CHECK (total_points BETWEEN 1 AND 100),
  shallow_cost INTEGER NOT NULL CHECK (shallow_cost > 0),
  deep_cost INTEGER NOT NULL CHECK (deep_cost > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  validation_status TEXT NOT NULL CHECK (
    validation_status IN ('not_validated', 'valid', 'invalid', 'stale')
  ),
  validation_report_json TEXT NOT NULL CHECK (
    json_valid(validation_report_json) AND json_type(validation_report_json) = 'object'
  ),
  content_fingerprint TEXT CHECK (
    content_fingerprint IS NULL OR (length(content_fingerprint) = 64
      AND content_fingerprint = lower(content_fingerprint)
      AND content_fingerprint NOT GLOB '*[^0-9a-f]*')
  ),
  created_by_admin_user_id TEXT,
  updated_by_admin_user_id TEXT,
  published_by_admin_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  validated_at TEXT,
  published_at TEXT,
  FOREIGN KEY (source_point_rule_version) REFERENCES point_rules(point_rule_version) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (published_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  CHECK (shallow_cost <= total_points),
  CHECK (deep_cost <= total_points),
  CHECK (total_points >= shallow_cost + deep_cost),
  CHECK (status <> 'published' OR (content_fingerprint IS NOT NULL
    AND validation_status = 'valid' AND validated_at IS NOT NULL AND published_at IS NOT NULL))
);

INSERT INTO point_rules_stage10 (
  point_rule_version, display_name, source_point_rule_version,
  total_points, shallow_cost, deep_cost, status, revision_no,
  validation_status, validation_report_json, content_fingerprint,
  created_at, updated_at, validated_at, published_at
)
SELECT point_rule_version, '当前五点查证规则', NULL,
  total_points, shallow_cost, deep_cost, status, 1, 'valid',
  json('{"errors":[],"warnings":[]}'),
  'f34ad6968c94afc84b2266cbf1822c575726b8320529e3911cce37baf977f63c',
  created_at, created_at, created_at, created_at
FROM point_rules;
DROP TABLE point_rules;
ALTER TABLE point_rules_stage10 RENAME TO point_rules;

CREATE TABLE sunk_cost_rules_stage10 (
  sunk_cost_rule_version TEXT PRIMARY KEY CHECK (
    length(sunk_cost_rule_version) BETWEEN 3 AND 64
    AND sunk_cost_rule_version NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  source_sunk_cost_rule_version TEXT,
  trigger_remaining_sec INTEGER NOT NULL CHECK (trigger_remaining_sec > 0),
  minimum_candidate_investment INTEGER NOT NULL CHECK (minimum_candidate_investment >= 0),
  requires_key_risk INTEGER NOT NULL CHECK (requires_key_risk IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  validation_status TEXT NOT NULL CHECK (
    validation_status IN ('not_validated', 'valid', 'invalid', 'stale')
  ),
  validation_report_json TEXT NOT NULL CHECK (
    json_valid(validation_report_json) AND json_type(validation_report_json) = 'object'
  ),
  content_fingerprint TEXT CHECK (
    content_fingerprint IS NULL OR (length(content_fingerprint) = 64
      AND content_fingerprint = lower(content_fingerprint)
      AND content_fingerprint NOT GLOB '*[^0-9a-f]*')
  ),
  created_by_admin_user_id TEXT,
  updated_by_admin_user_id TEXT,
  published_by_admin_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  validated_at TEXT,
  published_at TEXT,
  FOREIGN KEY (source_sunk_cost_rule_version) REFERENCES sunk_cost_rules(sunk_cost_rule_version) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (published_by_admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  CHECK (status <> 'published' OR (content_fingerprint IS NOT NULL
    AND validation_status = 'valid' AND validated_at IS NOT NULL AND published_at IS NOT NULL))
);

INSERT INTO sunk_cost_rules_stage10 (
  sunk_cost_rule_version, display_name, source_sunk_cost_rule_version,
  trigger_remaining_sec, minimum_candidate_investment, requires_key_risk,
  status, revision_no, validation_status, validation_report_json,
  content_fingerprint, created_at, updated_at, validated_at, published_at
)
SELECT sunk_cost_rule_version, '当前沉没成本触发规则', NULL,
  trigger_remaining_sec, minimum_candidate_investment, requires_key_risk,
  status, 1, 'valid', json('{"errors":[],"warnings":[]}'),
  '051803f02aaea5ae2a051a98b13277fd1ccf002afc40b20b0c09710e228b5e30',
  created_at, created_at, created_at, created_at
FROM sunk_cost_rules;
DROP TRIGGER configuration_sets_sunk_rule_exists_insert;
DROP TRIGGER configuration_sets_sunk_rule_exists_update;
DROP TRIGGER sessions_sunk_rule_exists_insert;
DROP TRIGGER sessions_sunk_rule_immutable;
DROP TABLE sunk_cost_rules;
ALTER TABLE sunk_cost_rules_stage10 RENAME TO sunk_cost_rules;

CREATE TRIGGER configuration_sets_sunk_rule_exists_insert
BEFORE INSERT ON configuration_sets
WHEN NOT EXISTS (
  SELECT 1 FROM sunk_cost_rules
  WHERE sunk_cost_rule_version = NEW.sunk_cost_rule_version
)
BEGIN
  SELECT RAISE(ABORT, 'sunk cost rule does not exist');
END;

CREATE TRIGGER configuration_sets_sunk_rule_exists_update
BEFORE UPDATE OF sunk_cost_rule_version ON configuration_sets
WHEN NOT EXISTS (
  SELECT 1 FROM sunk_cost_rules
  WHERE sunk_cost_rule_version = NEW.sunk_cost_rule_version
)
BEGIN
  SELECT RAISE(ABORT, 'sunk cost rule does not exist');
END;

CREATE TRIGGER sessions_sunk_rule_exists_insert
BEFORE INSERT ON sessions
WHEN NOT EXISTS (
  SELECT 1 FROM sunk_cost_rules
  WHERE sunk_cost_rule_version = NEW.sunk_cost_rule_version
)
BEGIN
  SELECT RAISE(ABORT, 'sunk cost rule does not exist');
END;

CREATE TRIGGER sessions_sunk_rule_immutable
BEFORE UPDATE OF sunk_cost_rule_version ON sessions
WHEN NEW.sunk_cost_rule_version <> OLD.sunk_cost_rule_version
BEGIN
  SELECT RAISE(ABORT, 'session sunk cost rule is immutable');
END;

ALTER TABLE configuration_sets ADD COLUMN display_name TEXT;
ALTER TABLE configuration_sets ADD COLUMN source_config_set_id TEXT;
ALTER TABLE configuration_sets ADD COLUMN revision_no INTEGER;
ALTER TABLE configuration_sets ADD COLUMN validation_status TEXT;
ALTER TABLE configuration_sets ADD COLUMN validation_report_json TEXT;
ALTER TABLE configuration_sets ADD COLUMN config_fingerprint TEXT;
ALTER TABLE configuration_sets ADD COLUMN created_by_admin_user_id TEXT;
ALTER TABLE configuration_sets ADD COLUMN updated_by_admin_user_id TEXT;
ALTER TABLE configuration_sets ADD COLUMN published_by_admin_user_id TEXT;
ALTER TABLE configuration_sets ADD COLUMN activated_by_admin_user_id TEXT;
ALTER TABLE configuration_sets ADD COLUMN updated_at TEXT;
ALTER TABLE configuration_sets ADD COLUMN validated_at TEXT;
ALTER TABLE configuration_sets ADD COLUMN activated_at TEXT;

UPDATE configuration_sets SET
  display_name = CASE WHEN config_set_id = 'config-2026-07-v1'
    THEN '当前正式预实验配置' ELSE config_set_id END,
  revision_no = 1,
  validation_status = 'valid',
  validation_report_json = json('{"errors":[],"warnings":[{"code":"BENCHMARK_PROVISIONAL","path":"benchmarkVersion"},{"code":"NORMS_UNAVAILABLE","path":"normVersion"}]}'),
  config_fingerprint = 'b96f885d857970fcf75dfdd678db595c79fda2f67169bec8eb966f6a6eb169ef',
  updated_at = created_at,
  validated_at = COALESCE(published_at, created_at),
  activated_at = CASE WHEN is_active = 1 THEN COALESCE(published_at, created_at) ELSE NULL END;

CREATE TABLE configuration_validation_runs (
  validation_run_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN (
    'material_set', 'point_rule', 'sunk_cost_rule', 'configuration_set'
  )),
  target_version TEXT NOT NULL,
  target_revision INTEGER NOT NULL CHECK (target_revision >= 1),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'invalid')),
  errors_json TEXT NOT NULL CHECK (json_valid(errors_json) AND json_type(errors_json) = 'array'),
  warnings_json TEXT NOT NULL CHECK (json_valid(warnings_json) AND json_type(warnings_json) = 'array'),
  content_fingerprint TEXT NOT NULL CHECK (
    length(content_fingerprint) = 64
    AND content_fingerprint = lower(content_fingerprint)
    AND content_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  admin_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT
);

CREATE INDEX configuration_validation_target_idx
ON configuration_validation_runs (target_type, target_version, target_revision, created_at);

CREATE TABLE configuration_activation_history (
  activation_id TEXT PRIMARY KEY,
  config_set_id TEXT NOT NULL,
  previous_active_config_set_id TEXT,
  admin_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  FOREIGN KEY (config_set_id) REFERENCES configuration_sets(config_set_id) ON DELETE RESTRICT,
  FOREIGN KEY (previous_active_config_set_id) REFERENCES configuration_sets(config_set_id) ON DELETE RESTRICT,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT
);

CREATE INDEX configuration_activation_history_time_idx
ON configuration_activation_history (activated_at);

CREATE TABLE admin_operation_receipts (
  idempotency_key TEXT PRIMARY KEY CHECK (
    length(idempotency_key) = 36
    AND substr(idempotency_key, 9, 1) = '-'
    AND substr(idempotency_key, 14, 1) = '-'
    AND substr(idempotency_key, 19, 1) = '-'
    AND substr(idempotency_key, 24, 1) = '-'
    AND lower(replace(idempotency_key, '-', '')) NOT GLOB '*[^0-9a-f]*'
  ),
  admin_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 64 AND request_hash = lower(request_hash)
    AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  response_status INTEGER NOT NULL CHECK (response_status BETWEEN 200 AND 599),
  response_json TEXT NOT NULL CHECK (json_valid(response_json) AND json_type(response_json) = 'object'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT
);

CREATE INDEX admin_operation_receipts_admin_time_idx
ON admin_operation_receipts (admin_user_id, created_at);

DROP INDEX admin_audit_logs_time_idx;
DROP INDEX admin_audit_logs_user_time_idx;
DROP INDEX admin_audit_logs_action_time_idx;
DROP INDEX admin_audit_logs_outcome_time_idx;
DROP INDEX admin_audit_logs_session_terminal_once_idx;

CREATE TABLE admin_audit_logs_stage10 (
  audit_id TEXT PRIMARY KEY,
  admin_user_id TEXT,
  admin_session_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'admin_provisioned','admin_password_rotated','admin_login_success',
    'admin_login_failure','admin_login_rate_limited','admin_logout',
    'admin_session_revoked','admin_session_idle_expired',
    'admin_session_absolute_expired','admin_audit_logs_viewed',
    'material_set_created','material_set_updated','material_set_validated','material_set_published',
    'point_rule_created','point_rule_updated','point_rule_validated','point_rule_published',
    'sunk_cost_rule_created','sunk_cost_rule_updated','sunk_cost_rule_validated','sunk_cost_rule_published',
    'configuration_set_created','configuration_set_updated','configuration_set_validated',
    'configuration_set_published','configuration_set_activated','configuration_set_rollback_activated'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
  target_type TEXT,
  target_id TEXT,
  request_id TEXT NOT NULL,
  client_fingerprint_hash TEXT CHECK (
    client_fingerprint_hash IS NULL OR (
      length(client_fingerprint_hash) = 64
      AND client_fingerprint_hash = lower(client_fingerprint_hash)
      AND client_fingerprint_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (admin_session_id) REFERENCES admin_sessions(admin_session_id) ON DELETE RESTRICT
);

INSERT INTO admin_audit_logs_stage10 SELECT * FROM admin_audit_logs;
DROP TABLE admin_audit_logs;
ALTER TABLE admin_audit_logs_stage10 RENAME TO admin_audit_logs;

CREATE INDEX admin_audit_logs_time_idx ON admin_audit_logs (created_at);
CREATE INDEX admin_audit_logs_user_time_idx ON admin_audit_logs (admin_user_id, created_at);
CREATE INDEX admin_audit_logs_action_time_idx ON admin_audit_logs (action, created_at);
CREATE INDEX admin_audit_logs_outcome_time_idx ON admin_audit_logs (outcome, created_at);
CREATE UNIQUE INDEX admin_audit_logs_session_terminal_once_idx
ON admin_audit_logs (admin_session_id, action)
WHERE admin_session_id IS NOT NULL AND action IN (
  'admin_logout','admin_session_revoked','admin_session_idle_expired','admin_session_absolute_expired'
);

CREATE TRIGGER admin_audit_logs_no_update
BEFORE UPDATE ON admin_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'admin audit logs cannot be updated');
END;

CREATE TRIGGER admin_audit_logs_no_delete
BEFORE DELETE ON admin_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'admin audit logs cannot be deleted');
END;

CREATE TRIGGER material_sets_published_no_update
BEFORE UPDATE ON material_sets
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published material sets are immutable');
END;

CREATE TRIGGER material_sets_published_no_delete
BEFORE DELETE ON material_sets
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published material sets cannot be deleted');
END;

CREATE TRIGGER candidate_material_profiles_published_no_insert
BEFORE INSERT ON candidate_material_profiles
WHEN EXISTS (SELECT 1 FROM material_sets m WHERE m.material_version = NEW.material_version AND m.status = 'published')
BEGIN
  SELECT RAISE(ABORT, 'published material profiles are immutable');
END;

CREATE TRIGGER candidate_material_profiles_published_no_update
BEFORE UPDATE ON candidate_material_profiles
WHEN EXISTS (SELECT 1 FROM material_sets m WHERE m.material_version = OLD.material_version AND m.status = 'published')
BEGIN
  SELECT RAISE(ABORT, 'published material profiles are immutable');
END;

CREATE TRIGGER candidate_material_profiles_published_no_delete
BEFORE DELETE ON candidate_material_profiles
WHEN EXISTS (SELECT 1 FROM material_sets m WHERE m.material_version = OLD.material_version AND m.status = 'published')
BEGIN
  SELECT RAISE(ABORT, 'published material profiles are immutable');
END;

CREATE TRIGGER candidate_evidence_material_exists_insert
BEFORE INSERT ON candidate_evidence_items
WHEN NOT EXISTS (SELECT 1 FROM material_sets m WHERE m.material_version = NEW.material_version)
BEGIN
  SELECT RAISE(ABORT, 'material set does not exist');
END;

CREATE TRIGGER candidate_evidence_published_no_insert
BEFORE INSERT ON candidate_evidence_items
WHEN EXISTS (SELECT 1 FROM material_sets m WHERE m.material_version = NEW.material_version AND m.status = 'published')
BEGIN
  SELECT RAISE(ABORT, 'published material evidence is immutable');
END;

CREATE TRIGGER candidate_evidence_published_no_update
BEFORE UPDATE ON candidate_evidence_items
WHEN EXISTS (SELECT 1 FROM material_sets m WHERE m.material_version = OLD.material_version AND m.status = 'published')
BEGIN
  SELECT RAISE(ABORT, 'published material evidence is immutable');
END;

CREATE TRIGGER candidate_evidence_published_no_delete
BEFORE DELETE ON candidate_evidence_items
WHEN EXISTS (SELECT 1 FROM material_sets m WHERE m.material_version = OLD.material_version AND m.status = 'published')
BEGIN
  SELECT RAISE(ABORT, 'published material evidence is immutable');
END;

CREATE TRIGGER point_rules_published_no_update
BEFORE UPDATE ON point_rules
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published point rules are immutable');
END;

CREATE TRIGGER point_rules_published_no_delete
BEFORE DELETE ON point_rules
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published point rules cannot be deleted');
END;

CREATE TRIGGER sunk_cost_rules_published_no_update
BEFORE UPDATE ON sunk_cost_rules
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published sunk cost rules are immutable');
END;

CREATE TRIGGER sunk_cost_rules_published_no_delete
BEFORE DELETE ON sunk_cost_rules
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published sunk cost rules cannot be deleted');
END;

CREATE TRIGGER configuration_sets_published_content_no_update
BEFORE UPDATE OF task_version, material_version, point_rule_version,
  sunk_cost_rule_version, scoring_version, benchmark_version, norm_version,
  display_name, source_config_set_id, revision_no, config_fingerprint
ON configuration_sets
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published configuration sets are immutable');
END;

CREATE TRIGGER configuration_validation_runs_no_update
BEFORE UPDATE ON configuration_validation_runs
BEGIN
  SELECT RAISE(ABORT, 'configuration validation runs are immutable');
END;

CREATE TRIGGER configuration_validation_runs_no_delete
BEFORE DELETE ON configuration_validation_runs
BEGIN
  SELECT RAISE(ABORT, 'configuration validation runs cannot be deleted');
END;

CREATE TRIGGER configuration_activation_history_no_update
BEFORE UPDATE ON configuration_activation_history
BEGIN
  SELECT RAISE(ABORT, 'configuration activation history is immutable');
END;

CREATE TRIGGER configuration_activation_history_no_delete
BEFORE DELETE ON configuration_activation_history
BEGIN
  SELECT RAISE(ABORT, 'configuration activation history cannot be deleted');
END;

CREATE TRIGGER admin_operation_receipts_no_update
BEFORE UPDATE ON admin_operation_receipts
BEGIN
  SELECT RAISE(ABORT, 'administrator operation receipts are immutable');
END;

CREATE TRIGGER admin_operation_receipts_no_delete
BEFORE DELETE ON admin_operation_receipts
BEGIN
  SELECT RAISE(ABORT, 'administrator operation receipts cannot be deleted');
END;

PRAGMA foreign_keys = ON;

UPDATE app_metadata
SET value = '10', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
