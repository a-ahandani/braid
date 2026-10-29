use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use git2::{
    BranchType, Delta, DiffFormat, DiffLineType, DiffOptions, Oid, Repository, RepositoryState,
    ResetType, Sort, StashFlags, StatusOptions, StatusShow,
};

use crate::graph::NodeKind;

pub type Result<T> = std::result::Result<T, git2::Error>;

pub const PAGE: usize = 2000;

#[derive(Clone, Debug)]
pub struct Commit {
    pub id: Oid,
    pub parents: Vec<Oid>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    pub body: String,
    pub kind: NodeKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RefKind {
    Head { current: bool },
    Remote { remote: String },
    Tag,
}

#[derive(Clone, Debug)]
pub struct RefLabel {
    pub name: String,
    pub kind: RefKind,
}

#[derive(Clone, Debug)]
pub struct BranchInfo {
    pub name: String,
    pub oid: Oid,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Clone, Debug)]
pub struct TagInfo {
    pub name: String,
    pub oid: Oid,
}

#[derive(Clone, Debug)]
pub struct StashInfo {
    pub index: usize,
    pub message: String,
    pub oid: Oid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
    TypeChange,
}

impl ChangeKind {
    pub fn letter(self) -> &'static str {
        match self {
            ChangeKind::Added | ChangeKind::Untracked => "A",
            ChangeKind::Modified => "M",
            ChangeKind::Deleted => "D",
            ChangeKind::Renamed => "R",
            ChangeKind::Conflicted => "!",
            ChangeKind::TypeChange => "T",
        }
    }
}

#[derive(Clone, Debug)]
pub struct FileChange {
    pub path: String,
    pub kind: ChangeKind,
}

#[derive(Clone, Debug, Default)]
pub struct WorkStatus {
    pub staged: Vec<FileChange>,
    pub unstaged: Vec<FileChange>,
    pub conflicted: Vec<FileChange>,
}

impl WorkStatus {
    pub fn is_empty(&self) -> bool {
        self.staged.is_empty() && self.unstaged.is_empty() && self.conflicted.is_empty()
    }
    pub fn total(&self) -> usize {
        self.staged.len() + self.unstaged.len() + self.conflicted.len()
    }
}

pub struct RepoData {
    pub path: PathBuf,
    pub name: String,
    pub head_branch: Option<String>,
    pub head_oid: Option<Oid>,
    pub commits: Vec<Commit>,
    pub refs_by_oid: HashMap<Oid, Vec<RefLabel>>,
    pub local_branches: Vec<BranchInfo>,
    pub remote_branches: Vec<BranchInfo>,
    pub tags: Vec<TagInfo>,
    pub stashes: Vec<StashInfo>,
    pub status: WorkStatus,
    pub state: RepositoryState,
    pub merge_head: Option<Oid>,
    pub has_more: bool,
}

pub fn open(path: &Path) -> Result<Repository> {
    Repository::discover(path)
}

pub fn load(repo: &mut Repository, limit: usize) -> Result<RepoData> {
    let path = repo.workdir().unwrap_or_else(|| repo.path()).to_path_buf();
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let (head_branch, head_oid) = match repo.head() {
        Ok(h) => (if h.is_branch() { h.shorthand().ok().map(String::from) } else { None }, h.target()),
        Err(_) => (None, None),
    };

    let mut refs_by_oid: HashMap<Oid, Vec<RefLabel>> = HashMap::new();
    let mut local_branches = Vec::new();
    let mut remote_branches = Vec::new();
    let mut tips: Vec<Oid> = Vec::new();
    for b in repo.branches(None)? {
        let (branch, kind) = b?;
        let Some(name) = branch.name()?.map(String::from) else { continue };
        let Some(oid) = branch.get().target() else { continue };
        tips.push(oid);
        match kind {
            BranchType::Local => {
                let upstream = branch.upstream().ok().and_then(|u| u.name().ok().flatten().map(String::from));
                let (ahead, behind) = upstream
                    .as_deref()
                    .and_then(|u| repo.find_branch(u, BranchType::Remote).ok())
                    .and_then(|u| u.get().target())
                    .and_then(|u| repo.graph_ahead_behind(oid, u).ok())
                    .unwrap_or((0, 0));
                let is_head = branch.is_head();
                refs_by_oid.entry(oid).or_default().push(RefLabel {
                    name: name.clone(),
                    kind: RefKind::Head { current: is_head },
                });
                local_branches.push(BranchInfo { name, oid, is_head, upstream, ahead, behind });
            }
            BranchType::Remote => {
                if branch.get().symbolic_target().ok().flatten().is_some() {
                    continue;
                }
                let remote = name.split('/').next().unwrap_or_default().to_string();
                refs_by_oid.entry(oid).or_default().push(RefLabel {
                    name: name.clone(),
                    kind: RefKind::Remote { remote },
                });
                remote_branches.push(BranchInfo { name, oid, is_head: false, upstream: None, ahead: 0, behind: 0 });
            }
        }
    }
    local_branches.sort_by(|a, b| a.name.cmp(&b.name));
    remote_branches.sort_by(|a, b| a.name.cmp(&b.name));

    let mut tags = Vec::new();
    for r in repo.references_glob("refs/tags/*")? {
        let r = r?;
        let Ok(name) = r.shorthand().map(String::from) else { continue };
        let Ok(oid) = r.peel_to_commit().map(|c| c.id()) else { continue };
        tips.push(oid);
        refs_by_oid.entry(oid).or_default().push(RefLabel { name: name.clone(), kind: RefKind::Tag });
        tags.push(TagInfo { name, oid });
    }
    tags.sort_by(|a, b| a.name.cmp(&b.name));

    let mut stashes = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        stashes.push(StashInfo { index, message: message.to_string(), oid: *oid });
        true
    })?;

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME)?;
    for t in &tips {
        walk.push(*t)?;
    }
    if let Some(h) = head_oid {
        walk.push(h)?;
    }
    let stash_ids: HashMap<Oid, String> = stashes.iter().map(|s| (s.oid, s.message.clone())).collect();
    let mut stash_internals: Vec<Oid> = Vec::new();
    for s in &stashes {
        walk.push(s.oid)?;
        stash_internals.extend(repo.find_commit(s.oid)?.parent_ids().skip(1));
    }

    let mut commits = Vec::with_capacity(limit.min(4096));
    let mut has_more = false;
    for oid in walk {
        let oid = oid?;
        if stash_internals.contains(&oid) {
            continue;
        }
        if commits.len() >= limit {
            has_more = true;
            break;
        }
        let c = repo.find_commit(oid)?;
        let message = c.message().unwrap_or("").to_string();
        let (summary, body) = split_message(&message);
        let stash_msg = stash_ids.get(&oid);
        let kind = if stash_msg.is_some() {
            NodeKind::Stash
        } else if c.parent_count() > 1 {
            NodeKind::Merge
        } else {
            NodeKind::Commit
        };
        let parents: Vec<Oid> =
            if kind == NodeKind::Stash { c.parent_ids().take(1).collect() } else { c.parent_ids().collect() };
        commits.push(Commit {
            id: oid,
            parents,
            author: c.author().name().unwrap_or("").to_string(),
            email: c.author().email().unwrap_or("").to_string(),
            time: c.time().seconds(),
            summary: stash_msg.cloned().unwrap_or(summary),
            body,
            kind,
        });
    }

    let merge_head = std::fs::read_to_string(repo.path().join("MERGE_HEAD"))
        .ok()
        .and_then(|s| Oid::from_str(s.trim()).ok());

    Ok(RepoData {
        path,
        name,
        head_branch,
        head_oid,
        commits,
        refs_by_oid,
        local_branches,
        remote_branches,
        tags,
        stashes,
        status: if repo.is_bare() { WorkStatus::default() } else { status(repo)? },
        state: repo.state(),
        merge_head,
        has_more,
    })
}

fn split_message(message: &str) -> (String, String) {
    let mut parts = message.trim_end().splitn(2, '\n');
    let summary = parts.next().unwrap_or("").trim().to_string();
    let body = parts.next().unwrap_or("").trim().to_string();
    (summary, body)
}

pub fn status(repo: &Repository) -> Result<WorkStatus> {
    let mut opts = StatusOptions::new();
    opts.show(StatusShow::IndexAndWorkdir)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let mut out = WorkStatus::default();
    for e in repo.statuses(Some(&mut opts))?.iter() {
        let s = e.status();
        let path = e
            .head_to_index()
            .or_else(|| e.index_to_workdir())
            .and_then(|d| d.new_file().path().or(d.old_file().path()))
            .map(|p| p.to_string_lossy().into_owned())
            .or_else(|| e.path().ok().map(String::from))
            .unwrap_or_default();
        if s.is_conflicted() {
            out.conflicted.push(FileChange { path, kind: ChangeKind::Conflicted });
            continue;
        }
        let staged = if s.is_index_new() {
            Some(ChangeKind::Added)
        } else if s.is_index_modified() {
            Some(ChangeKind::Modified)
        } else if s.is_index_deleted() {
            Some(ChangeKind::Deleted)
        } else if s.is_index_renamed() {
            Some(ChangeKind::Renamed)
        } else if s.is_index_typechange() {
            Some(ChangeKind::TypeChange)
        } else {
            None
        };
        if let Some(k) = staged {
            out.staged.push(FileChange { path: path.clone(), kind: k });
        }
        let unstaged = if s.is_wt_new() {
            Some(ChangeKind::Untracked)
        } else if s.is_wt_modified() {
            Some(ChangeKind::Modified)
        } else if s.is_wt_deleted() {
            Some(ChangeKind::Deleted)
        } else if s.is_wt_renamed() {
            Some(ChangeKind::Renamed)
        } else if s.is_wt_typechange() {
            Some(ChangeKind::TypeChange)
        } else {
            None
        };
        if let Some(k) = unstaged {
            out.unstaged.push(FileChange { path, kind: k });
        }
    }
    Ok(out)
}

fn delta_kind(d: Delta) -> ChangeKind {
    match d {
        Delta::Added | Delta::Untracked => ChangeKind::Added,
        Delta::Deleted => ChangeKind::Deleted,
        Delta::Renamed => ChangeKind::Renamed,
        Delta::Typechange => ChangeKind::TypeChange,
        Delta::Conflicted => ChangeKind::Conflicted,
        _ => ChangeKind::Modified,
    }
}

pub fn commit_files(repo: &Repository, oid: Oid) -> Result<Vec<FileChange>> {
    let commit = repo.find_commit(oid)?;
    let new = commit.tree()?;
    let old = commit.parent(0).ok().map(|p| p.tree()).transpose()?;
    let mut diff = repo.diff_tree_to_tree(old.as_ref(), Some(&new), None)?;
    diff.find_similar(None)?;
    Ok(diff
        .deltas()
        .map(|d| FileChange {
            path: d.new_file().path().or(d.old_file().path()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
            kind: delta_kind(d.status()),
        })
        .collect())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffArea {
    Commit(Oid),
    Staged,
    Unstaged,
}

#[derive(Clone, Debug)]
pub struct DiffLine {
    pub kind: DiffLineType,
    pub text: String,
}

const MAX_DIFF_LINES: usize = 5000;

pub fn diff_lines(repo: &Repository, area: DiffArea, path: &str) -> Result<Vec<DiffLine>> {
    let mut opts = DiffOptions::new();
    opts.pathspec(path)
        .disable_pathspec_match(true)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let diff = match area {
        DiffArea::Commit(oid) => {
            let commit = repo.find_commit(oid)?;
            let new = commit.tree()?;
            let old = commit.parent(0).ok().map(|p| p.tree()).transpose()?;
            repo.diff_tree_to_tree(old.as_ref(), Some(&new), Some(&mut opts))?
        }
        DiffArea::Staged => {
            let index = repo.index()?;
            repo.diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut opts))?
        }
        DiffArea::Unstaged => repo.diff_index_to_workdir(None, Some(&mut opts))?,
    };
    let mut lines = Vec::new();
    let mut truncated = false;
    diff.print(DiffFormat::Patch, |_, _, line| {
        if lines.len() >= MAX_DIFF_LINES {
            truncated = true;
            return false;
        }
        let kind = line.origin_value();
        if kind == DiffLineType::FileHeader {
            return true;
        }
        lines.push(DiffLine { kind, text: String::from_utf8_lossy(line.content()).trim_end_matches('\n').to_string() });
        true
    })
    .or_else(|e| if truncated { Ok(()) } else { Err(e) })?;
    if truncated {
        lines.push(DiffLine { kind: DiffLineType::Binary, text: "Diff truncated".into() });
    }
    Ok(lines)
}

pub fn stage(repo: &Repository, paths: &[String]) -> Result<()> {
    let mut index = repo.index()?;
    let workdir = repo.workdir().unwrap_or_else(|| repo.path());
    for p in paths {
        if workdir.join(p).exists() {
            index.add_path(Path::new(p))?;
        } else {
            index.remove_path(Path::new(p))?;
        }
    }
    index.write()
}

pub fn stage_all(repo: &Repository) -> Result<()> {
    let mut index = repo.index()?;
    index.add_all(["*"], git2::IndexAddOption::DEFAULT, None)?;
    index.update_all(["*"], None)?;
    index.write()
}

fn literal_pathspec(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        if matches!(c, '[' | '*' | '?' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

pub fn unstage(repo: &Repository, paths: &[String]) -> Result<()> {
    match repo.head() {
        Ok(head) => {
            let obj = head.peel(git2::ObjectType::Commit)?;
            repo.reset_default(Some(&obj), paths.iter().map(|p| literal_pathspec(p)))
        }
        Err(_) => {
            let mut index = repo.index()?;
            for p in paths {
                index.remove_path(Path::new(p))?;
            }
            index.write()
        }
    }
}

pub fn unstage_all(repo: &Repository) -> Result<()> {
    let paths: Vec<String> = status(repo)?.staged.into_iter().map(|f| f.path).collect();
    if paths.is_empty() {
        return Ok(());
    }
    unstage(repo, &paths)
}

pub fn discard(repo: &Repository, files: &[FileChange]) -> Result<()> {
    let workdir = repo.workdir().unwrap_or_else(|| repo.path());
    let mut tracked: Vec<&str> = Vec::new();
    for f in files {
        if f.kind == ChangeKind::Untracked {
            let full = workdir.join(&f.path);
            let removed = if full.is_dir() { std::fs::remove_dir_all(&full) } else { std::fs::remove_file(&full) };
            removed.map_err(|e| git2::Error::from_str(&format!("{}: {e}", f.path)))?;
        } else {
            tracked.push(&f.path);
        }
    }
    if tracked.is_empty() {
        return Ok(());
    }
    let mut cb = git2::build::CheckoutBuilder::new();
    cb.force().update_index(true).disable_pathspec_match(true);
    for p in tracked {
        cb.path(p);
    }
    repo.checkout_index(Some(&mut repo.index()?), Some(&mut cb))
}

pub fn discard_all(repo: &Repository) -> Result<()> {
    let st = status(repo)?;
    let mut all = st.unstaged;
    all.extend(st.staged);
    unstage_all(repo)?;
    discard(repo, &all)
}

pub fn commit(repo: &Repository, message: &str, amend: bool) -> Result<Oid> {
    let sig = repo.signature()?;
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(git2::Error::from_str("Resolve all conflicts before committing"));
    }
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if amend {
        let head = head.ok_or_else(|| git2::Error::from_str("Nothing to amend"))?;
        return head.amend(Some("HEAD"), None, None, None, Some(message), Some(&tree));
    }
    let merge_head = std::fs::read_to_string(repo.path().join("MERGE_HEAD"))
        .ok()
        .and_then(|s| Oid::from_str(s.trim()).ok())
        .and_then(|o| repo.find_commit(o).ok());
    if merge_head.is_none() && head.as_ref().map(|h| h.tree_id()) == Some(tree_id) {
        return Err(git2::Error::from_str("Nothing staged to commit"));
    }
    let parents: Vec<&git2::Commit> = head.iter().chain(merge_head.iter()).collect();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
    if matches!(repo.state(), RepositoryState::Merge | RepositoryState::CherryPick | RepositoryState::Revert) {
        repo.cleanup_state()?;
    }
    Ok(oid)
}

fn checkout_safe(repo: &Repository, obj: &git2::Object) -> Result<()> {
    let mut cb = git2::build::CheckoutBuilder::new();
    cb.safe();
    repo.checkout_tree(obj, Some(&mut cb))
}

pub fn checkout_branch(repo: &Repository, name: &str) -> Result<()> {
    let branch = repo.find_branch(name, BranchType::Local)?;
    let obj = branch.get().peel(git2::ObjectType::Commit)?;
    checkout_safe(repo, &obj)?;
    repo.set_head(branch.get().name().unwrap_or_default())
}

pub fn checkout_remote_branch(repo: &Repository, remote_name: &str) -> Result<()> {
    let local = remote_name.split_once('/').map(|(_, b)| b).unwrap_or(remote_name);
    if repo.find_branch(local, BranchType::Local).is_err() {
        let remote = repo.find_branch(remote_name, BranchType::Remote)?;
        let commit = remote.get().peel_to_commit()?;
        let mut b = repo.branch(local, &commit, false)?;
        b.set_upstream(Some(remote_name))?;
    }
    checkout_branch(repo, local)
}

pub fn checkout_commit(repo: &Repository, oid: Oid) -> Result<()> {
    let obj = repo.find_object(oid, None)?;
    checkout_safe(repo, &obj)?;
    repo.set_head_detached(oid)
}

pub fn create_branch(repo: &Repository, name: &str, at: Oid, checkout: bool) -> Result<()> {
    let commit = repo.find_commit(at)?;
    repo.branch(name, &commit, false)?;
    if checkout { checkout_branch(repo, name) } else { Ok(()) }
}

pub fn delete_branch(repo: &Repository, name: &str) -> Result<()> {
    repo.find_branch(name, BranchType::Local)?.delete()
}

pub fn rename_branch(repo: &Repository, old: &str, new: &str) -> Result<()> {
    repo.find_branch(old, BranchType::Local)?.rename(new, false).map(|_| ())
}

pub fn create_tag(repo: &Repository, name: &str, at: Oid, message: &str) -> Result<()> {
    let obj = repo.find_object(at, None)?;
    if message.trim().is_empty() {
        repo.tag_lightweight(name, &obj, false).map(|_| ())
    } else {
        repo.tag(name, &obj, &repo.signature()?, message, false).map(|_| ())
    }
}

pub fn delete_tag(repo: &Repository, name: &str) -> Result<()> {
    repo.tag_delete(name)
}

pub fn stash_save(repo: &mut Repository, message: &str, include_untracked: bool) -> Result<()> {
    let sig = repo.signature()?;
    let flags = if include_untracked { StashFlags::INCLUDE_UNTRACKED } else { StashFlags::DEFAULT };
    let msg = if message.trim().is_empty() { None } else { Some(message) };
    repo.stash_save(&sig, msg.unwrap_or("WIP"), Some(flags)).map(|_| ())
}

pub fn stash_apply(repo: &mut Repository, index: usize, pop: bool) -> Result<()> {
    let mut opts = git2::StashApplyOptions::new();
    opts.reinstantiate_index();
    if pop { repo.stash_pop(index, Some(&mut opts)) } else { repo.stash_apply(index, Some(&mut opts)) }
}

pub fn stash_drop(repo: &mut Repository, index: usize) -> Result<()> {
    repo.stash_drop(index)
}

pub enum MergeOutcome {
    UpToDate,
    FastForward,
    Merged,
    Conflicts,
}

pub fn merge(repo: &Repository, branch: &str) -> Result<MergeOutcome> {
    let reference = repo.resolve_reference_from_short_name(branch)?;
    let their = repo.reference_to_annotated_commit(&reference)?;
    let (analysis, _) = repo.merge_analysis(&[&their])?;
    if analysis.is_up_to_date() {
        return Ok(MergeOutcome::UpToDate);
    }
    let head_name = repo.head()?.shorthand().unwrap_or("HEAD").to_string();
    if analysis.is_fast_forward() {
        let obj = repo.find_object(their.id(), None)?;
        checkout_safe(repo, &obj)?;
        let mut head = repo.head()?;
        head.set_target(their.id(), &format!("move {head_name} forward to {branch}"))?;
        return Ok(MergeOutcome::FastForward);
    }
    let mut cb = git2::build::CheckoutBuilder::new();
    cb.safe().allow_conflicts(true);
    repo.merge(&[&their], None, Some(&mut cb))?;
    if repo.index()?.has_conflicts() {
        return Ok(MergeOutcome::Conflicts);
    }
    commit(repo, &format!("Merge {branch} into {head_name}"), false)?;
    Ok(MergeOutcome::Merged)
}

pub fn reset(repo: &Repository, oid: Oid, kind: ResetType) -> Result<()> {
    let obj = repo.find_object(oid, None)?;
    repo.reset(&obj, kind, None)
}

pub fn cherry_pick(repo: &Repository, oid: Oid) -> Result<MergeOutcome> {
    let commit_obj = repo.find_commit(oid)?;
    repo.cherrypick(&commit_obj, None)?;
    if repo.index()?.has_conflicts() {
        return Ok(MergeOutcome::Conflicts);
    }
    commit(repo, commit_obj.message().unwrap_or("Cherry pick"), false)?;
    Ok(MergeOutcome::Merged)
}

pub fn revert(repo: &Repository, oid: Oid) -> Result<MergeOutcome> {
    let commit_obj = repo.find_commit(oid)?;
    repo.revert(&commit_obj, None)?;
    if repo.index()?.has_conflicts() {
        return Ok(MergeOutcome::Conflicts);
    }
    let msg = format!(
        "Revert \"{}\"\n\nThis reverts commit {}.",
        commit_obj.summary().ok().flatten().unwrap_or(""),
        commit_obj.id()
    );
    commit(repo, &msg, false)?;
    Ok(MergeOutcome::Merged)
}


pub fn git_cli(workdir: &Path, args: &[&str]) -> std::result::Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(workdir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Could not run git: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if out.status.success() {
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_repo() -> (tempdir::Dir, Repository) {
        let dir = tempdir::Dir::new();
        let repo = Repository::init(&dir.0).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "t@example.com").unwrap();
        (dir, repo)
    }

    mod tempdir {
        pub struct Dir(pub std::path::PathBuf);
        impl Dir {
            pub fn new() -> Self {
                let p = std::env::temp_dir().join(format!("ramulus-test-{}", std::process::id()))
                    .join(format!("{:?}", std::time::Instant::now()).replace(['{', '}', ' ', ':'], ""));
                std::fs::create_dir_all(&p).unwrap();
                Dir(p)
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn stage_commit_and_load_round_trip() {
        let (dir, mut repo) = temp_repo();
        std::fs::write(dir.0.join("a.txt"), "hello\n").unwrap();
        let st = status(&repo).unwrap();
        assert_eq!(st.unstaged.len(), 1);
        assert_eq!(st.unstaged[0].kind, ChangeKind::Untracked);
        stage(&repo, &["a.txt".into()]).unwrap();
        assert_eq!(status(&repo).unwrap().staged.len(), 1);
        commit(&repo, "first", false).unwrap();
        std::fs::write(dir.0.join("a.txt"), "hello\nworld\n").unwrap();
        stage_all(&repo).unwrap();
        commit(&repo, "second\n\nmore detail", false).unwrap();
        let data = load(&mut repo, PAGE).unwrap();
        assert_eq!(data.commits.len(), 2);
        assert_eq!(data.commits[0].summary, "second");
        assert_eq!(data.commits[0].body, "more detail");
        assert!(data.status.is_empty());
        let files = commit_files(&repo, data.commits[0].id).unwrap();
        assert_eq!(files[0].path, "a.txt");
        let lines = diff_lines(&repo, DiffArea::Commit(data.commits[0].id), "a.txt").unwrap();
        assert!(lines.iter().any(|l| l.kind == DiffLineType::Addition && l.text == "world"));
        create_branch(&repo, "feature", data.commits[1].id, true).unwrap();
        assert_eq!(load(&mut repo, PAGE).unwrap().head_branch.as_deref(), Some("feature"));
        unstage_all(&repo).unwrap();
        assert!(commit(&repo, "nothing staged", false).is_err());
    }

    #[test]
    fn commit_keeps_rebase_state_and_discard_is_literal() {
        let (dir, repo) = temp_repo();
        std::fs::write(dir.0.join("[id].tsx"), "a\n").unwrap();
        std::fs::write(dir.0.join("i.tsx"), "b\n").unwrap();
        stage_all(&repo).unwrap();
        commit(&repo, "first", false).unwrap();
        std::fs::write(dir.0.join("[id].tsx"), "a2\n").unwrap();
        std::fs::write(dir.0.join("i.tsx"), "b2\n").unwrap();
        discard(&repo, &[FileChange { path: "[id].tsx".into(), kind: ChangeKind::Modified }]).unwrap();
        assert_eq!(std::fs::read_to_string(dir.0.join("i.tsx")).unwrap(), "b2\n");
        assert_eq!(std::fs::read_to_string(dir.0.join("[id].tsx")).unwrap(), "a\n");
        stage(&repo, &["i.tsx".into()]).unwrap();
        unstage(&repo, &["[id].tsx".into()]).unwrap();
        assert_eq!(status(&repo).unwrap().staged.len(), 1);
        let rebase_dir = repo.path().join("rebase-merge");
        std::fs::create_dir_all(&rebase_dir).unwrap();
        assert_eq!(repo.state(), RepositoryState::RebaseMerge);
        commit(&repo, "during rebase", false).unwrap();
        assert!(rebase_dir.exists(), "committing must not delete the rebase state");
    }
}
