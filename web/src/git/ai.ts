import type { AiTask } from './backend'

export const DEFAULT_PROMPTS: Record<AiTask, string> = {
  commit:
    'Write a commit message for the staged changes below. Start with a summary line under 72 characters in the imperative mood, in the style of the recent commits. Add a blank line and a short body only if the change needs explaining. Reply with the commit message only, without quotes or code fences.',
  branch:
    'Suggest one name for a new git branch for the work below. Use short lowercase words joined by hyphens and follow the naming style of the existing branches, including any prefix such as feat/ or fix/. Reply with the branch name only.',
  conflict: 'Resolve the merge conflict in {file}. Keep the intended changes from both sides, remove every conflict marker, and leave the file unstaged so I can review it.',
}

export function cleanReply(text: string): string {
  const t = text.trim()
  return /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(t)?.[1] ?? t
}

export function splitMessage(text: string): { summary: string; description: string } {
  const [summary = '', ...rest] = cleanReply(text).split('\n')
  return { summary: summary.trim(), description: rest.join('\n').trim() }
}

export function branchName(text: string): string {
  return (cleanReply(text).split('\n')[0] ?? '').replace(/[`'"]/g, '').trim().replace(/\s+/g, '-')
}

export function fillPrompt(template: string, file: string): string {
  const text = template.includes('{file}') ? template.replaceAll('{file}', file) : `${template} The file is ${file}.`
  return text.replace(/\s*\n\s*/g, ' ').trim()
}
