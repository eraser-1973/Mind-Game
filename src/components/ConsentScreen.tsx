import { useState } from 'react'
import {
  informedConsentParagraphs,
  informedConsentTitle,
} from '../data/researchFlow'

type Props = {
  onAccept: () => void
  onExit: () => void
}

export function ConsentScreen({
  onAccept,
  onExit,
}: Props) {
  const [checked, setChecked] = useState(false)

  return (
    <main className="research-screen">
      <section className="research-card research-card--wide">
        <span className="eyebrow">FORMAL RESEARCH FLOW</span>
        <h1>{informedConsentTitle}</h1>
        <div className="consent-copy">
          {informedConsentParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <label className="consent-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>我已阅读并理解上述说明，并自愿参与本研究。</span>
        </label>
        <div className="research-actions">
          <button className="button button--ghost" onClick={onExit}>
            退出
          </button>
          <button
            className="button button--primary"
            disabled={!checked}
            onClick={onAccept}
          >
            开始任务
          </button>
        </div>
        <p className="privacy-note">
          正式测评会收集您主动填写的姓名、学号或手机号；系统不要求邮箱，也不会将身份内容写入浏览器游戏记录。请在确认理解后自愿选择是否参与。
        </p>
      </section>
    </main>
  )
}
