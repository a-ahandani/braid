for (const b of document.querySelectorAll('[data-copy]')) {
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy)
      b.textContent = 'Copied'
    } catch {
      b.textContent = 'Press ⌘C'
    }
    setTimeout(() => (b.textContent = 'Copy'), 1600)
  })
}

const video = document.getElementById('video')
const pause = document.getElementById('toggle')
const buttons = [...document.querySelectorAll('#chapters button')]
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
let index = 0

function show(i, play) {
  index = (i + buttons.length) % buttons.length
  const name = buttons[index].dataset.video
  buttons.forEach((b, n) => {
    b.setAttribute('aria-current', String(n === index))
    b.style.setProperty('--progress', '0%')
  })
  video.poster = `videos/${name}.jpg`
  video.src = `videos/${name}.mp4`
  if (play) video.play().catch(() => {})
  updatePause()
}

function updatePause() {
  pause.textContent = video.paused ? 'Play' : 'Pause'
  pause.setAttribute('aria-label', video.paused ? 'Play the video' : 'Pause the video')
}

buttons.forEach((b, i) => b.addEventListener('click', () => show(i, true)))
video.addEventListener('ended', () => show(index + 1, true))
video.addEventListener('timeupdate', () => {
  if (video.duration) buttons[index].style.setProperty('--progress', `${(video.currentTime / video.duration) * 100}%`)
})
video.addEventListener('play', updatePause)
video.addEventListener('pause', updatePause)
pause.addEventListener('click', () => (video.paused ? video.play() : video.pause()))

show(0, !calm)
