import type { Backend } from './backend'
import type { RefLabel, RepoData } from './repo'

export function httpBackend(base: string, token: string): Backend {
  const call = async <T>(op: string, body: object = {}): Promise<T> => {
    const res = await fetch(`${base}/api/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ramulus-token': token },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }))
    if (!res.ok || data.error) throw new Error(data.error ?? 'Request failed')
    return data.result as T
  }
  return {
    native: true,
    load: async (limit) => {
      const d = await call<Omit<RepoData, 'refsByOid'> & { refsByOid: Record<string, RefLabel[]> }>('load', { limit })
      return { ...d, refsByOid: new Map(Object.entries(d.refsByOid)) }
    },
    status: () => call('status'),
    commitFiles: (oid) => call('commitFiles', { oid }),
    diffLines: (area, path, ignoreWs) => call('diff', { area, path, ignoreWs }),
    applyHunk: (area, path, hunk, op) => call('applyHunk', { area, path, hunk, op }),
    openPath: (path) => call('openPath', { path }),
    stage: (files) => call('stage', { paths: files.map((f) => f.path) }),
    unstage: (paths) => call('unstage', { paths }),
    discard: (files) => call('discard', { files }),
    commit: (message, amend) => call('commit', { message, amend }),
    checkoutBranch: (name) => call('checkoutBranch', { name }),
    checkoutRemote: (name) => call('checkoutRemote', { name }),
    checkoutCommit: (oid) => call('checkoutCommit', { oid }),
    createBranch: (name, at, checkout) => call('createBranch', { name, at, checkout }),
    deleteBranch: (name) => call('deleteBranch', { name }),
    renameBranch: (oldName, newName) => call('renameBranch', { oldName, newName }),
    createTag: (name, at, message) => call('createTag', { name, at, message }),
    deleteTag: (name) => call('deleteTag', { name }),
    stashSave: (message) => call('stashSave', { message }),
    stashApply: (index, pop) => call('stashApply', { index, pop }),
    stashDrop: (index) => call('stashDrop', { index }),
    merge: (branch) => call('merge', { branch }),
    reset: (_head, oid, mode) => call('reset', { oid, mode }),
    fetchAll: () => call('fetchAll'),
    pull: (mode) => call('pull', { mode }),
    push: () => call('push'),
    rebase: (onto) => call('rebase', { onto }),
    cherryPick: (oid) => call('cherryPick', { oid }),
    revert: (oid) => call('revert', { oid }),
    abort: () => call('abort'),
    continueOp: () => call('continue'),
    subscribe: (onChange) => {
      const es = new EventSource(`${base}/api/events?token=${token}`)
      es.onmessage = () => onChange()
      return () => es.close()
    },
  }
}
