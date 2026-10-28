import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/editor/browser/coreCommands'
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget'
import 'monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching'
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard'
import 'monaco-editor/editor/contrib/comment/browser/comment'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu'
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo'
import 'monaco-editor/editor/contrib/folding/browser/folding'
import 'monaco-editor/editor/contrib/indentation/browser/indentation'
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations'
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor'
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution'
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect'
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization'
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations'
import 'monaco-editor/editor/common/standaloneStrings'
import 'monaco-editor/features/find/register'
import 'monaco-editor/basic-languages/monaco.contribution'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

monaco.editor.defineTheme('ramulus-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'identifier', foreground: '9CDCFE' },
    { token: 'type.identifier', foreground: '4EC9B0' },
  ],
  colors: {
    'editor.background': '#1F1F1F',
    'editor.foreground': '#CCCCCC',
    'editorGutter.background': '#1F1F1F',
    'editorLineNumber.foreground': '#6E7681',
    'editorLineNumber.activeForeground': '#CCCCCC',
    'editorIndentGuide.background1': '#404040',
    'editorWidget.background': '#202020',
    'editorWidget.border': '#313131',
    'editor.findMatchBackground': '#9E6A03',
    'diffEditor.unchangedRegionBackground': '#181818',
    'focusBorder': '#0078D4',
    'input.background': '#313131',
    'input.border': '#3C3C3C',
    'widget.border': '#313131',
  },
})

monaco.editor.defineTheme('ramulus-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'identifier', foreground: '001080' },
    { token: 'type.identifier', foreground: '267F99' },
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#3B3B3B',
    'editorGutter.background': '#FFFFFF',
    'editorLineNumber.foreground': '#6E7681',
    'editorLineNumber.activeForeground': '#171184',
    'editorIndentGuide.background1': '#D3D3D3',
    'editorWidget.background': '#F8F8F8',
    'editorWidget.border': '#E5E5E5',
    'diffEditor.unchangedRegionBackground': '#F8F8F8',
    'focusBorder': '#005FB8',
    'input.background': '#FFFFFF',
    'input.border': '#CECECE',
    'widget.border': '#E5E5E5',
  },
})

export function languageFor(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const hit = monaco.languages.getLanguages().find((l) => l.filenames?.some((f) => f.toLowerCase() === name) || l.extensions?.some((e) => name.endsWith(e.toLowerCase())))
  return hit?.id ?? 'plaintext'
}

export { monaco }
