type Props = {
  username: string
  password: string
  submitting: boolean
  error: string | null
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => Promise<void>
}

export function AdminLoginScreen(props: Props) {
  return (
    <main className="admin-shell" data-testid="admin-login-screen">
      <section className="admin-login-card">
        <span className="eyebrow">SECURE ADMIN CHANNEL</span>
        <h1>管理员登录</h1>
        <p>使用已离线初始化的唯一管理员账号登录。</p>
        <form
          className="admin-login-form"
          onSubmit={(event) => {
            event.preventDefault()
            void props.onSubmit()
          }}
        >
          <label>
            <span>用户名</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              value={props.username}
              onChange={(event) => props.onUsernameChange(event.currentTarget.value)}
              disabled={props.submitting}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={props.password}
              onChange={(event) => props.onPasswordChange(event.currentTarget.value)}
              disabled={props.submitting}
            />
          </label>
          {props.error && <p className="admin-form-error" role="alert">{props.error}</p>}
          <button className="button button--primary" type="submit" disabled={props.submitting}>
            {props.submitting ? '正在验证…' : '登录'}
          </button>
        </form>
      </section>
    </main>
  )
}
