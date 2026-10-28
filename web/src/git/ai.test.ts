import { describe, expect, it } from 'vitest'
import { branchName, fillPrompt, splitMessage } from './ai'

describe('AI text helpers', () => {
  it('reads commit messages and branch names out of replies', () => {
    expect(splitMessage('```\nFix login\n\nThe form lost focus.\n```')).toEqual({ summary: 'Fix login', description: 'The form lost focus.' })
    expect(branchName('`feat/login form`\nbecause...')).toBe('feat/login-form')
  })

  it('fills the file into a prompt on one line so pasting it never sends it', () => {
    expect(fillPrompt('Fix {file}.\nThen stop.', 'src/a.ts')).toBe('Fix src/a.ts. Then stop.')
    expect(fillPrompt('Fix the conflict.', 'a.ts')).toBe('Fix the conflict. The file is a.ts.')
  })
})
