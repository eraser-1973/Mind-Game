import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultDemographics } from '../data/researchFlow'
import { createResearchData } from '../utils/researchData'
import { ConsentScreen } from './ConsentScreen'
import { DemographicForm } from './DemographicForm'
import { StateAssessmentScreen } from './StateAssessmentScreen'
import { TaskExperienceScreen } from './TaskExperienceScreen'

describe('research flow screens', () => {
  it('renders the informed consent copy and keeps start disabled by default', () => {
    const research = createResearchData(new Date('2026-07-26T00:00:00.000Z'))
    const html = renderToStaticMarkup(
      <ConsentScreen
        participantId={research.participantId}
        onAccept={() => undefined}
        onExit={() => undefined}
      />,
    )

    expect(html).toContain('参与知情同意书')
    expect(html).toContain('我已阅读并理解上述说明，并自愿参与本研究。')
    expect(html).toContain('姓名、手机号、邮箱、学号、IP')
    expect(html).toContain('disabled=""')
  })

  it('renders anonymous demographic options including non-disclosure choices', () => {
    const html = renderToStaticMarkup(
      <DemographicForm
        initialValue={defaultDemographics}
        onBack={() => undefined}
        onSubmit={() => undefined}
      />,
    )

    expect(html).toContain('基本信息登记（匿名）')
    expect(html).toContain('18–20')
    expect(html).toContain('不愿透露')
    expect(html).toContain('招聘或人才评估相关经历')
    expect(html).not.toContain('姓名')
  })

  it('renders before and after state assessment with 0 to 10 anchors', () => {
    const before = renderToStaticMarkup(
      <StateAssessmentScreen
        title="当前状态评估"
        phase="before"
        onSubmit={() => undefined}
      />,
    )
    const after = renderToStaticMarkup(
      <StateAssessmentScreen
        title="任务后状态评估"
        phase="after"
        onSubmit={() => undefined}
      />,
    )

    expect(before).toContain('当前状态评估')
    expect(before).toContain('0=完全没有')
    expect(before).toContain('10=非常强烈')
    expect(after).toContain('任务后状态评估')
    expect(after).toContain('此刻，我感到身心疲劳。')
  })

  it('renders all manipulation-check groups and decision confidence', () => {
    const html = renderToStaticMarkup(
      <TaskExperienceScreen
        onBack={() => undefined}
        onSubmit={() => undefined}
      />,
    )

    expect(html).toContain('任务体验与压力操纵检验')
    expect(html).toContain('时间压力')
    expect(html).toContain('资源限制压力')
    expect(html).toContain('社会评价压力')
    expect(html).toContain('最终结果责任')
    expect(html).toContain('不可控感')
    expect(html).toContain('认知负荷与任务难度')
    expect(html).toContain('我对自己最终选择的候选人有信心。')
  })
})
