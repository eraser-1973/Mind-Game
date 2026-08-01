export function FormalT1CompletePanel({ expired = false }: { expired?: boolean }) {
  return (
    <main className="research-screen" data-testid={expired ? 'formal-game-expired' : 'formal-t1-complete'}>
      <section className="research-card">
        <span className="eyebrow">{expired ? 'TIME WINDOW CLOSED' : 'T1 COMPLETE'}</span>
        <h1>{expired ? '\u672c\u8f6e\u65f6\u95f4\u5df2\u7ed3\u675f' : '\u521d\u8bc4\u5df2\u5c01\u5b58'}</h1>
        <p className="research-card__lead">
          {expired
            ? '\u672c\u8f6e\u65f6\u95f4\u5df2\u7ed3\u675f\uff0c\u6700\u7ec8\u51b3\u7b56\u529f\u80fd\u5c06\u5728\u540e\u7eed\u9636\u6bb5\u63a5\u5165\u3002'
            : '\u521d\u8bc4\u6570\u636e\u5df2\u5b89\u5168\u4fdd\u5b58\u3002\u670d\u52a1\u5668\u67e5\u8bc1\u4e0e\u70b9\u6570\u8d26\u672c\u5c06\u5728\u4e0b\u4e00\u9636\u6bb5\u63a5\u5165\u3002'}
        </p>
      </section>
    </main>
  )
}
