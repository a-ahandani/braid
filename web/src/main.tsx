import { Buffer } from 'buffer'
import { render } from 'preact'
import '@vscode/codicons/dist/codicon.css'
import './styles.css'
import { Shell } from './ui/Shell'

;(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer
render(<Shell />, document.getElementById('app')!)
