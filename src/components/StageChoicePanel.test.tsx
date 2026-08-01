import { create, act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StageChoicePanel } from './StageChoicePanel'
import { candidates } from '../data/candidates'

let renderer: ReactTestRenderer | undefined
afterEach(() => renderer?.unmount())

describe('StageChoicePanel', () => {
  it('requires an explicit candidate and an interacted confidence control', () => {
    renderer = create(<StageChoicePanel candidates={candidates} pending={false} onSubmit={vi.fn()} />)
    const submit = renderer.root.findByProps({ 'data-testid': 'submit-t1-stage-choice' })
    expect(submit.props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'data-testid': 't1-confidence-value' }).children).toEqual(['0'])
    expect(renderer.root.findByProps({ 'data-testid': 't1-confidence' }).props['data-touched']).toBe('false')
  })

  it('accepts confidence zero only after actual slider interaction', () => {
    const onSubmit = vi.fn()
    renderer = create(<StageChoicePanel candidates={candidates} pending={false} onSubmit={onSubmit} />)
    act(() => renderer!.root.findByProps({ 'data-candidate-id': 'B' }).props.onClick())
    expect(renderer.root.findByProps({ 'data-testid': 'submit-t1-stage-choice' }).props.disabled).toBe(true)
    act(() => renderer!.root.findByProps({ 'data-testid': 't1-confidence' }).props.onChange({ target: { value: '0' } }))
    const submit = renderer.root.findByProps({ 'data-testid': 'submit-t1-stage-choice' })
    expect(submit.props.disabled).toBe(false)
    act(() => submit.props.onClick())
    expect(onSubmit).toHaveBeenCalledWith('B', 0)
  })

  it('shows one neutral selected card and prevents duplicate clicks while pending', () => {
    renderer = create(<StageChoicePanel candidates={candidates} pending={false} onSubmit={vi.fn()} />)
    act(() => renderer!.root.findByProps({ 'data-candidate-id': 'D' }).props.onClick())
    expect(renderer.root.findByProps({ 'data-candidate-id': 'D' }).props['aria-pressed']).toBe(true)
    expect(renderer.root.findByProps({ 'data-candidate-id': 'A' }).props['aria-pressed']).toBe(false)
    act(() => renderer!.update(<StageChoicePanel candidates={candidates} pending onSubmit={vi.fn()} />))
    expect(renderer.root.findByProps({ 'data-testid': 'submit-t1-stage-choice' }).props.disabled).toBe(true)
  })
})
