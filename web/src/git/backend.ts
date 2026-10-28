import type { DiffArea, FileChange, RepoData, WorkStatus } from './repo'

export type RepoState = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
export type PullMode = 'merge' | 'ff-only' | 'rebase'
export type ResetMode = 'soft' | 'mixed' | 'hard'
export type MergeResult = 'up-to-date' | 'fast-forward' | 'merged' | 'conflicts' | 'done'

export type PushResult = { result: 'pushed' } | { result: 'rejected'; ahead: number; behind: number; theirs: string }

export interface RebaseResult {
  result: 'done' | 'conflicts' | 'stash-conflicts'
  before: string
}

export type AiTask = 'commit' | 'branch' | 'conflict'

export interface AiSettings {
  enabled?: boolean
  agent?: string
  prompts: Partial<Record<AiTask, string>>
}

export interface AiInfo {
  agents: { id: string; name: string }[]
  settings: AiSettings
}

export interface FileVersions {
  old: string
  new: string
  binary: boolean
}

export interface Backend {
  native: boolean
  load(limit: number): Promise<RepoData>
  status(): Promise<WorkStatus>
  commitFiles(oid: string): Promise<FileChange[]>
  fileVersions(area: DiffArea, path: string): Promise<FileVersions>
  writeIndex(path: string, content: string, expected?: string): Promise<void>
  writeWorkdir(path: string, content: string, expected?: string): Promise<void>
  stage(files: FileChange[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  discard(files: FileChange[]): Promise<void>
  commit(message: string, amend: boolean): Promise<unknown>
  checkoutBranch(name: string): Promise<void>
  checkoutRemote(name: string): Promise<void>
  checkoutCommit(oid: string): Promise<void>
  createBranch(name: string, at: string, checkout: boolean): Promise<void>
  deleteBranch(name: string): Promise<void>
  renameBranch(oldName: string, newName: string): Promise<void>
  createTag(name: string, at: string, message: string): Promise<void>
  deleteTag(name: string): Promise<void>
  stashSave(message: string): Promise<void>
  stashApply(index: number, pop: boolean): Promise<void>
  stashDrop(index: number): Promise<void>
  merge(branch: string, head: string): Promise<MergeResult>
  reset(head: string, oid: string, mode: ResetMode): Promise<void>
  fetchAll(): Promise<void>
  pull(mode: PullMode, head: string): Promise<void>
  push(head: string, lease?: string): Promise<PushResult | void>
  rebase?(onto: string): Promise<RebaseResult>
  undoRebase?(before: string): Promise<'done' | 'stash-conflicts'>
  dropAutostash?(): Promise<void>
  cherryPick?(oid: string): Promise<MergeResult>
  revert?(oid: string): Promise<MergeResult>
  abort?(): Promise<void>
  continueOp?(): Promise<void>
  openPath?(path: string): Promise<void>
  subscribe?(onChange: () => void): () => void
  ai?(): Promise<AiInfo>
  setAi?(settings: AiSettings): Promise<void>
  aiContext?(task: 'commit' | 'branch', at?: string): Promise<string>
  aiAsk?(agent: string, prompt: string, signal: AbortSignal): Promise<string>
  termStart?(agent: string, cols: number, rows: number): Promise<{ agent: string; fresh: boolean }>
  termInput?(data: string): Promise<void>
  termResize?(cols: number, rows: number): Promise<void>
  termStop?(): Promise<void>
  termStream?(onData: (data: string) => void, onExit: () => void): () => void
}
