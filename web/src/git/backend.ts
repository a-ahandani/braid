import type { DiffArea, FileChange, RepoData, WorkStatus } from './repo'

export type RepoState = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
export type PullMode = 'merge' | 'ff-only' | 'rebase'
export type ResetMode = 'soft' | 'mixed' | 'hard'
export type MergeResult = 'up-to-date' | 'fast-forward' | 'merged' | 'conflicts' | 'done'

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
  writeIndex(path: string, content: string): Promise<void>
  writeWorkdir(path: string, content: string): Promise<void>
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
  push(head: string): Promise<void>
  rebase?(onto: string): Promise<MergeResult>
  cherryPick?(oid: string): Promise<MergeResult>
  revert?(oid: string): Promise<MergeResult>
  abort?(): Promise<void>
  continueOp?(): Promise<void>
  openPath?(path: string): Promise<void>
  subscribe?(onChange: () => void): () => void
}
