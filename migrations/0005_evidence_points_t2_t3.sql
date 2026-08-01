CREATE TABLE point_rules (
  point_rule_version TEXT PRIMARY KEY,
  total_points INTEGER NOT NULL CHECK (total_points > 0),
  shallow_cost INTEGER NOT NULL CHECK (shallow_cost > 0),
  deep_cost INTEGER NOT NULL CHECK (deep_cost > 0),
  status TEXT NOT NULL CHECK (status IN ('published', 'retired')),
  created_at TEXT NOT NULL,
  CHECK (shallow_cost <= total_points),
  CHECK (deep_cost <= total_points)
);

INSERT INTO point_rules (
  point_rule_version, total_points, shallow_cost, deep_cost, status, created_at
) VALUES (
  'points-5-v1', 5, 1, 3, 'published',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TABLE candidate_evidence_items (
  material_version TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  evidence_level TEXT NOT NULL CHECK (evidence_level IN ('shallow', 'deep')),
  item_order INTEGER NOT NULL CHECK (item_order >= 1),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  polarity TEXT NOT NULL CHECK (polarity IN ('positive', 'negative')),
  is_key_risk INTEGER NOT NULL CHECK (is_key_risk IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (material_version, evidence_id),
  UNIQUE (material_version, candidate_id, evidence_level, item_order)
);

CREATE INDEX candidate_evidence_lookup_idx
ON candidate_evidence_items (material_version, candidate_id, evidence_level);

INSERT INTO candidate_evidence_items (
  material_version, evidence_id, candidate_id, evidence_level, item_order,
  title, content, polarity, is_key_risk, created_at
) VALUES
('material-1.0.0', 'A-t2-1', 'A', 'shallow', 1, '竞赛证书与项目仓库', '竞赛证书真实，候选人位于5人团队名单中，但未标注具体分工。GitHub仓库真实存在，主要代码集中在项目结束前两天上传。README功能介绍较完整，但缺少早期版本、调试记录和算法细节。', 'negative', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'A-t2-2', 'A', 'shallow', 2, '实习证明与成果摘要', '实习证明、时间和岗位信息与简历一致。候选人提交竞品分析表、测试结果汇总表和12页阶段汇报PPT。材料能够证明其参与项目，但无法确认模型开发和需求设计的独立贡献。', 'negative', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'A-t3-1', 'A', 'deep', 1, '竞赛分工与团队反馈', '官方记录显示，队长负责研究方案与模型设计，另一成员负责核心代码。候选人主要负责原始数据整理、展示页面内容、PPT制作和答辩准备。团队负责人确认其未参与核心算法模块开发。', 'negative', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'A-t3-2', 'A', 'deep', 2, '实习任务与技术成果核验', '实习周报显示其主要按模板汇总测试数据、整理错误案例和制作评审PPT。未发现独立用户访谈、测评任务设计或模型开发记录。核心代码与公开项目结构高度相似，仓库未注明来源，候选人无法完整解释实现过程。', 'negative', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'B-t2-1', 'B', 'shallow', 1, '调研报告与数据文件', '报告共28页，包含问卷结构、访谈提纲、样本情况、结果与讨论。139份问卷中保留126份有效数据，并记录答题过短、连续同选项等剔除标准。SPSS文件包含变量设置、描述统计和相关分析结果。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'B-t2-2', 'B', 'shallow', 2, '实习证明与工作记录', '实习证明、时间和岗位信息与简历一致。周报显示其持续负责访谈归类、用户反馈标签和报告模板修改。工作以基础分析和研究支持为主，暂无复杂建模记录。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'B-t3-1', 'B', 'deep', 1, '原始材料与个人贡献核验', '问卷编号、访谈编号与报告中的样本描述能够对应。候选人负责访谈提纲、数据清洗、结果图表和讨论初稿。访谈记录存在“任务拖延”“时间估计偏差”等编码，报告保留多轮修改记录。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'B-t3-2', 'B', 'deep', 2, '实习导师与成果反馈', '导师确认其按时完成数据和反馈整理。候选人提出将用户行为分为选择路径、页面停留、修改次数和自评变化，该分类被用于内部报告模板；导师认为其适合行为指标整理和结果解释工作。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'C-t2-1', 'C', 'shallow', 1, '实习证明与产品文件', '实习证明和岗位信息真实。候选人出现在两份产品评审会议纪要中，提交过竞品功能表、用户问题清单和阶段汇报PPT，但未明确其独立分析范围。', 'negative', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'C-t2-2', 'C', 'shallow', 2, '竞赛报告与产品原型', '竞赛团队确实获得省级一等奖。报告包含样本描述、图表和产品建议，校园实习助手原型可正常展示；两份材料均未清晰标注团队成员的具体分工。', 'negative', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'C-t3-1', 'C', 'deep', 1, '实习任务与数据分析核验', '周报显示其主要负责会议纪要、竞品汇总、模板化周报和需求状态跟进。核心数据分析由运营分析同事完成，候选人主要将结论整理为PPT。两项需求进入评审，但未实际上线。', 'negative', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'C-t3-2', 'C', 'deep', 2, '竞赛分工与团队反馈', '问卷和数据分析由统计专业成员负责，原型由设计成员完成。候选人主要负责进度协调、报告整合和答辩。团队认可其组织能力，但“负责研究方案和数据分析”的表述高于实际贡献。', 'negative', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'D-t2-1', 'D', 'shallow', 1, '行为日志与数据处理文件', '日志文件包含约1.8万条脱敏记录。清洗表明确标注重复值、缺失字段和异常停留时间。Python脚本可完成合并、筛选和基础统计，分析以描述性结果为主。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'D-t2-2', 'D', 'shallow', 2, '实习周报与数据字典', '周报连续记录10周工作内容。数据字典包含字段名称、含义、格式和异常规则。文件版本与提交时间连续，能反映稳定维护过程。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'D-t3-1', 'D', 'deep', 1, '任务记录与独立贡献核验', '清洗脚本和数据字典由候选人独立维护，能够解释异常停留时间、重复账号和缺失记录的处理方式。产品团队曾使用其数据定位一次课程页面加载异常。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'D-t3-2', 'D', 'deep', 2, '实习导师反馈', '导师评价其数据处理细致、交付稳定，能快速理解明确任务。候选人会主动记录口径变化和异常问题。用户访谈与测评理论经验较少，但适合行为日志分析和产品数据支持岗位。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'E-t2-1', 'E', 'shallow', 1, '调查数据与课程报告', '调查数据和报告真实存在。候选人负责数据录入、基础清洗和图表制作。分析以频数、均值和简单分组比较为主，未独立设计问卷。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'E-t2-2', 'E', 'shallow', 2, '实习记录与工作成果', '实习证明和周报信息一致，能够按时维护候选人表格和项目进度。客户反馈分类清晰，工作以常规执行和资料管理为主。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'E-t3-1', 'E', 'deep', 1, '项目分工与成果核验', '访谈由团队共同完成，候选人主要负责问题汇总、流程图和报告排版。其“按招聘阶段分类常见问题”的建议被保留在最终报告中。未发现明显贡献夸大或材料不一致。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('material-1.0.0', 'E-t3-2', 'E', 'deep', 2, '实习导师反馈', '导师评价其工作认真，资料错误率较低，能够稳定完成明确任务，Excel和报告能力达到日常要求。面对复杂数据分析和独立研究任务时仍需要指导。', 'positive', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE evidence_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL CHECK (candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  evidence_level TEXT NOT NULL CHECK (evidence_level IN ('shallow', 'deep')),
  rating_stage TEXT NOT NULL CHECK (
    (evidence_level = 'shallow' AND rating_stage = 'T2')
    OR (evidence_level = 'deep' AND rating_stage = 'T3')
  ),
  material_version TEXT NOT NULL,
  point_rule_version TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL CHECK (
    json_valid(evidence_ids_json)
    AND json_type(evidence_ids_json) = 'array'
    AND json_array_length(evidence_ids_json) > 0
  ),
  points_before INTEGER NOT NULL CHECK (points_before >= 0),
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  points_after INTEGER NOT NULL CHECK (points_after >= 0),
  contains_key_risk INTEGER NOT NULL CHECK (contains_key_risk IN (0, 1)),
  client_at TEXT NOT NULL,
  server_at TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (point_rule_version) REFERENCES point_rules(point_rule_version) ON DELETE RESTRICT,
  CHECK (points_after = points_before - points_cost),
  UNIQUE (session_id, candidate_id, evidence_level),
  UNIQUE (session_id, sequence_no)
);

CREATE INDEX evidence_events_session_sequence_idx
ON evidence_events (session_id, sequence_no);

CREATE INDEX evidence_events_session_candidate_idx
ON evidence_events (session_id, candidate_id);

CREATE TABLE evidence_event_items (
  event_id TEXT NOT NULL,
  material_version TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  item_order INTEGER NOT NULL CHECK (item_order >= 1),
  PRIMARY KEY (event_id, evidence_id),
  FOREIGN KEY (event_id) REFERENCES evidence_events(event_id) ON DELETE CASCADE,
  FOREIGN KEY (material_version, evidence_id)
    REFERENCES candidate_evidence_items(material_version, evidence_id) ON DELETE RESTRICT
);

CREATE TABLE point_ledger (
  ledger_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (reason = 'evidence_unlock'),
  candidate_id TEXT CHECK (candidate_id IS NULL OR candidate_id IN ('A', 'B', 'C', 'D', 'E')),
  evidence_level TEXT CHECK (evidence_level IS NULL OR evidence_level IN ('shallow', 'deep')),
  points_before INTEGER NOT NULL CHECK (points_before >= 0),
  points_delta INTEGER NOT NULL CHECK (points_delta < 0),
  points_after INTEGER NOT NULL CHECK (points_after >= 0),
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES evidence_events(event_id) ON DELETE CASCADE,
  CHECK (points_after = points_before + points_delta),
  UNIQUE (session_id, sequence_no)
);

CREATE INDEX point_ledger_session_sequence_idx
ON point_ledger (session_id, sequence_no);

CREATE INDEX point_ledger_session_created_idx
ON point_ledger (session_id, created_at);

CREATE TRIGGER evidence_events_no_update
BEFORE UPDATE ON evidence_events
BEGIN
  SELECT RAISE(ABORT, 'evidence events cannot be updated');
END;

CREATE TRIGGER evidence_event_items_no_update
BEFORE UPDATE ON evidence_event_items
BEGIN
  SELECT RAISE(ABORT, 'evidence event items cannot be updated');
END;

CREATE TRIGGER point_ledger_no_update
BEFORE UPDATE ON point_ledger
BEGIN
  SELECT RAISE(ABORT, 'point ledger entries cannot be updated');
END;

ALTER TABLE game_events RENAME TO game_events_v4;

CREATE TABLE game_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'game_start', 'rating_submit', 'stage_choice_submit',
      'evidence_unlock', 'timer_expired'
    )
  ),
  candidate_id TEXT CHECK (
    candidate_id IS NULL OR candidate_id IN ('A', 'B', 'C', 'D', 'E')
  ),
  stage TEXT CHECK (
    stage IS NULL OR stage IN ('T1', 'T1_COMPLETE', 'T2', 'T3', 'DECISION', 'final')
  ),
  client_sequence INTEGER CHECK (
    client_sequence IS NULL OR client_sequence >= 0
  ),
  server_sequence INTEGER NOT NULL CHECK (server_sequence >= 1),
  client_at TEXT NOT NULL,
  server_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json) = 'object'
  ),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  UNIQUE (session_id, server_sequence)
);

INSERT INTO game_events (
  event_id, session_id, event_type, candidate_id, stage, client_sequence,
  server_sequence, client_at, server_at, payload_json
)
SELECT event_id, session_id, event_type, candidate_id, stage, client_sequence,
  server_sequence, client_at, server_at, payload_json
FROM game_events_v4;

DROP TABLE game_events_v4;

CREATE INDEX game_events_session_sequence_idx
ON game_events (session_id, server_sequence);

UPDATE app_metadata
SET value = '5',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
