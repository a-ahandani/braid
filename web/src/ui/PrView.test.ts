// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { markdown } from './PrView'

describe('pull request markdown', () => {
  it('keeps formatting and links but strips scripts, handlers, styles and images', () => {
    const html = markdown(
      [
        '**bold** and [docs](https://example.com/docs)',
        '<script>alert(1)</script>',
        '<img src="https://tracker.example/pixel.gif" onerror="alert(2)">',
        '<a href="javascript:alert(3)">click</a>',
        '<p style="position:fixed" onclick="alert(4)">styled</p>',
        '<iframe src="https://evil.example"></iframe>',
      ].join('\n\n'),
    )
    const box = document.createElement('div')
    box.innerHTML = html
    expect(box.querySelector('strong')?.textContent).toBe('bold')
    const link = box.querySelector('a[href="https://example.com/docs"]')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noreferrer')
    expect(box.querySelector('script, img, iframe, [style], [onclick], [onerror]')).toBeNull()
    expect(html).not.toMatch(/javascript:|alert\(/)
  })
})
