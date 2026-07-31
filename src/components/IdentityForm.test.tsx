import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { FormalIdentityInput } from '../types/game'
import { IdentityForm } from './IdentityForm'

function event(value: string) {
  return { target: { value } }
}

function submitEvent() {
  return { preventDefault: () => undefined }
}

function findInput(renderer: ReactTestRenderer, name: string) {
  return renderer.root.find(
    (node) => node.type === 'input' && node.props.name === name,
  )
}

function findSubmit(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (node) => node.type === 'button' && node.props.type === 'submit',
  )
}

describe('IdentityForm', () => {
  it('starts empty and disabled with the at-least-one-field notice', () => {
    const renderer = create(
      <IdentityForm onBack={() => undefined} onSubmit={async () => undefined} />,
    )

    expect(JSON.stringify(renderer.toJSON())).toContain(
      '姓名、学号、手机号至少填写一项。',
    )
    expect(findSubmit(renderer).props.disabled).toBe(true)
  })

  it.each([
    ['fullName', 'Only Name'],
    ['studentId', 'ONLY-001'],
    ['phone', '+4930123456'],
  ])('accepts one valid %s value and submits only in memory', async (name, value) => {
    const onSubmit = vi.fn(
      async (_identity: FormalIdentityInput) => undefined,
    )
    const renderer = create(
      <IdentityForm onBack={() => undefined} onSubmit={onSubmit} />,
    )

    act(() => findInput(renderer, name).props.onChange(event(value)))
    expect(findSubmit(renderer).props.disabled).toBe(false)
    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit(submitEvent())
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ [name]: value })
  })

  it('shows a local phone error and keeps submit disabled', () => {
    const renderer = create(
      <IdentityForm onBack={() => undefined} onSubmit={async () => undefined} />,
    )

    act(() => findInput(renderer, 'phone').props.onChange(event('bad-phone')))

    expect(JSON.stringify(renderer.toJSON())).toContain('手机号格式不正确')
    expect(findSubmit(renderer).props.disabled).toBe(true)
  })

  it('disables the button while the request is pending', async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => {
      resolve = done
    })
    const renderer = create(
      <IdentityForm onBack={() => undefined} onSubmit={() => pending} />,
    )
    act(() =>
      findInput(renderer, 'studentId').props.onChange(event('PENDING-001')),
    )

    act(() => {
      void renderer.root.findByType('form').props.onSubmit(submitEvent())
    })
    expect(findSubmit(renderer).props.disabled).toBe(true)
    expect(JSON.stringify(renderer.toJSON())).toContain('正在创建正式会话')

    await act(async () => resolve())
  })

  it('retains the entered value and offers retry feedback after an API failure', async () => {
    const renderer = create(
      <IdentityForm
        onBack={() => undefined}
        onSubmit={async () => {
          throw new Error('暂时无法创建实验会话，请重试。')
        }}
      />,
    )
    act(() => findInput(renderer, 'fullName').props.onChange(event('Keep In Memory')))

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit(submitEvent())
    })

    expect(findInput(renderer, 'fullName').props.value).toBe('Keep In Memory')
    expect(JSON.stringify(renderer.toJSON())).toContain(
      '暂时无法创建实验会话，请重试。',
    )
    expect(findSubmit(renderer).props.disabled).toBe(false)
  })
})
