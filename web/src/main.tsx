import { Buffer } from 'buffer'
import { render } from 'preact'
import './styles.css'
import { App } from './ui/App'

;(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer
render(<App />, document.getElementById('app')!)
