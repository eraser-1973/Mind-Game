import type {
  DemographicData,
  StateAssessmentData,
  StateAssessmentId,
  TaskExperienceId,
} from '../types/game'

export const informedConsentTitle =
  '《压力情境下招聘决策游戏测评》参与知情同意书'

export const informedConsentParagraphs = [
  '您好！感谢您参与本研究。本项目旨在通过模拟招聘决策任务，探索个体在复杂信息环境的信息处理与决策行为特点，并用于优化游戏化测评系统的设计。',
  '参与本研究，您将完成一个模拟招聘任务，包括候选人信息查看、资料查证、评价调整以及最终选择等环节，整个过程预计需要15–20分钟。',
  '本研究采用匿名化数据处理方式。系统不会收集您的姓名、联系方式等能够直接识别个人身份的信息。您的参与数据将通过随机生成的编号进行记录，仅用于研究分析、系统优化和学术展示。',
  '参与本研究完全基于自愿原则。任务过程中您可以随时退出，不会产生任何不利影响。由于任务包含时间限制和模拟决策情境，过程中可能产生轻微紧张感，但不存在明显风险。',
]

export const demographicOptions = {
  ageRange: ['18–20', '21–23', '24及以上', '不愿透露'],
  gender: ['男', '女', '其他', '不愿透露'],
  education: ['本科', '硕士', '其他', '不愿透露'],
  grade: ['大一', '大二', '大三', '大四', '研究生', '不愿透露'],
  majorCategory: [
    '心理学',
    '计算机或人工智能',
    '经管',
    '理工科',
    '人文社科',
    '其他',
    '不愿透露',
  ],
  relatedExperience: [
    '企业实习经历',
    '学生科研经历',
    '数据分析相关经历',
    '招聘或人才评估相关经历',
    '无相关经历',
  ],
} as const

export const defaultDemographics: DemographicData = {
  ageRange: '不愿透露',
  gender: '不愿透露',
  education: '不愿透露',
  grade: '不愿透露',
  majorCategory: '不愿透露',
  relatedExperience: ['无相关经历'],
}

export const stateAssessmentItems: Array<{
  id: StateAssessmentId
  label: string
}> = [
  {
    id: 'stress',
    label: '此刻，我感到紧张或有压力。',
  },
  {
    id: 'fatigue',
    label: '此刻，我感到身心疲劳。',
  },
  {
    id: 'attention',
    label: '此刻，我能够集中注意力完成接下来的任务。',
  },
  {
    id: 'mood',
    label: '此刻，我的整体情绪状态是：',
  },
  {
    id: 'physicalDiscomfort',
    label: '此刻，我感到身体不适，例如头痛、恶心、疼痛或其他不舒服。',
  },
]

export const defaultStateAssessment: StateAssessmentData = {
  stress: 5,
  fatigue: 5,
  attention: 5,
  mood: 5,
  physicalDiscomfort: 5,
}

export const taskExperienceGroups: Array<{
  title: string
  items: Array<{
    id: TaskExperienceId
    label: string
    min: 0 | 1
    max: 10
  }>
}> = [
  {
    title: '时间压力',
    items: [
      {
        id: 'timePressure1',
        label: '我感到完成任务的时间比较紧张。',
        min: 1,
        max: 10,
      },
      {
        id: 'timePressure2',
        label: '为了在规定时间内完成任务，我需要加快阅读和判断速度。',
        min: 1,
        max: 10,
      },
    ],
  },
  {
    title: '资源限制压力',
    items: [
      {
        id: 'resourceLimit1',
        label: '有限的查证点数限制了我能够获取的信息。',
        min: 1,
        max: 10,
      },
      {
        id: 'resourceLimit2',
        label: '我需要谨慎决定将查证点数使用在哪些候选人身上。',
        min: 1,
        max: 10,
      },
    ],
  },
  {
    title: '社会评价压力',
    items: [
      {
        id: 'socialEvaluation1',
        label: '任务中的HR评价信息让我感到自己的表现正在被评价。',
        min: 1,
        max: 10,
      },
      {
        id: 'socialEvaluation2',
        label: '我会担心自己的判断是否能够得到认可。',
        min: 1,
        max: 10,
      },
    ],
  },
  {
    title: '最终结果责任',
    items: [
      {
        id: 'outcomeResponsibility1',
        label: '我认为最终录用结果取决于我的判断。',
        min: 1,
        max: 10,
      },
      {
        id: 'outcomeResponsibility2',
        label: '在提交最终选择时，我感到自己需要为选择结果负责。',
        min: 1,
        max: 10,
      },
    ],
  },
  {
    title: '不可控感',
    items: [
      {
        id: 'uncontrollability1',
        label: '任务过程中存在一些我难以完全控制的因素。',
        min: 1,
        max: 10,
      },
      {
        id: 'uncontrollability2',
        label: '即使我认真完成任务，也不一定能够获得理想结果。',
        min: 1,
        max: 10,
      },
    ],
  },
  {
    title: '认知负荷与任务难度',
    items: [
      {
        id: 'cognitiveLoad1',
        label: '同时比较多名候选人的信息需要投入较多心理努力。',
        min: 1,
        max: 10,
      },
      {
        id: 'cognitiveLoad2',
        label: '在任务过程中，我需要同时记住和权衡较多信息。',
        min: 1,
        max: 10,
      },
      {
        id: 'cognitiveLoad3',
        label: '我认为本次招聘决策任务具有一定难度。',
        min: 1,
        max: 10,
      },
      {
        id: 'cognitiveLoad4',
        label: '候选人之间的比较让我难以迅速作出判断。',
        min: 1,
        max: 10,
      },
    ],
  },
  {
    title: '最终决策信心',
    items: [
      {
        id: 'decisionConfidence',
        label: '我对自己最终选择的候选人有信心。',
        min: 0,
        max: 10,
      },
    ],
  },
]

export const defaultTaskExperience = Object.fromEntries(
  taskExperienceGroups.flatMap((group) =>
    group.items.map((item) => [
      item.id,
      item.min === 0 ? 5 : 6,
    ]),
  ),
) as Record<TaskExperienceId, number>
