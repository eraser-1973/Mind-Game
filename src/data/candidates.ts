import type { Candidate } from '../types/game'

export const candidates: Candidate[] = [
  {
    id: 'A',
    name: '顾言澈',
    role: '产品运营培训生',
    school: '东江大学',
    visibleHalo: ['重点高校', '学生会主席', '全国创新赛金奖'],
    resumeSummary:
      '组织过三场校级创新活动，自述主导校园服务小程序并负责核心代码，擅长资源协调与公开表达。',
    shallowEvidence: {
      title: '贡献边界模糊',
      content:
        '团队周报显示其主要负责路演与对外联络；两名组员对“核心功能由谁完成”的描述与简历不一致。',
      isNegative: true,
    },
    deepEvidence: {
      title: '代码来源核验',
      content:
        '现场讲解时无法说明关键模块；仓库大段提交与公开模板高度一致，个人原创贡献约占四成。',
      isNegative: true,
    },
    trueAbility: 45,
    trueFit: 42,
    isToxic: true,
    riskFlags: ['夸大个人贡献', '技术证据不连贯'],
    tags: ['高光简历', '表达强', '证据风险'],
  },
  {
    id: 'B',
    name: '林若航',
    role: '数据分析培训生',
    school: '南岭理工大学',
    visibleHalo: ['知名平台远程实习', '三项商业分析奖', '推荐信亮眼'],
    resumeSummary:
      '称在大二期间远程参与增长分析项目，独立搭建周报模型并将转化率提升 18%。',
    shallowEvidence: {
      title: '时间线存在冲突',
      content:
        '实习所列固定会议时间与连续八周必修课签到记录重叠，项目参与强度需要进一步确认。',
      isNegative: true,
    },
    deepEvidence: {
      title: '材料模板化',
      content:
        '推荐信与同批申请者内容高度相似；企业导师确认其主要完成数据清洗，未负责归因模型。',
      isNegative: true,
    },
    trueAbility: 50,
    trueFit: 48,
    isToxic: true,
    riskFlags: ['经历时间冲突', '成果归属夸大'],
    tags: ['大厂光环', '奖项密集', '材料风险'],
  },
  {
    id: 'C',
    name: '周予安',
    role: '前端开发培训生',
    school: '海州科技学院',
    visibleHalo: ['课程项目连续', '个人仓库活跃'],
    resumeSummary:
      '奖项不多，连续四学期迭代同一套校园预约系统，记录了性能优化、无障碍改造和用户反馈。',
    shallowEvidence: {
      title: '过程记录完整',
      content:
        '提交历史跨越 16 个月，问题单、版本说明与课程节点吻合，能看到从失败方案到重构的过程。',
      isNegative: false,
    },
    deepEvidence: {
      title: '现场能力验证',
      content:
        '在限定时间内定位并修复状态同步问题，同时解释了取舍、回归测试和上线风险。',
      isNegative: false,
    },
    trueAbility: 88,
    trueFit: 91,
    isToxic: false,
    riskFlags: ['大型团队经验较少'],
    tags: ['真实仓库', '持续迭代', '技术扎实'],
  },
  {
    id: 'D',
    name: '沈知微',
    role: '项目协调培训生',
    school: '青川学院',
    visibleHalo: ['跨专业协作', '稳定交付'],
    resumeSummary:
      '无大型竞赛经历，长期担任课程团队协调人，保留会议纪要、风险清单和项目复盘。',
    shallowEvidence: {
      title: '协作记录稳定',
      content:
        '三段项目中同伴反馈高度一致：能提前暴露阻塞、明确责任边界，并按时关闭遗留问题。',
      isNegative: false,
    },
    deepEvidence: {
      title: '复盘能力证明',
      content:
        '压力情境中主动拆分事实与假设，提出两套低成本验证方案，并清楚说明失败后的止损点。',
      isNegative: false,
    },
    trueAbility: 82,
    trueFit: 87,
    isToxic: false,
    riskFlags: ['公开表达偏谨慎'],
    tags: ['协作稳定', '复盘清晰', '风险意识'],
  },
  {
    id: 'E',
    name: '许明川',
    role: '综合运营培训生',
    school: '宁海商学院',
    visibleHalo: ['校内实践', '材料完整'],
    resumeSummary:
      '参与社团招新与校园商店调研，经历描述基本清楚，但项目规模和方法深度相对有限。',
    shallowEvidence: {
      title: '事实基本吻合',
      content:
        '活动记录与指导老师反馈一致，主要承担问卷整理与执行协调，成果中规中矩。',
      isNegative: false,
    },
    deepEvidence: {
      title: '能力上限有限',
      content:
        '能完成常规任务，但面对模糊数据时依赖现成模板，独立提出分析框架的能力一般。',
      isNegative: false,
    },
    trueAbility: 65,
    trueFit: 66,
    isToxic: false,
    riskFlags: ['复杂问题经验有限'],
    tags: ['材料真实', '执行稳定', '中性干扰'],
  },
]

export const candidateById = Object.fromEntries(
  candidates.map((candidate) => [candidate.id, candidate]),
) as Record<string, Candidate>
