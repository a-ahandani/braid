use std::path::PathBuf;

use egui::{Align2, Button, Color32, CornerRadius, Frame, Margin, RichText, Stroke, TextEdit};

use crate::{theme, Action, App, Dialog, PullMode, UiState};

fn tool_button(ui: &mut egui::Ui, label: &str, enabled: bool) -> egui::Response {
    ui.add_enabled(enabled, Button::new(RichText::new(label).size(13.0)).min_size(egui::vec2(64.0, 30.0)))
}

pub fn show(root: &mut egui::Ui, app: &mut App, actions: &mut Vec<Action>) {
    egui::Panel::top("toolbar")
        .exact_size(48.0)
        .frame(Frame::new().fill(theme::TOOLBAR_BG).inner_margin(Margin::symmetric(10, 8)))
        .show(root, |ui| {
            ui.horizontal_centered(|ui| {
                let has_repo = app.view.is_some();
                let busy = app.ui.busy.is_some();
                if let Some(v) = &app.view {
                    ui.label(RichText::new(&v.data.name).strong().color(theme::TEXT_BRIGHT).size(14.0));
                    ui.label(RichText::new("/").color(theme::TEXT_DISABLED));
                    let branch = v.data.head_branch.clone().unwrap_or_else(|| {
                        v.data.head_oid.map(|o| format!("detached at {}", super::short(&o))).unwrap_or_else(|| "no commits".into())
                    });
                    ui.label(RichText::new(branch).color(theme::TEXT_NORMAL).size(13.0));
                    ui.add_space(12.0);
                }
                ui.menu_button(RichText::new("Pull ▾").size(13.0), |ui| {
                    if ui.button("Pull and merge").clicked() {
                        actions.push(Action::Pull(PullMode::Merge));
                        ui.close();
                    }
                    if ui.button("Pull, fast-forward only").clicked() {
                        actions.push(Action::Pull(PullMode::FfOnly));
                        ui.close();
                    }
                    if ui.button("Pull with rebase").clicked() {
                        actions.push(Action::Pull(PullMode::Rebase));
                        ui.close();
                    }
                    ui.separator();
                    if ui.button("Fetch everything").clicked() {
                        actions.push(Action::Fetch);
                        ui.close();
                    }
                });
                if tool_button(ui, "Push", has_repo && !busy).on_hover_text("Push the checked-out branch").clicked() {
                    actions.push(Action::Push);
                }
                if tool_button(ui, "Fetch", has_repo && !busy).on_hover_text("Fetch every remote (⌘L)").clicked() {
                    actions.push(Action::Fetch);
                }
                let head = app.view.as_ref().and_then(|v| v.data.head_oid);
                if tool_button(ui, "Branch", head.is_some()).on_hover_text("New branch (⌘B)").clicked() {
                    if let Some(at) = head {
                        actions.push(Action::Dialog(Dialog::CreateBranch { at, name: String::new(), checkout: true }));
                    }
                }
                let dirty = app.view.as_ref().is_some_and(|v| !v.data.status.is_empty());
                if tool_button(ui, "Stash", dirty).on_hover_text("Stash everything").clicked() {
                    actions.push(Action::Dialog(Dialog::Stash { message: String::new(), include_untracked: true }));
                }
                let has_stash = app.view.as_ref().is_some_and(|v| !v.data.stashes.is_empty());
                if tool_button(ui, "Pop", has_stash).on_hover_text("Apply and drop the newest stash").clicked() {
                    actions.push(Action::StashPop(0));
                }
                if let Some(label) = &app.ui.busy {
                    ui.add_space(8.0);
                    ui.spinner();
                    ui.label(RichText::new(format!("{label}...")).color(theme::TEXT_SECONDARY));
                }

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.menu_button(RichText::new("Open ▾").size(13.0), |ui| {
                        if ui.button("Open folder...   ⌘O").clicked() {
                            actions.push(Action::PickRepo);
                            ui.close();
                        }
                        if !app.recent.is_empty() {
                            ui.separator();
                            ui.label(RichText::new("Recent").small().color(theme::TEXT_SECONDARY));
                            for p in app.recent.clone() {
                                let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                                if ui.button(name).on_hover_text(p.to_string_lossy()).clicked() {
                                    actions.push(Action::OpenRepo(p));
                                    ui.close();
                                }
                            }
                        }
                    });
                    if has_repo {
                        let toggle = |ui: &mut egui::Ui, on: &mut bool, label: &str, hint: &str| {
                            if ui.add(Button::new(label).selected(*on)).on_hover_text(hint).clicked() {
                                *on = !*on;
                            }
                        };
                        toggle(ui, &mut app.ui.show_right, "▣", "Toggle detail panel (⌘K)");
                        toggle(ui, &mut app.ui.show_left, "▤", "Toggle left panel (⌘J)");
                        let resp = ui.add(
                            TextEdit::singleline(&mut app.ui.filter)
                                .hint_text("search commits  ⌘F")
                                .desired_width(200.0),
                        );
                        if app.ui.focus_filter {
                            resp.request_focus();
                            app.ui.focus_filter = false;
                        }
                        if let Some(f) = &app.ui.filtered {
                            ui.label(RichText::new(format!("{} results", f.len())).color(theme::TEXT_SECONDARY).small());
                        }
                    }
                });
            });
        });
}

pub fn welcome(ui: &mut egui::Ui, recent: &[PathBuf], actions: &mut Vec<Action>) {
    ui.vertical_centered(|ui| {
        ui.add_space(ui.available_height() * 0.25);
        ui.label(RichText::new("Ramify").size(30.0).strong().color(theme::TEXT_BRIGHT));
        ui.label(RichText::new("Every branch of your repository, in one graph").color(theme::TEXT_SECONDARY));
        ui.add_space(20.0);
        if ui.add(Button::new(RichText::new("Open a repository folder").size(14.0)).min_size(egui::vec2(220.0, 36.0))).clicked() {
            actions.push(Action::PickRepo);
        }
        if !recent.is_empty() {
            ui.add_space(24.0);
            ui.label(RichText::new("Recent").small().color(theme::TEXT_SECONDARY));
            for p in recent {
                let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                if ui.link(RichText::new(name).size(14.0)).on_hover_text(p.to_string_lossy()).clicked() {
                    actions.push(Action::OpenRepo(p.clone()));
                }
            }
        }
    });
}

pub fn toast(ctx: &egui::Context, st: &UiState) {
    let Some((msg, _)) = &st.toast else { return };
    egui::Area::new(egui::Id::unique("toast"))
        .anchor(Align2::RIGHT_BOTTOM, egui::vec2(-16.0, -16.0))
        .order(egui::Order::Foreground)
        .show(ctx, |ui| {
            Frame::new()
                .fill(theme::PANEL_BG2)
                .stroke(Stroke::new(1.0, theme::fade(Color32::WHITE, 0.1)))
                .corner_radius(CornerRadius::same(6))
                .inner_margin(Margin::symmetric(14, 10))
                .show(ui, |ui| {
                    ui.label(RichText::new(msg).color(theme::TEXT_BRIGHT));
                });
        });
}

