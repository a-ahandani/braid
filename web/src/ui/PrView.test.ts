// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { firstLine, githubHtml, hunkLines, markdown } from './PrView'

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

describe('pull request html from GitHub', () => {
  const clean = (html: string) => {
    const box = document.createElement('div')
    box.innerHTML = githubHtml(html, '')
    return box
  }

  it('shows media from GitHub hosts, with video controls and no referrer', () => {
    const box = clean(
      [
        '<img src="https://private-user-images.githubusercontent.com/1/a.png?jwt=x">',
        '<img src="https://camo.githubusercontent.com/abc">',
        '<img class="emoji" src="https://github.githubassets.com/images/icons/emoji/shipit.png">',
        '<video src="https://github.com/user-attachments/assets/b" autoplay muted loop poster="https://evil.example/p.png" style="width:1px"></video>',
      ].join(''),
    )
    expect(box.querySelectorAll('img')).toHaveLength(3)
    expect(box.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(box.querySelector('img.emoji')).not.toBeNull()
    const video = box.querySelector('video')!
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.getAttribute('preload')).toBe('metadata')
    for (const a of ['autoplay', 'muted', 'loop', 'poster', 'style']) expect(video.hasAttribute(a)).toBe(false)
  })

  it('drops media from anywhere else, so tracking pixels never load', () => {
    const box = clean(
      [
        '<img src="https://tracker.example/pixel.gif">',
        '<img src="https://github.com.tracker.example/pixel.gif">',
        '<img src="https://evilgithubusercontent.com/pixel.gif">',
        '<img src="http://camo.githubusercontent.com/insecure">',
        '<img src="data:image/gif;base64,R0lGOD">',
        '<img src="https://camo.githubusercontent.com/ok" srcset="https://tracker.example/2x.gif 2x">',
        '<video src="https://tracker.example/v.mp4"></video>',
        '<picture><source srcset="https://tracker.example/s.gif"></picture>',
        '<table background="https://tracker.example/b.gif"><tr><td>x</td></tr></table>',
      ].join(''),
    )
    expect(box.querySelectorAll('img')).toHaveLength(1)
    expect(box.querySelector('video, source')).toBeNull()
    expect(box.innerHTML).not.toContain('tracker.example')
  })

  it('still strips scripts, and keeps only the classes it styles', () => {
    const box = clean('<script>alert(1)</script><div class="overlay"><span class="pl-k notranslate">const</span><svg><path></path></svg></div><a href="https://github.com/o/r/pull/1">#1</a>')
    expect(box.querySelector('script, svg, .overlay, .notranslate')).toBeNull()
    expect(box.querySelector('.pl-k')?.textContent).toBe('const')
    expect(box.querySelector('a')?.getAttribute('target')).toBe('_blank')
  })
})

describe('code a review comment is about', () => {
  const hunk = '@@ -69,5 +69,6 @@ func checkHost() {\n }\n \n-// old line\n+// new line\n+// second line\n var tokens = x'

  it('numbers the lines and marks the commented one, which ends the hunk', () => {
    const lines = hunkLines(hunk, 1)
    expect(lines.map((l) => [l.kind, l.n, l.target])).toEqual([
      ['ctx', 69, false],
      ['ctx', 70, false],
      ['del', 71, false],
      ['add', 71, false],
      ['add', 72, false],
      ['ctx', 73, true],
    ])
    expect(lines[5].text).toBe('var tokens = x')
  })

  it('keeps the tail, and every line of a multi-line comment', () => {
    expect(hunkLines(hunk, 1, 2).map((l) => l.n)).toEqual([72, 73])
    expect(hunkLines(hunk, 3, 2).map((l) => l.target)).toEqual([true, true, true])
  })

  it('skips the no-newline marker and has nothing to show for a file comment', () => {
    expect(hunkLines('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b', 1).map((l) => l.text)).toEqual(['a', 'b'])
    expect(hunkLines('', 1)).toEqual([])
  })
})

describe('one-line preview of a bot comment', () => {
  it('skips markup and empty lines', () => {
    expect(firstLine('<!-- bot -->\n\n## **Coverage** report\nmore')).toBe('Coverage report')
    expect(firstLine('---')).toBe('')
  })
})
