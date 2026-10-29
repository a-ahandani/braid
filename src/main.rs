#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod graph;
mod repo;
mod theme;
mod ui;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use egui::{Key, Modifiers};
use git2::{Oid, Repository, ResetType};
use notify::Watcher;

use repo::{DiffArea, DiffLine, FileChange, RepoData};

pub struct RepoView {
    pub repo: Repository,
    pub data: RepoData,
    pub rows: Vec<repo::Commit>,
    pub layout: Vec<graph::RowLayout>,
    pub max_col: usize,
    pub index_of: HashMap<Oid, usize>,
    pub limit: usize,
    _watcher: Option<notify::RecommendedWatcher>,
}

impl RepoView {
    pub fn has_wip(&self) -> bool {
        self.rows.first().is_some_and(|r| r.kind == graph::NodeKind::Wip)
    }
    pub fn head_name(&self) -> String {
        self.data.head_branch.clone().unwrap_or_else(|| "HEAD".into())
    }
    pub fn stash_at(&self, oid: Oid) -> Option<&repo::StashInfo> {
        self.data.stashes.iter().find(|s| s.oid == oid)
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Sel {
    Commit(Oid),
    Wip,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FileSel {
    pub area: DiffArea,
    pub path: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PullMode {
    Merge,
    FfOnly,
    Rebase,
}

#[derive(Clone, Debug)]
pub enum Dialog {
    CreateBranch { at: Oid, name: String, checkout: bool },
    CreateTag { at: Oid, name: String, message: String },
    RenameBranch { old: String, name: String },
    Stash { message: String, include_untracked: bool },
    Reset { at: Oid },
    Confirm { message: String, action: Box<Action> },
    Error { title: String, message: String },
}

#[derive(Clone, Debug)]
pub enum Action {
    OpenRepo(PathBuf),
    PickRepo,
    LoadMore,
    Select(Sel),
    SelectFile(FileSel),
    ScrollTo(Oid),
    Checkout(String),
    CheckoutRemote(String),
    CheckoutCommit(Oid),
    CreateBranch { name: String, at: Oid, checkout: bool },
    DeleteBranch(String),
    RenameBranch { old: String, new: String },
    CreateTag { name: String, at: Oid, message: String },
    DeleteTag(String),
    StashSave { message: String, include_untracked: bool },
    StashApply(usize),
    StashPop(usize),
    StashDrop(usize),
    Merge(String),
    Rebase(String),
    RebaseContinue,
    RebaseAbort,
    AbortMerge,
    Reset { at: Oid, kind: ResetType },
    CherryPick(Oid),
    Revert(Oid),
    Stage(Vec<String>),
    Unstage(Vec<String>),
    StageAll,
    UnstageAll,
    Discard(Vec<FileChange>),
    DiscardAll,
    Commit,
    Fetch,
    Pull(PullMode),
    Push,
    Dialog(Dialog),
    CloseDialog,
    Copy(String),
}

#[derive(Default)]
pub struct UiState {
    pub selected: Option<Sel>,
    pub selected_file: Option<FileSel>,
    pub commit_files: Vec<FileChange>,
    pub diff: Vec<DiffLine>,
    pub commit_summary: String,
    pub commit_desc: String,
    pub amend: bool,
    pub filter: String,
    pub last_filter: String,
    pub filtered: Option<Vec<usize>>,
    pub focus_filter: bool,
    pub dialog: Option<Dialog>,
    pub show_left: bool,
    pub show_right: bool,
    pub scroll_to: Option<usize>,
    pub toast: Option<(String, Instant)>,
    pub busy: Option<String>,
}

pub struct App {
    pub view: Option<RepoView>,
    pub ui: UiState,
    pub recent: Vec<PathBuf>,
    net_rx: Option<mpsc::Receiver<Result<String, String>>>,
    fs_rx: Option<mpsc::Receiver<()>>,
    dirty_at: Option<Instant>,
    last_reload: Instant,
    started: Instant,
    shot_requested: bool,
    actions: Vec<Action>,
}

const RECENT_KEY: &str = "recent_repos";

impl App {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        cc.egui_ctx.set_visuals(theme::visuals());
        egui_extras::install_image_loaders(&cc.egui_ctx);
        let recent: Vec<PathBuf> = cc
            .storage
            .and_then(|s| s.get_string(RECENT_KEY))
            .map(|s| s.lines().filter(|l| !l.is_empty()).map(PathBuf::from).collect())
            .unwrap_or_default();
        let mut app = App {
            view: None,
            ui: UiState { show_left: true, show_right: true, ..Default::default() },
            recent,
            net_rx: None,
            fs_rx: None,
            dirty_at: None,
            last_reload: Instant::now(),
            started: Instant::now(),
            shot_requested: false,
            actions: Vec::new(),
        };
        if let Some(p) = std::env::args().nth(1).map(PathBuf::from).or_else(|| app.recent.first().cloned()) {
            if p.exists() {
                app.actions.push(Action::OpenRepo(p));
            }
        }
        app
    }

    fn open_repo(&mut self, path: PathBuf, ctx: &egui::Context) -> Result<(), git2::Error> {
        let mut repository = repo::open(&path)?;
        let data = repo::load(&mut repository, repo::PAGE)?;
        let root = data.path.clone();
        let (tx, rx) = mpsc::channel();
        let ctx2 = ctx.clone();
        let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                let noise = ev.paths.iter().all(|p| {
                    let s = p.to_string_lossy();
                    s.contains("/.git/objects") || s.contains("\\.git\\objects") || s.ends_with(".lock")
                });
                if !noise {
                    let _ = tx.send(());
                    ctx2.request_repaint();
                }
            }
        })
        .ok()
        .and_then(|mut w| w.watch(&root, notify::RecursiveMode::Recursive).ok().map(|_| w));
        self.fs_rx = Some(rx);
        let mut view = RepoView {
            repo: repository,
            data,
            rows: Vec::new(),
            layout: Vec::new(),
            max_col: 0,
            index_of: HashMap::new(),
            limit: repo::PAGE,
            _watcher: watcher,
        };
        rebuild_rows(&mut view);
        self.recent.retain(|p| *p != view.data.path);
        self.recent.insert(0, view.data.path.clone());
        self.recent.truncate(12);
        self.ui = UiState { show_left: self.ui.show_left, show_right: self.ui.show_right, ..Default::default() };
        self.ui.selected = if view.has_wip() { Some(Sel::Wip) } else { view.data.head_oid.map(Sel::Commit) };
        self.view = Some(view);
        self.refresh_detail();
        Ok(())
    }

    fn reload(&mut self) {
        self.last_reload = Instant::now();
        let Some(view) = self.view.as_mut() else { return };
        match repo::load(&mut view.repo, view.limit) {
            Ok(data) => {
                view.data = data;
                rebuild_rows(view);
                let still_there = match &self.ui.selected {
                    Some(Sel::Wip) => view.has_wip(),
                    Some(Sel::Commit(oid)) => view.index_of.contains_key(oid),
                    None => false,
                };
                if !still_there {
                    self.ui.selected =
                        if view.has_wip() { Some(Sel::Wip) } else { view.data.head_oid.map(Sel::Commit) };
                    self.ui.selected_file = None;
                }
                self.ui.last_filter.clear();
                self.refresh_detail();
            }
            Err(e) => self.error("Could not read the repository", e.message()),
        }
    }

    fn refresh_detail(&mut self) {
        let Some(view) = self.view.as_ref() else { return };
        self.ui.commit_files = match &self.ui.selected {
            Some(Sel::Commit(oid)) => repo::commit_files(&view.repo, *oid).unwrap_or_default(),
            _ => Vec::new(),
        };
        if let Some(f) = &self.ui.selected_file {
            let exists = match f.area {
                DiffArea::Commit(_) => self.ui.commit_files.iter().any(|c| c.path == f.path),
                DiffArea::Staged => view.data.status.staged.iter().any(|c| c.path == f.path),
                DiffArea::Unstaged => {
                    view.data.status.unstaged.iter().chain(&view.data.status.conflicted).any(|c| c.path == f.path)
                }
            };
            if !exists {
                self.ui.selected_file = None;
            }
        }
        self.ui.diff = match &self.ui.selected_file {
            Some(f) => repo::diff_lines(&view.repo, f.area, &f.path).unwrap_or_default(),
            None => Vec::new(),
        };
    }

    fn error(&mut self, title: &str, message: &str) {
        self.ui.dialog = Some(Dialog::Error { title: title.to_string(), message: message.to_string() });
    }

    fn toast(&mut self, msg: impl Into<String>) {
        self.ui.toast = Some((msg.into(), Instant::now()));
    }

    fn start_net(&mut self, label: &str, args: Vec<String>) {
        let Some(view) = self.view.as_ref() else { return };
        if self.ui.busy.is_some() {
            return;
        }
        let path = view.data.path.clone();
        let (tx, rx) = mpsc::channel();
        self.net_rx = Some(rx);
        self.ui.busy = Some(label.to_string());
        std::thread::spawn(move || {
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            let _ = tx.send(repo::git_cli(&path, &refs));
        });
    }

    fn git_now(&mut self, args: &[&str]) {
        let Some(view) = self.view.as_ref() else { return };
        if let Err(e) = repo::git_cli(&view.data.path, args) {
            self.error("Git could not do that", &e);
        }
    }

    fn apply(&mut self, action: Action, ctx: &egui::Context) {
        use Action::*;
        let mut changed = true;
        let result: Result<(), git2::Error> = match action {
            OpenRepo(p) => {
                if let Err(e) = self.open_repo(p, ctx) {
                    self.error("This folder is not a git repository", e.message());
                }
                return;
            }
            PickRepo => {
                if let Some(p) = rfd::FileDialog::new().set_title("Choose a repository folder").pick_folder() {
                    self.actions.push(OpenRepo(p));
                }
                return;
            }
            LoadMore => {
                if let Some(v) = self.view.as_mut() {
                    v.limit += repo::PAGE;
                }
                Ok(())
            }
            Select(sel) => {
                if self.ui.selected.as_ref() != Some(&sel) {
                    self.ui.selected = Some(sel);
                    self.ui.selected_file = None;
                    self.refresh_detail();
                }
                return;
            }
            SelectFile(f) => {
                self.ui.selected_file = Some(f);
                self.refresh_detail();
                return;
            }
            ScrollTo(oid) => {
                if let Some(v) = &self.view {
                    if let Some(i) = v.index_of.get(&oid) {
                        self.ui.scroll_to = Some(*i);
                        self.ui.selected = Some(Sel::Commit(oid));
                        self.ui.selected_file = None;
                        self.refresh_detail();
                    } else {
                        self.toast("That commit is not loaded in the graph yet.");
                    }
                }
                return;
            }
            Dialog(d) => {
                self.ui.dialog = Some(d);
                return;
            }
            CloseDialog => {
                self.ui.dialog = None;
                return;
            }
            Copy(s) => {
                ctx.copy_text(s);
                self.toast("Copied!");
                return;
            }
            Fetch => {
                self.start_net("Fetching", vec!["fetch".into(), "--all".into(), "--prune".into()]);
                return;
            }
            Pull(mode) => {
                let flag = match mode {
                    PullMode::Merge => "--no-rebase",
                    PullMode::FfOnly => "--ff-only",
                    PullMode::Rebase => "--rebase",
                };
                self.start_net("Pulling", vec!["pull".into(), flag.into()]);
                return;
            }
            Push => {
                let Some(v) = self.view.as_ref() else { return };
                if v.data.head_branch.is_none() {
                    self.toast("Check out a branch before pushing");
                    return;
                };
                let has_upstream = v.data.local_branches.iter().any(|b| b.is_head && b.upstream.is_some());
                let mut args = vec!["push".to_string()];
                if !has_upstream {
                    let remote = v
                        .data
                        .remote_branches
                        .first()
                        .map(|b| b.name.split('/').next().unwrap_or("origin").to_string())
                        .unwrap_or_else(|| "origin".into());
                    args.extend(["-u".into(), "--".into(), remote, "HEAD".into()]);
                }
                self.start_net("Pushing", args);
                return;
            }
            Rebase(onto) => {
                self.git_now(&["-c", "core.editor=true", "rebase", "--", &onto]);
                Ok(())
            }
            AbortMerge => {
                self.git_now(&["merge", "--abort"]);
                Ok(())
            }
            RebaseContinue => {
                self.git_now(&["-c", "core.editor=true", "rebase", "--continue"]);
                Ok(())
            }
            RebaseAbort => {
                self.git_now(&["rebase", "--abort"]);
                Ok(())
            }
            other => {
                let Some(v) = self.view.as_mut() else { return };
                let r = &mut v.repo;
                match other {
                    Checkout(name) => repo::checkout_branch(r, &name),
                    CheckoutRemote(name) => repo::checkout_remote_branch(r, &name),
                    CheckoutCommit(oid) => repo::checkout_commit(r, oid),
                    CreateBranch { name, at, checkout } => repo::create_branch(r, &name, at, checkout),
                    DeleteBranch(name) => repo::delete_branch(r, &name),
                    RenameBranch { old, new } => repo::rename_branch(r, &old, &new),
                    CreateTag { name, at, message } => repo::create_tag(r, &name, at, &message),
                    DeleteTag(name) => repo::delete_tag(r, &name),
                    StashSave { message, include_untracked } => repo::stash_save(r, &message, include_untracked),
                    StashApply(i) => repo::stash_apply(r, i, false),
                    StashPop(i) => repo::stash_apply(r, i, true),
                    StashDrop(i) => repo::stash_drop(r, i),
                    Merge(branch) => match repo::merge(r, &branch) {
                        Ok(repo::MergeOutcome::UpToDate) => {
                            changed = false;
                            self.toast(format!("Already up to date with {branch}"));
                            Ok(())
                        }
                        Ok(repo::MergeOutcome::Conflicts) => {
                            self.toast("The merge has conflicts to resolve");
                            Ok(())
                        }
                        Ok(_) => Ok(()),
                        Err(e) => Err(e),
                    },
                    Reset { at, kind } => repo::reset(r, at, kind),
                    CherryPick(oid) => repo::cherry_pick(r, oid).map(|_| ()),
                    Revert(oid) => repo::revert(r, oid).map(|_| ()),
                    Stage(paths) => repo::stage(r, &paths),
                    Unstage(paths) => repo::unstage(r, &paths),
                    StageAll => repo::stage_all(r),
                    UnstageAll => repo::unstage_all(r),
                    Discard(files) => repo::discard(r, &files),
                    DiscardAll => repo::discard_all(r),
                    Commit => {
                        let msg = if self.ui.commit_desc.trim().is_empty() {
                            self.ui.commit_summary.trim().to_string()
                        } else {
                            format!("{}\n\n{}", self.ui.commit_summary.trim(), self.ui.commit_desc.trim())
                        };
                        repo::commit(r, &msg, self.ui.amend).map(|_| {
                            self.ui.commit_summary.clear();
                            self.ui.commit_desc.clear();
                            self.ui.amend = false;
                        })
                    }
                    _ => Ok(()),
                }
            }
        };
        if let Err(e) = result {
            self.error("Git could not do that", e.message());
        }
        if changed {
            self.reload();
        }
    }

    fn debug_screenshot(&mut self, ctx: &egui::Context) {
        let Some(path) = std::env::var_os("RAMULUS_SHOT") else { return };
        if self.shot_requested {
            return;
        }
        if self.started.elapsed() < Duration::from_secs(4) {
            ctx.request_repaint_after(Duration::from_millis(200));
            return;
        }
        self.shot_requested = true;
        let ctx2 = ctx.clone();
        ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(egui::ScreenshotCallback::new(move |img| {
            let [w, h] = img.size;
            let _ = image::save_buffer(&path, img.as_raw(), w as u32, h as u32, image::ColorType::Rgba8);
            ctx2.send_viewport_cmd(egui::ViewportCommand::Close);
        })));
    }

    fn poll_background(&mut self) {
        if let Some(rx) = &self.net_rx {
            match rx.try_recv() {
                Ok(Ok(out)) => {
                    let label = self.ui.busy.take().unwrap_or_default();
                    self.net_rx = None;
                    let last = out.lines().last().unwrap_or("").to_string();
                    self.toast(if last.is_empty() { format!("{label} done") } else { last });
                    self.reload();
                }
                Ok(Err(e)) => {
                    let label = self.ui.busy.take().unwrap_or_default();
                    self.net_rx = None;
                    self.error(&format!("{label} failed"), &e);
                    self.reload();
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    self.ui.busy = None;
                    self.net_rx = None;
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }
        if let Some(rx) = &self.fs_rx {
            let own_write = self.last_reload.elapsed() < Duration::from_millis(300);
            while rx.try_recv().is_ok() {
                if !own_write {
                    self.dirty_at = Some(Instant::now());
                }
            }
        }
        if self.dirty_at.is_some_and(|t| t.elapsed() > Duration::from_millis(400)) {
            self.dirty_at = None;
            self.reload();
        }
    }

    fn handle_keys(&mut self, ctx: &egui::Context) {
        let typing = ctx.egui_wants_keyboard_input();
        let head = self.view.as_ref().and_then(|v| v.data.head_oid);
        let mut acts = Vec::new();
        ctx.input_mut(|i| {
            if i.consume_key(Modifiers::COMMAND, Key::O) {
                acts.push(Action::PickRepo);
            }
            if i.consume_key(Modifiers::COMMAND, Key::L) {
                acts.push(Action::Fetch);
            }
            if i.consume_key(Modifiers::COMMAND, Key::F) {
                self.ui.focus_filter = true;
            }
            if i.consume_key(Modifiers::COMMAND, Key::J) {
                self.ui.show_left = !self.ui.show_left;
            }
            if i.consume_key(Modifiers::COMMAND, Key::K) {
                self.ui.show_right = !self.ui.show_right;
            }
            if i.consume_key(Modifiers::COMMAND | Modifiers::SHIFT, Key::S) {
                acts.push(Action::StageAll);
            }
            if i.consume_key(Modifiers::COMMAND | Modifiers::SHIFT, Key::U) {
                acts.push(Action::UnstageAll);
            }
            if i.consume_key(Modifiers::COMMAND, Key::B) {
                if let Some(at) = head {
                    acts.push(Action::Dialog(Dialog::CreateBranch { at, name: String::new(), checkout: true }));
                }
            }
            if i.consume_key(Modifiers::COMMAND, Key::Enter) && !self.ui.commit_summary.trim().is_empty() {
                acts.push(Action::Commit);
            }
            if i.consume_key(Modifiers::NONE, Key::Escape) {
                if self.ui.dialog.is_some() {
                    acts.push(Action::CloseDialog);
                } else if !self.ui.filter.is_empty() {
                    self.ui.filter.clear();
                }
            }
            if !typing && self.ui.dialog.is_none() {
                let step = if i.consume_key(Modifiers::NONE, Key::ArrowDown) || i.consume_key(Modifiers::NONE, Key::J) {
                    1
                } else if i.consume_key(Modifiers::NONE, Key::ArrowUp) || i.consume_key(Modifiers::NONE, Key::K) {
                    -1
                } else {
                    0
                };
                if step != 0 {
                    if let Some(v) = &self.view {
                        let order: Vec<usize> =
                            self.ui.filtered.clone().unwrap_or_else(|| (0..v.rows.len()).collect());
                        let cur = match &self.ui.selected {
                            Some(Sel::Wip) => 0,
                            Some(Sel::Commit(o)) => v.index_of.get(o).copied().unwrap_or(0),
                            None => 0,
                        };
                        let pos = order.iter().position(|&r| r == cur).unwrap_or(0) as i64 + step;
                        let max = order.len().max(1) as i64 - 1;
                        if let Some(c) = order.get(pos.clamp(0, max) as usize).and_then(|&row| v.rows.get(row).map(|c| (row, c))) {
                            let (row, c) = c;
                            let sel = if c.kind == graph::NodeKind::Wip { Sel::Wip } else { Sel::Commit(c.id) };
                            acts.push(Action::Select(sel));
                            self.ui.scroll_to = Some(row);
                        }
                    }
                }
            }
        });
        self.actions.extend(acts);
    }

    fn update_filter(&mut self) {
        if self.ui.filter == self.ui.last_filter && self.ui.filter.is_empty() == self.ui.filtered.is_none() {
            return;
        }
        self.ui.last_filter = self.ui.filter.clone();
        let Some(v) = &self.view else { return };
        if self.ui.filter.trim().is_empty() {
            self.ui.filtered = None;
            return;
        }
        let q = self.ui.filter.to_lowercase();
        self.ui.filtered = Some(
            v.rows
                .iter()
                .enumerate()
                .filter(|(_, r)| {
                    r.summary.to_lowercase().contains(&q)
                        || r.author.to_lowercase().contains(&q)
                        || r.id.to_string().starts_with(&q)
                        || v.data
                            .refs_by_oid
                            .get(&r.id)
                            .is_some_and(|refs| refs.iter().any(|l| l.name.to_lowercase().contains(&q)))
                })
                .map(|(i, _)| i)
                .collect(),
        );
    }
}

fn rebuild_rows(view: &mut RepoView) {
    let mut rows = view.data.commits.clone();
    if !view.data.status.is_empty() {
        rows.insert(
            0,
            repo::Commit {
                id: Oid::ZERO_SHA1,
                parents: view.data.head_oid.into_iter().collect(),
                author: String::new(),
                email: String::new(),
                time: chrono::Utc::now().timestamp(),
                summary: String::new(),
                body: String::new(),
                kind: graph::NodeKind::Wip,
            },
        );
    }
    let (layout, max_col) = graph::layout(&rows);
    view.index_of = rows.iter().enumerate().map(|(i, c)| (c.id, i)).collect();
    view.rows = rows;
    view.layout = layout;
    view.max_col = max_col;
}

impl eframe::App for App {
    fn ui(&mut self, root: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = root.ctx().clone();
        self.poll_background();
        self.debug_screenshot(&ctx);
        self.update_filter();
        self.handle_keys(&ctx);
        if self.ui.busy.is_some() || self.ui.toast.is_some() || self.dirty_at.is_some() {
            ctx.request_repaint_after(Duration::from_millis(120));
        }
        if self.ui.toast.as_ref().is_some_and(|(_, t)| t.elapsed() > Duration::from_secs(4)) {
            self.ui.toast = None;
        }

        let mut actions = std::mem::take(&mut self.actions);
        ui::toolbar::show(root, self, &mut actions);
        if let Some(view) = self.view.as_ref() {
            if self.ui.show_left {
                egui::Panel::left("left_panel")
                    .resizable(true)
                    .default_size(240.0)
                    .size_range(170.0..=420.0)
                    .frame(egui::Frame::new().fill(theme::PANEL_BG0))
                    .show(root, |ui| ui::left_panel::show(ui, view, &mut self.ui, &mut actions));
            }
            if self.ui.show_right {
                egui::Panel::right("detail_panel")
                    .resizable(true)
                    .default_size(440.0)
                    .size_range(320.0..=900.0)
                    .frame(egui::Frame::new().fill(theme::PANEL_BG0))
                    .show(root, |ui| ui::detail_panel::show(ui, view, &mut self.ui, &mut actions));
            }
            egui::CentralPanel::default()
                .frame(egui::Frame::new().fill(theme::APP_BG))
                .show(root, |ui| ui::graph_view::show(ui, view, &mut self.ui, &mut actions));
        } else {
            egui::CentralPanel::default()
                .frame(egui::Frame::new().fill(theme::APP_BG))
                .show(root, |ui| ui::toolbar::welcome(ui, &self.recent, &mut actions));
        }
        ui::dialogs::show(&ctx, &mut self.ui, &mut actions);
        ui::toolbar::toast(&ctx, &self.ui);

        for a in actions {
            self.apply(a, &ctx);
        }
    }

    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        let list: Vec<String> = self.recent.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        storage.set_string(RECENT_KEY, list.join("\n"));
    }
}

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Ramulus")
            .with_app_id("dev.ahandani.ramulus")
            .with_inner_size([1360.0, 860.0])
            .with_min_inner_size([900.0, 560.0]),
        ..Default::default()
    };
    eframe::run_native("Ramulus", options, Box::new(|cc| Ok(Box::new(App::new(cc)))))
}
