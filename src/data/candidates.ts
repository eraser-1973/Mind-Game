import type {
  Candidate,
  CandidateDimensionScores,
  CandidateDimensionId,
} from '../types/game'

export const AI_ASSESSMENT_PRODUCT_ASSISTANT_BRIEF = {
  title: 'AI测评产品助理（实习生）',
  background:
    '我们正在开发一款面向大学生的在线测评产品，通过问卷、任务表现和用户行为数据，为用户生成个性化分析报告。现招聘一名产品助理，协助完成用户研究、数据整理、功能测试及结果报告等工作。',
  responsibilities: [
    '协助整理问卷、用户反馈及平台行为数据，检查缺失、重复和异常记录。',
    '参与用户访谈、产品测试和需求整理，归纳使用过程中出现的主要问题。',
    '配合产品和研究人员推进项目任务，及时记录进度、修改意见和数据口径。',
    '将调研与数据结果整理为图表、分析报告或产品建议，支持团队讨论和决策。',
  ],
  requirements: [
    '本科在读或应届毕业生，心理学、信息管理、统计、计算机、工商管理、人力资源等相关专业均可。',
    '能够使用Excel，并了解SPSS、Python、SQL或可视化工具中的一种或多种。',
    '有课程项目、调研、实验、产品、运营或数据整理经历。',
    '做事细致，能够在规定时间内完成资料整理、问题分析和结果汇报。',
    '能够清晰说明自己在项目中的具体任务和实际成果。',
  ],
  playerTask:
    '你将作为项目组的招聘负责人，从5名候选人中选出1名最适合“AI测评产品助理”岗位的人选。请结合岗位职责、候选人的教育背景、技能和项目经历进行判断；后续可查阅补充材料，对实际工作内容和岗位匹配度进一步了解。不同候选人各有优势和不足，请根据全部信息作出综合判断。',
} as const

export const CANDIDATE_DIMENSION_WEIGHTS: Record<
  CandidateDimensionId,
  number
> = {
  dataAnalysis: 0.25,
  userResearch: 0.2,
  productExecution: 0.15,
  reportExpression: 0.15,
  toolApplication: 0.15,
  authenticity: 0.1,
}

export const CANDIDATE_DIMENSION_LABELS: Record<
  CandidateDimensionId,
  string
> = {
  dataAnalysis: '数据整理与基础分析能力',
  userResearch: '测评设计与用户研究能力',
  productExecution: '产品理解与任务执行能力',
  reportExpression: '结果解释与报告表达能力',
  toolApplication: '工具与技术应用能力',
  authenticity: '经历真实性与贡献清晰度',
}

export function calculateCandidateBaselineScore(
  scores: CandidateDimensionScores,
): number {
  return Math.round(
    (Object.keys(CANDIDATE_DIMENSION_WEIGHTS) as CandidateDimensionId[])
      .reduce(
        (total, key) =>
          total +
          scores[key] *
            CANDIDATE_DIMENSION_WEIGHTS[key] *
            20,
        0,
      ),
  )
}

const evidence = (
  id: string,
  title: string,
  content: string,
  polarity: 'positive' | 'negative',
) => ({
  id,
  title,
  content,
  polarity,
  isNegative: polarity === 'negative',
})

export const candidates: Candidate[] = [
  {
    id: 'A',
    name: '候选人 A',
    role: AI_ASSESSMENT_PRODUCT_ASSISTANT_BRIEF.title,
    school: '华东某985高校',
    visibleHalo: ['985高校', 'GPA 3.86/4.00', '全国二等奖', '头部互联网实习'],
    resumeSummary:
      '计算机科学与技术专业，成绩与竞赛、互联网实习经历突出；简历自述参与简历匹配模型、数据处理与系统实现。',
    education:
      '华东某985高校｜计算机科学与技术专业（2022.09—2026.06），GPA 3.86/4.00，专业排名前8%。相关课程：机器学习、数据结构、数据库系统、数据可视化。',
    skills: ['Python', 'Excel', 'SQL', '机器学习基础', '数据可视化', '产品需求分析', 'Axure', 'PPT'],
    experiences: [
      { title: '学院学生会科技部部长（2023.09—2024.06）', content: '负责活动策划、嘉宾沟通、宣传材料和现场执行，组织AI工具分享会、程序设计训练营和创新创业讲座共8场。' },
      { title: '人工智能创新应用挑战赛全国二等奖（2024.05）', content: '项目为“基于简历文本的岗位匹配评分系统”；简历称担任核心成员，参与模型设计、数据处理、系统实现和答辩展示。' },
      { title: '某头部互联网公司AI产品实习生（2025.07—2025.09）', content: '参与智能简历筛选产品优化，整理模型测试结果和误判案例，完成竞品分析、功能评价报告和阶段汇报材料，并参与产品评审。' },
      { title: 'ResumeMind智能简历筛选系统（2025.03—2025.06）', content: '简历称基于Python搭建简历匹配分析原型，包含关键词提取、候选人标签、匹配排序和报告页面，代码已上传GitHub。' },
    ],
    initialImage: '985高校、高绩点、全国奖项与头部互联网实习形成较强技术光环。',
    trueStrengths: '基础数据整理、测试结果汇总、报告制作和展示表达能力较好。',
    mainShortcomings: '核心技术贡献被夸大，缺少独立测评设计与用户研究经验。',
    shallowEvidence: [
      evidence('A-t2-1', '竞赛证书与项目仓库', '竞赛证书真实，候选人位于5人团队名单中，但未标注具体分工。GitHub仓库真实存在，主要代码集中在项目结束前两天上传。README功能介绍较完整，但缺少早期版本、调试记录和算法细节。', 'negative'),
      evidence('A-t2-2', '实习证明与成果摘要', '实习证明、时间和岗位信息与简历一致。候选人提交竞品分析表、测试结果汇总表和12页阶段汇报PPT。材料能够证明其参与项目，但无法确认模型开发和需求设计的独立贡献。', 'negative'),
    ],
    deepEvidence: [
      evidence('A-t3-1', '竞赛分工与团队反馈', '官方记录显示，队长负责研究方案与模型设计，另一成员负责核心代码。候选人主要负责原始数据整理、展示页面内容、PPT制作和答辩准备。团队负责人确认其未参与核心算法模块开发。', 'negative'),
      evidence('A-t3-2', '实习任务与技术成果核验', '实习周报显示其主要按模板汇总测试数据、整理错误案例和制作评审PPT。未发现独立用户访谈、测评任务设计或模型开发记录。核心代码与公开项目结构高度相似，仓库未注明来源，候选人无法完整解释实现过程。', 'negative'),
    ],
    dimensionScores: { dataAnalysis: 4, userResearch: 2, productExecution: 2, reportExpression: 3, toolApplication: 2, authenticity: 1 },
    baselineFitScore: 51,
    expectedScoreRanges: { T1: [80, 88], T2: [68, 75], T3: [48, 58] },
    expectedUpdate: 'down',
    trueAbility: 51,
    trueFit: 51,
    isToxic: true,
    riskFlags: ['核心贡献夸大', '代码来源未说明', '缺少独立测评设计证据'],
    tags: ['技术光环', '竞赛经历', '贡献待核验'],
  },
  {
    id: 'B',
    name: '候选人 B',
    role: AI_ASSESSMENT_PRODUCT_ASSISTANT_BRIEF.title,
    school: '广东某普通本科高校',
    visibleHalo: ['应用心理学', '实验室助理', '用户研究', '初创公司实习'],
    resumeSummary:
      '应用心理学专业，实验助理、小型调研和教育科技实习经历较为朴素，覆盖问卷、访谈、数据清洗与报告优化。',
    education:
      '广东某普通本科高校｜应用心理学专业（2022.09—2026.06），GPA 3.42/4.00，专业排名前28%。相关课程：心理统计、心理测量、实验心理学、社会调查方法。',
    skills: ['Excel', 'SPSS', 'Python基础', '问卷设计', '用户访谈', '数据清洗', '报告写作', 'Figma基础'],
    experiences: [
      { title: '心理学实验室学生助理（2023.10—2024.06）', content: '协助招募被试、整理实验材料和记录任务流程，参与注意力任务、压力感知问卷及学习行为记录表的数据整理。' },
      { title: '大学生学习压力与时间管理行为调研（2024.09—2025.01）', content: '参与问卷和访谈提纲设计，回收139份问卷和12份访谈记录，使用Excel和SPSS完成数据清洗、描述统计、相关分析及结果图表。' },
      { title: 'AI学习助手使用体验分析（2025.03—2025.06）', content: '负责用户访谈、竞品功能表和问题归类，参与制作用户旅程图、需求优先级表和产品分析报告。' },
      { title: '某教育科技初创公司（2025.07—2025.09）', content: '整理学生学习行为数据和用户反馈，负责访谈转写、标签归类、基础数据清洗及周报撰写，参与测评报告模板优化。' },
    ],
    initialImage: '学校和成绩普通，经历以实验助理、小型调研和初创公司实习为主。',
    trueStrengths: '测评研究、数据整理、用户反馈分析和报告解释能力与岗位高度匹配。',
    mainShortcomings: 'Python和复杂建模能力有限。',
    shallowEvidence: [
      evidence('B-t2-1', '调研报告与数据文件', '报告共28页，包含问卷结构、访谈提纲、样本情况、结果与讨论。139份问卷中保留126份有效数据，并记录答题过短、连续同选项等剔除标准。SPSS文件包含变量设置、描述统计和相关分析结果。', 'positive'),
      evidence('B-t2-2', '实习证明与工作记录', '实习证明、时间和岗位信息与简历一致。周报显示其持续负责访谈归类、用户反馈标签和报告模板修改。工作以基础分析和研究支持为主，暂无复杂建模记录。', 'positive'),
    ],
    deepEvidence: [
      evidence('B-t3-1', '原始材料与个人贡献核验', '问卷编号、访谈编号与报告中的样本描述能够对应。候选人负责访谈提纲、数据清洗、结果图表和讨论初稿。访谈记录存在“任务拖延”“时间估计偏差”等编码，报告保留多轮修改记录。', 'positive'),
      evidence('B-t3-2', '实习导师与成果反馈', '导师确认其按时完成数据和反馈整理。候选人提出将用户行为分为选择路径、页面停留、修改次数和自评变化，该分类被用于内部报告模板；导师认为其适合行为指标整理和结果解释工作。', 'positive'),
    ],
    dimensionScores: { dataAnalysis: 4, userResearch: 5, productExecution: 4, reportExpression: 5, toolApplication: 3, authenticity: 5 },
    baselineFitScore: 86,
    expectedScoreRanges: { T1: [60, 68], T2: [72, 79], T3: [82, 90] },
    expectedUpdate: 'up',
    trueAbility: 86,
    trueFit: 86,
    isToxic: false,
    riskFlags: ['Python与复杂建模能力有限'],
    tags: ['心理测评', '用户研究', '报告解释'],
  },
  {
    id: 'C',
    name: '候选人 C',
    role: AI_ASSESSMENT_PRODUCT_ASSISTANT_BRIEF.title,
    school: '华南某211高校',
    visibleHalo: ['211高校', '产品运营实习', '协会主席', '省级一等奖'],
    resumeSummary:
      '工商管理专业，知名平台实习、学生组织负责人和产品竞赛奖项突出；自述主导研究方案、数据分析与产品迭代。',
    education:
      '华南某211高校｜工商管理专业（2022.09—2026.06），GPA 3.72/4.00，专业排名前12%。相关课程：市场调研、商业分析、消费者行为、产品管理。',
    skills: ['Excel', 'SQL基础', 'Tableau', 'Axure', '竞品分析', '用户调研', '产品需求文档', 'PPT'],
    experiences: [
      { title: '大学生创新创业协会主席（2023.09—2024.06）', content: '负责项目招募、活动策划和校企合作，组织产品训练营、创业分享会和项目路演共10场。' },
      { title: '市场调查与分析大赛省级一等奖（2024.04）', content: '担任项目负责人，围绕大学生AI工具使用需求开展调查；简历称负责研究方案、数据分析、产品建议和答辩展示。' },
      { title: '某知名本地生活平台产品运营实习生（2025.07—2025.10）', content: '参与商家服务后台优化，整理用户需求、竞品信息和运营数据，协助推动两项功能需求进入评审流程。' },
      { title: '校园实习信息助手（2025.03—2025.06）', content: '担任5人团队负责人，完成用户调研、需求分析和产品路演，形成20页产品方案及高保真原型。' },
    ],
    initialImage: '重点高校、知名平台实习、学生组织负责人和产品竞赛奖项突出。',
    trueStrengths: '沟通协调、竞品整理、汇报展示和常规产品执行能力较好。',
    mainShortcomings: '将团队协作和材料整合包装为主导产品迭代，数据分析与用户研究能力有限。',
    shallowEvidence: [
      evidence('C-t2-1', '实习证明与产品文件', '实习证明和岗位信息真实。候选人出现在两份产品评审会议纪要中，提交过竞品功能表、用户问题清单和阶段汇报PPT，但未明确其独立分析范围。', 'negative'),
      evidence('C-t2-2', '竞赛报告与产品原型', '竞赛团队确实获得省级一等奖。报告包含样本描述、图表和产品建议，校园实习助手原型可正常展示；两份材料均未清晰标注团队成员的具体分工。', 'negative'),
    ],
    deepEvidence: [
      evidence('C-t3-1', '实习任务与数据分析核验', '周报显示其主要负责会议纪要、竞品汇总、模板化周报和需求状态跟进。核心数据分析由运营分析同事完成，候选人主要将结论整理为PPT。两项需求进入评审，但未实际上线。', 'negative'),
      evidence('C-t3-2', '竞赛分工与团队反馈', '问卷和数据分析由统计专业成员负责，原型由设计成员完成。候选人主要负责进度协调、报告整合和答辩。团队认可其组织能力，但“负责研究方案和数据分析”的表述高于实际贡献。', 'negative'),
    ],
    dimensionScores: { dataAnalysis: 3, userResearch: 2, productExecution: 4, reportExpression: 4, toolApplication: 3, authenticity: 2 },
    baselineFitScore: 60,
    expectedScoreRanges: { T1: [76, 84], T2: [70, 76], T3: [56, 64] },
    expectedUpdate: 'down',
    trueAbility: 60,
    trueFit: 60,
    isToxic: true,
    riskFlags: ['成果包装明显', '数据分析贡献有限', '研究设计贡献有限'],
    tags: ['产品光环', '领导力', '贡献待核验'],
  },
  {
    id: 'D',
    name: '候选人 D',
    role: AI_ASSESSMENT_PRODUCT_ASSISTANT_BRIEF.title,
    school: '福建某省属大学',
    visibleHalo: ['数据助理', '行为日志分析', 'Python与SQL', '稳定交付'],
    resumeSummary:
      '信息管理与信息系统专业，数据助理、在线学习行为日志与教育公司数据运营经历偏执行型，缺少显性光环。',
    education:
      '福建某省属大学｜信息管理与信息系统专业（2022.09—2026.06），GPA 3.51/4.00，专业排名前22%。相关课程：数据库、统计分析、Python程序设计、信息系统分析。',
    skills: ['Excel', 'Python', 'SQL', 'SPSS基础', 'Power BI', '数据清洗', '数据字典', '可视化'],
    experiences: [
      { title: '学校信息化办公室学生数据助理（2023.10—2024.06）', content: '协助整理校园服务平台访问记录和问题反馈，维护数据表、问题分类标签及月度使用情况报告。' },
      { title: '在线学习平台使用行为分析（2024.09—2025.01）', content: '整理约1.8万条脱敏行为日志，处理重复记录、缺失字段和异常停留时间，生成访问频次和页面路径统计。' },
      { title: '某在线教育公司数据运营实习生（2025.07—2025.10）', content: '负责课程使用数据清洗、用户问题分类和周报更新，协助维护数据字典，并向产品团队提供异常记录和功能使用情况。' },
      { title: '学生任务管理小程序数据看板（2025.03—2025.06）', content: '完成数据表设计、基础查询和Power BI看板制作，展示任务完成率、活跃时段和功能使用频次。' },
    ],
    initialImage: '学校与奖项不突出，经历以数据助理和执行型岗位为主。',
    trueStrengths: '数据清洗、行为日志处理、工具应用和持续交付能力扎实。',
    mainShortcomings: '心理测评理论和独立用户研究经验弱于候选人B。',
    shallowEvidence: [
      evidence('D-t2-1', '行为日志与数据处理文件', '日志文件包含约1.8万条脱敏记录。清洗表明确标注重复值、缺失字段和异常停留时间。Python脚本可完成合并、筛选和基础统计，分析以描述性结果为主。', 'positive'),
      evidence('D-t2-2', '实习周报与数据字典', '周报连续记录10周工作内容。数据字典包含字段名称、含义、格式和异常规则。文件版本与提交时间连续，能反映稳定维护过程。', 'positive'),
    ],
    deepEvidence: [
      evidence('D-t3-1', '任务记录与独立贡献核验', '清洗脚本和数据字典由候选人独立维护，能够解释异常停留时间、重复账号和缺失记录的处理方式。产品团队曾使用其数据定位一次课程页面加载异常。', 'positive'),
      evidence('D-t3-2', '实习导师反馈', '导师评价其数据处理细致、交付稳定，能快速理解明确任务。候选人会主动记录口径变化和异常问题。用户访谈与测评理论经验较少，但适合行为日志分析和产品数据支持岗位。', 'positive'),
    ],
    dimensionScores: { dataAnalysis: 5, userResearch: 3, productExecution: 4, reportExpression: 4, toolApplication: 4, authenticity: 5 },
    baselineFitScore: 83,
    expectedScoreRanges: { T1: [63, 72], T2: [74, 80], T3: [80, 87] },
    expectedUpdate: 'up',
    trueAbility: 83,
    trueFit: 83,
    isToxic: false,
    riskFlags: ['独立用户研究经验较少', '测评理论经验较少'],
    tags: ['数据执行', '行为日志', '项目落地'],
  },
  {
    id: 'E',
    name: '候选人 E',
    role: AI_ASSESSMENT_PRODUCT_ASSISTANT_BRIEF.title,
    school: '湖南某普通本科高校',
    visibleHalo: ['人力资源管理', '就业中心助理', '基础调研', '稳定执行'],
    resumeSummary:
      '人力资源管理专业，学校、成绩、技能和经历均处于中等水平，主要覆盖资料管理、基础统计和常规报告。',
    education:
      '湖南某普通本科高校｜人力资源管理专业（2022.09—2026.06），GPA 3.50/4.00，专业排名前25%。相关课程：人才测评、组织行为学、管理统计、市场调查。',
    skills: ['Excel', 'SPSS基础', 'Power BI基础', '问卷整理', '用户反馈分类', 'PPT', '报告写作'],
    experiences: [
      { title: '学校就业指导中心学生助理（2023.10—2024.06）', content: '协助整理招聘会报名信息、毕业生就业问卷和企业反馈表，负责信息核对、表格更新和活动资料准备。' },
      { title: '大学生实习满意度调查（2024.09—2025.01）', content: '参与问卷发放、数据录入和基础统计，使用Excel制作样本分布、满意度均值及年级比较图表。' },
      { title: '某人力资源服务公司项目助理（2025.07—2025.09）', content: '负责候选人信息整理、客户反馈汇总、面试记录检查和周报制作，协助更新招聘项目进度表。' },
      { title: '校园招聘信息服务改进方案（2025.03—2025.06）', content: '根据学生访谈和问卷结果整理常见问题，参与制作需求清单、服务流程图和12页改进建议报告。' },
    ],
    initialImage: '学校、成绩、技能和经历均处于中等水平。',
    trueStrengths: '能够稳定完成基础工作，资料管理和常规报告能力合格。',
    mainShortcomings: '缺少突出成果、复杂分析和独立研究设计经验。',
    shallowEvidence: [
      evidence('E-t2-1', '调查数据与课程报告', '调查数据和报告真实存在。候选人负责数据录入、基础清洗和图表制作。分析以频数、均值和简单分组比较为主，未独立设计问卷。', 'positive'),
      evidence('E-t2-2', '实习记录与工作成果', '实习证明和周报信息一致，能够按时维护候选人表格和项目进度。客户反馈分类清晰，工作以常规执行和资料管理为主。', 'positive'),
    ],
    deepEvidence: [
      evidence('E-t3-1', '项目分工与成果核验', '访谈由团队共同完成，候选人主要负责问题汇总、流程图和报告排版。其“按招聘阶段分类常见问题”的建议被保留在最终报告中。未发现明显贡献夸大或材料不一致。', 'positive'),
      evidence('E-t3-2', '实习导师反馈', '导师评价其工作认真，资料错误率较低，能够稳定完成明确任务，Excel和报告能力达到日常要求。面对复杂数据分析和独立研究任务时仍需要指导。', 'positive'),
    ],
    dimensionScores: { dataAnalysis: 3, userResearch: 3, productExecution: 4, reportExpression: 4, toolApplication: 3, authenticity: 5 },
    baselineFitScore: 70,
    expectedScoreRanges: { T1: [67, 73], T2: [68, 74], T3: [68, 74] },
    expectedUpdate: 'stable',
    trueAbility: 70,
    trueFit: 70,
    isToxic: false,
    riskFlags: ['复杂数据分析经验有限', '独立研究设计经验有限'],
    tags: ['稳定中性', '资料管理', '常规报告'],
  },
]

for (const candidate of candidates) {
  if (
    calculateCandidateBaselineScore(candidate.dimensionScores) !==
    candidate.baselineFitScore
  ) {
    throw new Error(`候选人 ${candidate.id} 的六维评分与基准分不一致`)
  }
}

export const candidateById = Object.fromEntries(
  candidates.map((candidate) => [candidate.id, candidate]),
) as Record<string, Candidate>
