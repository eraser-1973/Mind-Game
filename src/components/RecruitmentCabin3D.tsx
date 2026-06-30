export function RecruitmentCabin3D() {
  return (
    <div className="cabin-scene" aria-hidden="true">
      <div className="cabin-grid" />
      <div className="cabin-console cabin-console--left">
        <span>A</span>
        <span>B</span>
      </div>
      <div className="cabin-core">
        <div className="cabin-core__ring" />
        <div className="cabin-core__mark">HR</div>
      </div>
      <div className="cabin-console cabin-console--right">
        <span>C</span>
        <span>D</span>
        <span>E</span>
      </div>
      <div className="cabin-horizon" />
    </div>
  )
}
