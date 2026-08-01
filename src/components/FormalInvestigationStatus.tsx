export function FormalInvestigationStatus({
  kind,
}: {
  kind: 't2-complete-no-deep' | 't3-complete'
}) {
  const message = kind === 't3-complete'
    ? '查证与重评数据已安全保存，最终录用将在下一阶段接入。'
    : '浅度核验与 T2 选择已安全保存。当前可进入最终决策，但最终录用接口将在下一阶段接入。'
  return (
    <main className="research-screen formal-stage-stop" data-testid={`formal-${kind}`}>
      <section className="research-card">
        <span className="eyebrow">FORMAL ASSESSMENT · STAGE 5</span>
        <h1>阶段数据已保存</h1>
        <p className="research-card__lead">{message}</p>
      </section>
    </main>
  )
}
