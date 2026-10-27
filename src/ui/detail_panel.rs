use egui::{Button, Color32, FontId, Pos2, Rect, RichText, Sense, TextEdit, Ui};
use git2::{DiffLineType, RepositoryState};

use crate::repo::{DiffArea, FileChange};
use crate::{theme, Action, Dialog, FileSel, RepoView, Sel, UiState};

const FILE_ROW_H: f32 = 24.0;
const DIFF_LINE_H: f32 = 18.0;

pub fn show(ui: &mut Ui, view: &RepoView, st: &mut UiState, actions: &mut Vec<Action>) {
    match st.selected.clone() {
        Some(Sel::Wip) => staging(ui, view, st, actions),
        Some(Sel::Commit(oid)) => commit_view(ui, view, oid, st, actions),
        None => {
            ui.centered_and_justified(|ui| ui.label(RichText::new("Pick a commit").color(theme::TEXT_SECONDARY)));
        }
    }
}

fn section_header(ui: &mut Ui, title: &str, action: Option<(&str, Action)>, actions: &mut Vec<Action>) {
    let size = egui::vec2(ui.available_width(), FILE_ROW_H);
    ui.allocate_ui_with_layout(size, egui::Layout::left_to_right(egui::Align::Center), |ui| {
        ui.add_space(8.0);
        ui.label(RichText::new(title).size(12.0).color(theme::TEXT_SECONDARY).strong());
        if let Some((label, act)) = action {
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.add_space(8.0);
                if ui.add(Button::new(RichText::new(label).size(11.0)).small()).clicked() {
                    actions.push(act);
                }
            });
        }
    });
}

fn file_row(ui: &mut Ui, f: &FileChange, selected: bool, buttons: &[&'static str]) -> (egui::Response, Option<&'static str>) {
    let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), FILE_ROW_H), Sense::click());
    let p = ui.painter().clone();
    if selected {
        p.rect_filled(rect, 0.0, theme::selected_row());
    } else if resp.hovered() {
        p.rect_filled(rect, 0.0, theme::hover_row());
    }
    let color = super::status_color(f.kind);
    p.text(Pos2::new(rect.left() + 10.0, rect.center().y), egui::Align2::LEFT_CENTER, f.kind.letter(), FontId::monospace(12.0), color);
    let mut clicked = None;
    let mut right = rect.right() - 6.0;
    if resp.hovered() || selected {
        for b in buttons.iter().rev() {
            let g = p.layout_no_wrap(b.to_string(), FontId::proportional(11.0), theme::TEXT_NORMAL);
            let w = g.size().x + 12.0;
            let br = Rect::from_min_size(Pos2::new(right - w, rect.center().y - 9.0), egui::vec2(w, 18.0));
            let bresp = ui.interact(br, ui.scope_id().with((f.path.as_str(), *b)), Sense::click());
            let fill = if bresp.hovered() { theme::PANEL_BG2 } else { theme::PANEL_BG1 };
            p.rect_filled(br, 3.0, fill);
            p.galley(Pos2::new(br.left() + 6.0, br.center().y - g.size().y / 2.0), g, theme::TEXT_NORMAL);
            if bresp.clicked() {
                clicked = Some(*b);
            }
            right -= w + 4.0;
        }
    }
    let text_rect = Rect::from_min_max(Pos2::new(rect.left() + 28.0, rect.top()), Pos2::new(right - 4.0, rect.bottom()));
    let (dir, name) = f.path.rsplit_once('/').map(|(d, n)| (format!("{d}/"), n.to_string())).unwrap_or((String::new(), f.path.clone()));
    let name_g = p.layout_no_wrap(name, FontId::proportional(13.0), theme::TEXT_NORMAL);
    let name_w = name_g.size().x;
    let cp = p.with_clip_rect(text_rect);
    cp.galley(Pos2::new(text_rect.left(), rect.center().y - name_g.size().y / 2.0), name_g, theme::TEXT_NORMAL);
    if !dir.is_empty() {
        cp.text(
            Pos2::new(text_rect.left() + name_w + 8.0, rect.center().y),
            egui::Align2::LEFT_CENTER,
            dir,
            FontId::proportional(11.0),
            theme::TEXT_DISABLED,
        );
    }
    (resp.on_hover_text(&f.path), clicked)
}

fn discard_confirm(f: &FileChange) -> Action {
    Action::Dialog(Dialog::Confirm {
        message: format!("Unstaged edits to \"{}\" will be lost. Continue?", f.path),
        action: Box::new(Action::Discard(vec![f.clone()])),
    })
}

enum Line<'a> {
    Header(String, Option<(&'static str, Action)>),
    File(&'a FileChange, DiffArea, &'static [&'static str]),
    Gap,
}

fn staging(ui: &mut Ui, view: &RepoView, st: &mut UiState, actions: &mut Vec<Action>) {
    let s = &view.data.status;
    let state = view.data.state;
    let in_merge = view.data.merge_head.is_some() || state == RepositoryState::Merge;
    let in_rebase = matches!(state, RepositoryState::Rebase | RepositoryState::RebaseInteractive | RepositoryState::RebaseMerge);
    let in_pick = matches!(state, RepositoryState::CherryPick | RepositoryState::Revert);

    egui::Panel::bottom("commit_box")
        .frame(egui::Frame::new().fill(theme::PANEL_BG1).inner_margin(egui::Margin::same(10)))
        .show(ui, |ui| {
            if in_rebase {
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Rebase paused on a conflict").color(theme::ORANGE).strong());
                    if ui.button("Continue rebase").clicked() {
                        actions.push(Action::RebaseContinue);
                    }
                    if ui.button("Abort rebase").clicked() {
                        actions.push(Action::RebaseAbort);
                    }
                });
                ui.label(RichText::new("Resolve the conflicted files, stage them, then continue the rebase.").small().color(theme::TEXT_SECONDARY));
                ui.add_space(6.0);
            }
            if in_merge {
                ui.horizontal(|ui| {
                    let other = view.data.merge_head.map(|o| super::short(&o)).unwrap_or_default();
                    ui.label(RichText::new(format!("Merge of {other} into {} in progress", view.head_name())).color(theme::ORANGE).strong());
                    if ui.button("Abort merge").clicked() {
                        actions.push(Action::AbortMerge);
                    }
                });
                ui.add_space(6.0);
            }
            if in_pick {
                ui.label(RichText::new("Cherry pick / revert in progress: resolve the files, stage them and commit.").small().color(theme::ORANGE));
            }
            if view.data.head_branch.is_none() && view.data.head_oid.is_some() {
                ui.label(RichText::new("Not on a branch (detached HEAD)").color(theme::ORANGE).small());
            }
            ui.label(RichText::new("Message").size(12.0).color(theme::TEXT_SECONDARY).strong());
            ui.add(TextEdit::singleline(&mut st.commit_summary).hint_text("Summary").desired_width(f32::INFINITY));
            ui.add(TextEdit::multiline(&mut st.commit_desc).hint_text("Description").desired_rows(3).desired_width(f32::INFINITY));
            if st.commit_summary.chars().count() > 72 {
                ui.label(RichText::new("Keep the summary under 72 characters so other tools show it in full.").small().color(theme::ORANGE));
            }
            ui.horizontal(|ui| {
                ui.checkbox(&mut st.amend, "Amend");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let can_commit = !in_rebase
                        && (!s.staged.is_empty() || st.amend || in_merge)
                        && s.conflicted.is_empty()
                        && !st.commit_summary.trim().is_empty();
                    let label = if in_rebase {
                        "Continue the rebase instead".to_string()
                    } else if !s.conflicted.is_empty() {
                        "Resolve conflicts first".to_string()
                    } else if in_merge {
                        "Finish the merge".to_string()
                    } else if st.amend {
                        "Amend last commit".to_string()
                    } else if s.staged.is_empty() {
                        "Stage something first".to_string()
                    } else if st.commit_summary.trim().is_empty() {
                        "Add a summary first".to_string()
                    } else {
                        format!("Commit {} file{}", s.staged.len(), if s.staged.len() == 1 { "" } else { "s" })
                    };
                    let btn = Button::new(RichText::new(label).color(if can_commit { Color32::WHITE } else { theme::TEXT_DISABLED }))
                        .fill(if can_commit { theme::fade(theme::GREEN, 0.35) } else { theme::PANEL_BG2 })
                        .min_size(egui::vec2(180.0, 30.0));
                    if ui.add_enabled(can_commit, btn).on_hover_text("⌘⏎").clicked() {
                        actions.push(Action::Commit);
                    }
                });
            });
        });

    let mut lines: Vec<Line> = Vec::with_capacity(s.total() + 6);
    if !s.conflicted.is_empty() {
        lines.push(Line::Header(format!("Conflicts ({})", s.conflicted.len()), None));
        lines.extend(s.conflicted.iter().map(|f| Line::File(f, DiffArea::Unstaged, &["Resolved"])));
        lines.push(Line::Gap);
    }
    let stage_all = (!s.unstaged.is_empty()).then_some(("Stage everything", Action::StageAll));
    lines.push(Line::Header(format!("Unstaged ({})", s.unstaged.len()), stage_all));
    lines.extend(s.unstaged.iter().map(|f| Line::File(f, DiffArea::Unstaged, &["Stage", "Discard"])));
    lines.push(Line::Gap);
    let unstage_all = (!s.staged.is_empty()).then_some(("Unstage everything", Action::UnstageAll));
    lines.push(Line::Header(format!("Staged ({})", s.staged.len()), unstage_all));
    lines.extend(s.staged.iter().map(|f| Line::File(f, DiffArea::Staged, &["Unstage"])));

    let lists_h = (ui.available_height() * 0.45).max(120.0);
    let selected_path = st.selected_file.clone();
    egui::ScrollArea::vertical().id_salt("staging_lists").max_height(lists_h).auto_shrink([false, false]).show_rows(
        ui,
        FILE_ROW_H,
        lines.len(),
        |ui, range| {
            ui.spacing_mut().item_spacing.y = 0.0;
            for i in range {
                match &lines[i] {
                    Line::Gap => ui.add_space(FILE_ROW_H),
                    Line::Header(title, act) => section_header(ui, title, act.clone(), actions),
                    Line::File(f, area, buttons) => {
                        let sel = selected_path.as_ref().is_some_and(|sf| sf.area == *area && sf.path == f.path);
                        let (resp, clicked) = file_row(ui, f, sel, buttons);
                        match clicked {
                            Some("Stage") | Some("Resolved") => actions.push(Action::Stage(vec![f.path.clone()])),
                            Some("Unstage") => actions.push(Action::Unstage(vec![f.path.clone()])),
                            Some("Discard") => actions.push(discard_confirm(f)),
                            _ => {
                                if resp.clicked() {
                                    actions.push(Action::SelectFile(FileSel { area: *area, path: f.path.clone() }));
                                }
                            }
                        }
                        resp.context_menu(|ui| {
                            if *area == DiffArea::Staged {
                                if ui.button("Unstage").clicked() {
                                    actions.push(Action::Unstage(vec![f.path.clone()]));
                                    ui.close();
                                }
                            } else if ui.button("Stage").clicked() {
                                actions.push(Action::Stage(vec![f.path.clone()]));
                                ui.close();
                            }
                            if ui.button("Copy path").clicked() {
                                actions.push(Action::Copy(f.path.clone()));
                                ui.close();
                            }
                            if *area == DiffArea::Unstaged {
                                ui.separator();
                                if ui.button(RichText::new("Throw away changes").color(theme::RED)).clicked() {
                                    actions.push(discard_confirm(f));
                                    ui.close();
                                }
                            }
                        });
                    }
                }
            }
        },
    );
    ui.separator();
    diff_view(ui, st);
}

fn commit_view(ui: &mut Ui, view: &RepoView, oid: git2::Oid, st: &mut UiState, actions: &mut Vec<Action>) {
    let Some(&idx) = view.index_of.get(&oid) else { return };
    let c = &view.rows[idx];
    let color = theme::graph_color(view.layout[idx].column);
    egui::Frame::new().inner_margin(egui::Margin::same(12)).show(ui, |ui| {
        ui.label(RichText::new(&c.summary).size(15.0).strong().color(theme::TEXT_BRIGHT));
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            let (r, _) = ui.allocate_exact_size(egui::vec2(26.0, 26.0), Sense::hover());
            super::avatar(ui.painter(), r.center(), 12.0, &c.author, &c.email, color);
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing.y = 1.0;
                ui.label(RichText::new(&c.author).color(theme::TEXT_NORMAL).size(13.0)).on_hover_text(&c.email);
                ui.label(RichText::new(format!("{}  ·  {}", super::date(c.time), super::ago(c.time))).color(theme::TEXT_SECONDARY).size(11.0));
            });
        });
        ui.add_space(4.0);
        ui.horizontal_wrapped(|ui| {
            if ui.add(Button::new(RichText::new(super::short(&c.id)).monospace().size(12.0)).small()).on_hover_text("Copy full hash").clicked() {
                actions.push(Action::Copy(c.id.to_string()));
            }
            for p in &c.parents {
                let txt = format!("parent {}", super::short(p));
                if ui.add(Button::new(RichText::new(txt).monospace().size(11.0).color(theme::TEXT_SECONDARY)).small().frame(false)).clicked() {
                    actions.push(Action::ScrollTo(*p));
                }
            }
        });
        if !c.body.is_empty() {
            ui.add_space(6.0);
            egui::ScrollArea::vertical().id_salt("body").max_height(120.0).show(ui, |ui| {
                ui.label(RichText::new(&c.body).color(theme::TEXT_NORMAL).size(12.5));
            });
        }
    });
    ui.separator();
    let files = &st.commit_files;
    let n = files.len();
    let title = if view.stash_at(oid).is_some() {
        format!("{n} file change{} in stash", if n == 1 { "" } else { "s" })
    } else {
        format!("{n} file change{}", if n == 1 { "" } else { "s" })
    };
    section_header(ui, &title, None, actions);
    let lists_h = (ui.available_height() * 0.4).max(100.0);
    egui::ScrollArea::vertical().id_salt("commit_files").max_height(lists_h).auto_shrink([false, false]).show_rows(
        ui,
        FILE_ROW_H,
        n,
        |ui, range| {
            ui.spacing_mut().item_spacing.y = 0.0;
            for f in &files[range] {
                let sel = st.selected_file.as_ref().is_some_and(|sf| sf.path == f.path);
                let (resp, _) = file_row(ui, f, sel, &[]);
                if resp.clicked() {
                    actions.push(Action::SelectFile(FileSel { area: DiffArea::Commit(oid), path: f.path.clone() }));
                }
                resp.context_menu(|ui| {
                    if ui.button("Copy path").clicked() {
                        actions.push(Action::Copy(f.path.clone()));
                        ui.close();
                    }
                });
            }
        },
    );
    ui.separator();
    diff_view(ui, st);
}

fn diff_view(ui: &mut Ui, st: &UiState) {
    let Some(f) = &st.selected_file else {
        ui.centered_and_justified(|ui| ui.label(RichText::new("Pick a file to see its diff").color(theme::TEXT_DISABLED)));
        return;
    };
    ui.horizontal(|ui| {
        ui.add_space(8.0);
        ui.label(RichText::new(&f.path).monospace().size(12.0).color(theme::TEXT_SECONDARY));
    });
    if st.diff.is_empty() {
        ui.label(RichText::new("   File contents are unchanged, or the file is binary.").color(theme::TEXT_DISABLED).small());
        return;
    }
    let font = FontId::monospace(12.0);
    egui::ScrollArea::both().id_salt("diff").auto_shrink([false, false]).show_rows(ui, DIFF_LINE_H, st.diff.len(), |ui, range| {
        ui.spacing_mut().item_spacing.y = 0.0;
        let width = ui.available_width().max(2000.0);
        for i in range {
            let line = &st.diff[i];
            let (rect, _) = ui.allocate_exact_size(egui::vec2(width, DIFF_LINE_H), Sense::hover());
            let p = ui.painter();
            let (bg, fg, prefix) = match line.kind {
                DiffLineType::Addition | DiffLineType::AddEOFNL => (theme::fade(theme::GREEN, 0.18), theme::TEXT_BRIGHT, "+"),
                DiffLineType::Deletion | DiffLineType::DeleteEOFNL => (theme::fade(theme::RED, 0.18), theme::TEXT_BRIGHT, "-"),
                DiffLineType::HunkHeader => (theme::fade(theme::BLUE, 0.12), theme::fade(Color32::from_rgb(0x40, 0xc5, 0xec), 0.9), ""),
                DiffLineType::Binary => (Color32::TRANSPARENT, theme::TEXT_DISABLED, ""),
                _ => (Color32::TRANSPARENT, theme::TEXT_NORMAL, " "),
            };
            if bg != Color32::TRANSPARENT {
                p.rect_filled(rect, 0.0, bg);
            }
            p.text(Pos2::new(rect.left() + 8.0, rect.center().y), egui::Align2::LEFT_CENTER, prefix, font.clone(), fg);
            p.text(Pos2::new(rect.left() + 22.0, rect.center().y), egui::Align2::LEFT_CENTER, &line.text, font.clone(), fg);
        }
    });
}
