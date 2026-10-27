use std::collections::BTreeMap;

use egui::{Color32, FontId, RichText, Sense, Ui};
use git2::Oid;

use crate::repo::BranchInfo;
use crate::{theme, Action, Dialog, RepoView, Sel, UiState};

const ROW_H: f32 = 24.0;

fn header(ui: &mut Ui, title: &str, count: usize, open: &mut bool) {
    let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 26.0), Sense::click());
    if resp.clicked() {
        *open = !*open;
    }
    let p = ui.painter();
    if resp.hovered() {
        p.rect_filled(rect, 0.0, theme::fade(Color32::WHITE, 0.03));
    }
    let arrow = if *open { "▾" } else { "▸" };
    p.text(rect.left_center() + egui::vec2(8.0, 0.0), egui::Align2::LEFT_CENTER, arrow, FontId::proportional(11.0), theme::TEXT_SECONDARY);
    p.text(
        rect.left_center() + egui::vec2(22.0, 0.0),
        egui::Align2::LEFT_CENTER,
        title,
        FontId::proportional(11.0),
        theme::TEXT_SECONDARY,
    );
    p.text(
        rect.right_center() - egui::vec2(10.0, 0.0),
        egui::Align2::RIGHT_CENTER,
        count.to_string(),
        FontId::proportional(11.0),
        theme::TEXT_DISABLED,
    );
}

struct Item<'a> {
    label: &'a str,
    oid: Oid,
    indent: f32,
    strong: bool,
    marker: Option<Color32>,
    trailing: String,
}

fn item(ui: &mut Ui, view: &RepoView, st: &UiState, it: Item<'_>) -> egui::Response {
    let (rect, resp) = ui.allocate_exact_size(egui::vec2(ui.available_width(), ROW_H), Sense::click());
    let selected = matches!(&st.selected, Some(Sel::Commit(o)) if *o == it.oid);
    let p = ui.painter();
    if selected {
        p.rect_filled(rect, 0.0, theme::selected_row());
    } else if resp.hovered() {
        p.rect_filled(rect, 0.0, theme::hover_row());
    }
    let col = view.index_of.get(&it.oid).map(|i| theme::graph_color(view.layout[*i].column)).unwrap_or(theme::TEXT_DISABLED);
    let x = rect.left() + 14.0 + it.indent;
    p.circle_filled(egui::pos2(x, rect.center().y), 3.0, col);
    let mut text_rect = rect;
    text_rect.min.x = x + 10.0;
    text_rect.max.x -= 8.0;
    let mut trailing_w = 0.0;
    if !it.trailing.is_empty() {
        let g = p.layout_no_wrap(it.trailing.clone(), FontId::proportional(11.0), theme::TEXT_SECONDARY);
        trailing_w = g.size().x + 6.0;
        p.galley(egui::pos2(rect.right() - 8.0 - g.size().x, rect.center().y - g.size().y / 2.0), g, theme::TEXT_SECONDARY);
    }
    if let Some(mc) = it.marker {
        let g = p.layout_no_wrap("✓".into(), FontId::proportional(12.0), mc);
        let gw = g.size().x;
        p.galley(egui::pos2(rect.right() - 8.0 - trailing_w - gw, rect.center().y - g.size().y / 2.0), g, mc);
        trailing_w += gw + 6.0;
    }
    text_rect.max.x -= trailing_w;
    let color = if it.strong { theme::TEXT_BRIGHT } else { theme::TEXT_NORMAL };
    let font = FontId::proportional(13.0);
    super::text_in(p, text_rect, it.label, font, color);
    resp
}

fn branch_menu(ui: &mut Ui, view: &RepoView, b: &BranchInfo, actions: &mut Vec<Action>) {
    let head = view.head_name();
    if !b.is_head {
        if ui.button(format!("Switch to {}", b.name)).clicked() {
            actions.push(Action::Checkout(b.name.clone()));
            ui.close();
        }
        if view.data.head_branch.is_some() && ui.button(format!("Merge {} into {}", b.name, head)).clicked() {
            actions.push(Action::Merge(b.name.clone()));
            ui.close();
        }
        if view.data.head_branch.is_some() && ui.button(format!("Rebase {} onto {}", head, b.name)).clicked() {
            actions.push(Action::Rebase(b.name.clone()));
            ui.close();
        }
    }
    if ui.button(format!("Rename {}", b.name)).clicked() {
        actions.push(Action::Dialog(Dialog::RenameBranch { old: b.name.clone(), name: b.name.clone() }));
        ui.close();
    }
    if ui.button("New branch from here").clicked() {
        actions.push(Action::Dialog(Dialog::CreateBranch { at: b.oid, name: String::new(), checkout: true }));
        ui.close();
    }
    if b.is_head && ui.button(format!("Push {}", b.name)).clicked() {
        actions.push(Action::Push);
        ui.close();
    }
    if ui.button("Copy name").clicked() {
        actions.push(Action::Copy(b.name.clone()));
        ui.close();
    }
    if !b.is_head {
        ui.separator();
        if ui.button(RichText::new(format!("Delete {}", b.name)).color(theme::RED)).clicked() {
            actions.push(Action::Dialog(Dialog::Confirm {
                message: format!("Delete \"{}\"? This cannot be undone.", b.name),
                action: Box::new(Action::DeleteBranch(b.name.clone())),
            }));
            ui.close();
        }
    }
}

pub fn show(ui: &mut Ui, view: &RepoView, st: &mut UiState, actions: &mut Vec<Action>) {
    let id = ui.make_persistent_id("left_sections");
    let mut open: [bool; 4] = ui.data_mut(|d| *d.get_persisted_mut_or(id, [true, true, true, true]));
    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        ui.spacing_mut().item_spacing.y = 0.0;
        ui.add_space(4.0);

        header(ui, "LOCAL", view.data.local_branches.len(), &mut open[0]);
        if open[0] {
            for b in &view.data.local_branches {
                let trailing = match (b.ahead, b.behind) {
                    (0, 0) => String::new(),
                    (a, 0) => format!("↑{a}"),
                    (0, d) => format!("↓{d}"),
                    (a, d) => format!("↑{a} ↓{d}"),
                };
                let resp = item(
                    ui,
                    view,
                    st,
                    Item {
                        label: &b.name,
                        oid: b.oid,
                        indent: 6.0,
                        strong: b.is_head,
                        marker: b.is_head.then_some(theme::GREEN),
                        trailing,
                    },
                );
                let resp = match &b.upstream {
                    Some(u) => resp.on_hover_text(format!("Upstream: {u}")),
                    None => resp,
                };
                if resp.double_clicked() && !b.is_head {
                    actions.push(Action::Checkout(b.name.clone()));
                } else if resp.clicked() {
                    actions.push(Action::ScrollTo(b.oid));
                }
                resp.context_menu(|ui| branch_menu(ui, view, b, actions));
            }
            if view.data.local_branches.is_empty() {
                ui.label(RichText::new("   No local branches").small().color(theme::TEXT_DISABLED));
            }
        }

        header(ui, "REMOTE", view.data.remote_branches.len(), &mut open[1]);
        if open[1] {
            let mut by_remote: BTreeMap<&str, Vec<&BranchInfo>> = BTreeMap::new();
            for b in &view.data.remote_branches {
                by_remote.entry(b.name.split('/').next().unwrap_or_default()).or_default().push(b);
            }
            for (remote, branches) in by_remote {
                ui.horizontal(|ui| {
                    ui.add_space(20.0);
                    ui.label(RichText::new(remote).color(theme::TEXT_SECONDARY).size(12.0));
                });
                for b in branches {
                    let short = b.name.split_once('/').map(|(_, n)| n).unwrap_or(&b.name);
                    let resp = item(
                        ui,
                        view,
                        st,
                        Item { label: short, oid: b.oid, indent: 18.0, strong: false, marker: None, trailing: String::new() },
                    );
                    if resp.double_clicked() {
                        actions.push(Action::CheckoutRemote(b.name.clone()));
                    } else if resp.clicked() {
                        actions.push(Action::ScrollTo(b.oid));
                    }
                    resp.context_menu(|ui| {
                        if ui.button(format!("Switch to {}", b.name)).clicked() {
                            actions.push(Action::CheckoutRemote(b.name.clone()));
                            ui.close();
                        }
                        if view.data.head_branch.is_some() && ui.button(format!("Merge {} into {}", b.name, view.head_name())).clicked() {
                            actions.push(Action::Merge(b.name.clone()));
                            ui.close();
                        }
                        if ui.button("Copy name").clicked() {
                            actions.push(Action::Copy(b.name.clone()));
                            ui.close();
                        }
                    });
                }
            }
            if view.data.remote_branches.is_empty() {
                ui.label(RichText::new("   No remote branches. Fetch to see them.").small().color(theme::TEXT_DISABLED));
            }
        }

        header(ui, "TAGS", view.data.tags.len(), &mut open[2]);
        if open[2] {
            for t in &view.data.tags {
                let resp = item(
                    ui,
                    view,
                    st,
                    Item { label: &t.name, oid: t.oid, indent: 6.0, strong: false, marker: None, trailing: String::new() },
                );
                if resp.clicked() {
                    actions.push(Action::ScrollTo(t.oid));
                }
                resp.context_menu(|ui| {
                    if ui.button(format!("Check out {} (no branch)", t.name)).clicked() {
                        actions.push(Action::CheckoutCommit(t.oid));
                        ui.close();
                    }
                    if ui.button("Copy name").clicked() {
                        actions.push(Action::Copy(t.name.clone()));
                        ui.close();
                    }
                    ui.separator();
                    if ui.button(RichText::new(format!("Delete tag {}", t.name)).color(theme::RED)).clicked() {
                        actions.push(Action::Dialog(Dialog::Confirm {
                            message: format!("Delete \"{}\"? This cannot be undone.", t.name),
                            action: Box::new(Action::DeleteTag(t.name.clone())),
                        }));
                        ui.close();
                    }
                });
            }
        }

        header(ui, "STASHES", view.data.stashes.len(), &mut open[3]);
        if open[3] {
            for s in &view.data.stashes {
                let resp = item(
                    ui,
                    view,
                    st,
                    Item { label: &s.message, oid: s.oid, indent: 6.0, strong: false, marker: None, trailing: String::new() },
                )
                .on_hover_text(&s.message);
                if resp.clicked() {
                    actions.push(Action::ScrollTo(s.oid));
                }
                resp.context_menu(|ui| stash_menu(ui, s.index, &s.message, actions));
            }
        }
        ui.add_space(12.0);
    });
    ui.data_mut(|d| d.insert_persisted(id, open));
}

pub fn stash_menu(ui: &mut Ui, index: usize, message: &str, actions: &mut Vec<Action>) {
    if ui.button("Apply (keep stash)").clicked() {
        actions.push(Action::StashApply(index));
        ui.close();
    }
    if ui.button("Apply and drop").clicked() {
        actions.push(Action::StashPop(index));
        ui.close();
    }
    ui.separator();
    if ui.button(RichText::new("Drop stash").color(theme::RED)).clicked() {
        actions.push(Action::Dialog(Dialog::Confirm {
            message: format!("Drop the stash \"{message}\"? This cannot be undone."),
            action: Box::new(Action::StashDrop(index)),
        }));
        ui.close();
    }
}
