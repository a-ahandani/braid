use egui::{Button, Key, RichText, TextEdit};
use git2::ResetType;

use crate::{theme, Action, Dialog, UiState};

fn valid_ref_name(prefix: &str, name: &str) -> bool {
    !name.starts_with('-') && git2::Reference::is_valid_name(&format!("{prefix}{name}"))
}

fn buttons(ui: &mut egui::Ui, ok_label: &str, ok_enabled: bool, danger: bool, enter_submits: bool) -> (bool, bool) {
    let mut ok = false;
    let mut cancel = false;
    ui.add_space(10.0);
    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
        let fill = if danger { theme::fade(theme::RED, 0.35) } else { theme::fade(theme::BLUE, 0.35) };
        if ui.add_enabled(ok_enabled, Button::new(ok_label).fill(fill).min_size(egui::vec2(90.0, 28.0))).clicked() {
            ok = true;
        }
        if ui.add(Button::new("Cancel").min_size(egui::vec2(80.0, 28.0))).clicked() {
            cancel = true;
        }
    });
    if ok_enabled && enter_submits && ui.input(|i| i.key_pressed(Key::Enter)) {
        ok = true;
    }
    (ok, cancel)
}

fn focus_first(ui: &mut egui::Ui, resp: &egui::Response) {
    if ui.memory(|m| m.focused().is_none()) {
        resp.request_focus();
    }
}

pub fn show(ctx: &egui::Context, st: &mut UiState, actions: &mut Vec<Action>) {
    let Some(dialog) = st.dialog.as_mut() else { return };
    let mut close = false;
    let modal = egui::Modal::new(egui::Id::unique("dialog"))
        .frame(egui::Frame::window(&ctx.global_style()).fill(theme::PANEL_BG1).inner_margin(egui::Margin::same(16)))
        .show(ctx, |ui| {
            ui.set_width(380.0);
            match dialog {
                Dialog::CreateBranch { at, name, checkout } => {
                    ui.label(RichText::new("Name the new branch").strong().color(theme::TEXT_BRIGHT));
                    ui.add_space(6.0);
                    let r = ui.add(TextEdit::singleline(name).hint_text("branch name").desired_width(f32::INFINITY));
                    focus_first(ui, &r);
                    ui.checkbox(checkout, "Switch to it right away");
                    let valid = !name.is_empty() && valid_ref_name("refs/heads/", name);
                    if !name.is_empty() && !valid {
                        ui.label(RichText::new("That is not a valid branch name").color(theme::RED).small());
                    }
                    let (ok, cancel) = buttons(ui, "Create", valid, false, true);
                    if ok {
                        actions.push(Action::CreateBranch { name: name.clone(), at: *at, checkout: *checkout });
                    }
                    close = ok || cancel;
                }
                Dialog::CreateTag { at, name, message } => {
                    ui.label(RichText::new("Name the new tag").strong().color(theme::TEXT_BRIGHT));
                    ui.add_space(6.0);
                    let r = ui.add(TextEdit::singleline(name).hint_text("tag name").desired_width(f32::INFINITY));
                    focus_first(ui, &r);
                    let msg = ui.add(TextEdit::multiline(message).hint_text("Message for an annotated tag (optional)").desired_rows(2).desired_width(f32::INFINITY));
                    let valid = !name.is_empty() && valid_ref_name("refs/tags/", name);
                    if !name.is_empty() && !valid {
                        ui.label(RichText::new("That is not a valid tag name").color(theme::RED).small());
                    }
                    let (ok, cancel) = buttons(ui, "Create Tag", valid, false, !msg.has_focus());
                    if ok {
                        actions.push(Action::CreateTag { name: name.clone(), at: *at, message: message.clone() });
                    }
                    close = ok || cancel;
                }
                Dialog::RenameBranch { old, name } => {
                    ui.label(RichText::new(format!("Rename '{old}' to:")).strong().color(theme::TEXT_BRIGHT));
                    ui.add_space(6.0);
                    let r = ui.add(TextEdit::singleline(name).hint_text("new name").desired_width(f32::INFINITY));
                    focus_first(ui, &r);
                    let valid = !name.is_empty() && name != old && valid_ref_name("refs/heads/", name);
                    let (ok, cancel) = buttons(ui, "Rename", valid, false, true);
                    if ok {
                        actions.push(Action::RenameBranch { old: old.clone(), new: name.clone() });
                    }
                    close = ok || cancel;
                }
                Dialog::Stash { message, include_untracked } => {
                    ui.label(RichText::new("Stash everything").strong().color(theme::TEXT_BRIGHT));
                    ui.add_space(6.0);
                    let r = ui.add(TextEdit::singleline(message).hint_text("Short note for this stash").desired_width(f32::INFINITY));
                    focus_first(ui, &r);
                    ui.checkbox(include_untracked, "Also stash untracked files");
                    let (ok, cancel) = buttons(ui, "Stash", true, false, true);
                    if ok {
                        actions.push(Action::StashSave { message: message.clone(), include_untracked: *include_untracked });
                    }
                    close = ok || cancel;
                }
                Dialog::Reset { at } => {
                    ui.label(RichText::new(format!("Reset the branch to {}", &at.to_string()[..7])).strong().color(theme::TEXT_BRIGHT));
                    ui.add_space(8.0);
                    let mut pick = None;
                    if ui.add(Button::new("Soft: keep everything staged").min_size(egui::vec2(340.0, 30.0))).clicked() {
                        pick = Some(ResetType::Soft);
                    }
                    if ui.add(Button::new("Mixed: keep the working tree, clear the index").min_size(egui::vec2(340.0, 30.0))).clicked() {
                        pick = Some(ResetType::Mixed);
                    }
                    if ui
                        .add(Button::new(RichText::new("Hard: drop the index and the working tree").color(theme::RED)).min_size(egui::vec2(340.0, 30.0)))
                        .clicked()
                    {
                        pick = Some(ResetType::Hard);
                    }
                    if let Some(kind) = pick {
                        actions.push(Action::Reset { at: *at, kind });
                        close = true;
                    }
                    let (_, cancel) = buttons(ui, "", false, false, false);
                    close |= cancel;
                }
                Dialog::Confirm { message, action } => {
                    ui.label(RichText::new("Please confirm").strong().color(theme::TEXT_BRIGHT));
                    ui.add_space(6.0);
                    ui.label(RichText::new(message.as_str()).color(theme::TEXT_NORMAL));
                    let (ok, cancel) = buttons(ui, "Yes", true, true, true);
                    if ok {
                        actions.push((**action).clone());
                    }
                    close = ok || cancel;
                }
                Dialog::Error { title, message } => {
                    ui.label(RichText::new(title.as_str()).strong().color(theme::RED));
                    ui.add_space(6.0);
                    egui::ScrollArea::vertical().max_height(240.0).show(ui, |ui| {
                        ui.label(RichText::new(message.as_str()).color(theme::TEXT_NORMAL).monospace().size(12.0));
                    });
                    let (ok, cancel) = buttons(ui, "OK", true, false, true);
                    close = ok || cancel;
                }
            }
        });
    if close || modal.should_close() {
        actions.push(Action::CloseDialog);
    }
}
