use egui::epaint::CubicBezierShape;
use egui::{Align2, Color32, CornerRadius, FontId, Pos2, Rect, Sense, Shape, Stroke, Ui};

use crate::graph::{NodeKind, RowLayout};
use crate::repo::{Commit, RefKind, RefLabel};
use crate::{theme, Action, Dialog, RepoView, Sel, UiState};

pub const ROW_H: f32 = 26.0;
const HEADER_H: f32 = 24.0;
const COL_W: f32 = 20.0;
const GUTTER: f32 = 22.0;
const NODE_R: f32 = 9.5;
const MERGE_R: f32 = 5.5;
const LINE_W: f32 = 2.0;

struct Zones {
    refs: Rect,
    graph: Rect,
    message: Rect,
    author: Rect,
    date: Rect,
    sha: Rect,
}

fn zones(row: Rect, graph_w: f32) -> Zones {
    let ref_w = (row.width() * 0.22).clamp(150.0, 300.0);
    let author_w = 40.0;
    let date_w = if row.width() > 720.0 { 150.0 } else { 0.0 };
    let sha_w = if row.width() > 620.0 { 72.0 } else { 0.0 };
    let x0 = row.left();
    let refs = Rect::from_min_max(Pos2::new(x0, row.top()), Pos2::new(x0 + ref_w, row.bottom()));
    let graph = Rect::from_min_max(refs.right_top(), Pos2::new(refs.right() + graph_w, row.bottom()));
    let sha = Rect::from_min_max(Pos2::new(row.right() - sha_w, row.top()), row.right_bottom());
    let date = Rect::from_min_max(Pos2::new(sha.left() - date_w, row.top()), sha.left_bottom());
    let author = Rect::from_min_max(Pos2::new(date.left() - author_w, row.top()), date.left_bottom());
    let message = Rect::from_min_max(graph.right_top(), author.left_bottom());
    Zones { refs, graph, message, author, date, sha }
}

fn lane_x(graph: Rect, col: usize) -> f32 {
    graph.left() + 3.0 + GUTTER + col as f32 * COL_W + COL_W / 2.0
}

fn header(ui: &mut Ui, z: &Zones) {
    let rect = Rect::from_min_size(z.refs.min, egui::vec2(z.sha.right() - z.refs.left(), HEADER_H));
    let p = ui.painter();
    p.rect_filled(rect, 0.0, theme::PANEL_BG0);
    p.hline(rect.x_range(), rect.bottom(), Stroke::new(1.0, theme::BORDER));
    let font = FontId::proportional(11.0);
    let label = |r: Rect, text: &str| {
        if r.width() > 20.0 {
            let rr = Rect::from_min_size(Pos2::new(r.left() + 8.0, rect.top()), egui::vec2(r.width() - 8.0, HEADER_H));
            super::text_in(p, rr, text, font.clone(), theme::TEXT_SECONDARY);
        }
    };
    label(z.refs, "REFS");
    label(z.graph, "GRAPH");
    label(z.message, "MESSAGE");
    label(z.author, if z.author.width() >= 62.0 { "AUTHOR" } else { "" });
    label(z.date, "DATE");
    label(z.sha, "SHA");
}

pub fn show(ui: &mut Ui, view: &RepoView, st: &mut UiState, actions: &mut Vec<Action>) {
    let total = ui.available_rect_before_wrap();
    let graph_w = (3.0 + GUTTER + (view.max_col as f32 + 1.0) * COL_W + 6.0).clamp(56.0, 420.0);
    let z = zones(total, graph_w);
    header(ui, &z);
    ui.add_space(HEADER_H);

    let count = st.filtered.as_ref().map_or(view.rows.len(), Vec::len);
    let filtered = st.filtered.is_some();
    let mut area = egui::ScrollArea::vertical().id_salt("graph_rows").auto_shrink([false, false]);
    if let Some(target) = st.scroll_to.take() {
        let pos = match &st.filtered {
            Some(f) => f.iter().position(|&r| r == target),
            None => Some(target),
        };
        if let Some(pos) = pos {
            let viewport_h = ui.available_height();
            area = area.vertical_scroll_offset((pos as f32 * ROW_H - viewport_h / 2.0 + ROW_H / 2.0).max(0.0));
        }
    }
    let extra = if view.data.has_more && !filtered { 1 } else { 0 };
    area.show_rows(ui, ROW_H, count + extra, |ui, range| {
        ui.spacing_mut().item_spacing.y = 0.0;
        let width = ui.available_width();
        for i in range {
            if i >= count {
                ui.horizontal(|ui| {
                    ui.add_space(z.refs.width() + 8.0);
                    ui.label(egui::RichText::new(format!("Showing {} commits.", view.data.commits.len())).color(theme::TEXT_SECONDARY));
                    if ui.link("Load more").clicked() {
                        actions.push(Action::LoadMore);
                    }
                });
                continue;
            }
            let row_idx = st.filtered.as_ref().map_or(i, |f| f[i]);
            let (rect, resp) = ui.allocate_exact_size(egui::vec2(width, ROW_H), Sense::click());
            let rz = zones(rect, graph_w);
            draw_row(ui, view, row_idx, &rz, rect, &resp, st, !filtered, actions);
        }
    });
    if view.rows.is_empty() {
        ui.centered_and_justified(|ui| ui.label(egui::RichText::new("No commits").color(theme::TEXT_SECONDARY)));
    }
}

fn is_selected(st: &UiState, c: &Commit) -> bool {
    match &st.selected {
        Some(Sel::Wip) => c.kind == NodeKind::Wip,
        Some(Sel::Commit(o)) => c.kind != NodeKind::Wip && *o == c.id,
        None => false,
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_row(
    ui: &mut Ui,
    view: &RepoView,
    row_idx: usize,
    z: &Zones,
    rect: Rect,
    resp: &egui::Response,
    st: &mut UiState,
    draw_edges: bool,
    actions: &mut Vec<Action>,
) {
    let c = &view.rows[row_idx];
    let lay = &view.layout[row_idx];
    let color = theme::graph_color(lay.column);
    let selected = is_selected(st, c);
    let p = ui.painter().clone();
    if selected {
        p.rect_filled(rect, 0.0, theme::selected_row());
    } else if resp.hovered() {
        p.rect_filled(rect, 0.0, theme::hover_row());
    }

    let refs = view.data.refs_by_oid.get(&c.id).map(Vec::as_slice).unwrap_or(&[]);
    let pills = draw_refs(&p, z.refs, refs, color, c.kind == NodeKind::Wip);

    if draw_edges {
        draw_lanes(&p, z.graph, lay, rect);
    } else {
        p.vline(lane_x(z.graph, lay.column), rect.y_range(), Stroke::new(LINE_W, theme::fade(color, 0.3)));
    }
    draw_node(&p, z.graph, lay, c, color);

    let font = FontId::proportional(13.0);
    let mut msg_rect = z.message;
    msg_rect.min.x += 8.0;
    msg_rect.max.x -= 6.0;
    match c.kind {
        NodeKind::Wip => {
            let s = &view.data.status;
            let txt = format!("Uncommitted changes · {} file{}", s.total(), if s.total() == 1 { "" } else { "s" });
            super::text_in(&p, msg_rect, &txt, font.clone(), theme::TEXT_SECONDARY);
        }
        NodeKind::Stash => super::text_in(&p, msg_rect, &c.summary, FontId::proportional(13.0), theme::TEXT_SECONDARY),
        _ => super::text_in(&p, msg_rect, &c.summary, font.clone(), if selected { theme::TEXT_BRIGHT } else { theme::TEXT_NORMAL }),
    }

    if c.kind != NodeKind::Wip {
        if z.author.width() > 0.0 {
            super::avatar(&p, z.author.center(), NODE_R - 1.0, &c.author, &c.email, color);
        }
        if z.date.width() > 0.0 {
            let mut r = z.date;
            r.min.x += 8.0;
            super::text_in(&p, r, &super::date(c.time), FontId::proportional(12.0), theme::TEXT_DISABLED);
        }
        if z.sha.width() > 0.0 {
            let mut r = z.sha;
            r.min.x += 8.0;
            super::text_in(&p, r, &super::short(&c.id), FontId::monospace(12.0), theme::TEXT_DISABLED);
        }
    }

    let hover_pill = resp.hover_pos().and_then(|pos| pills.iter().find(|(r, _)| r.contains(pos)).map(|(_, l)| l.clone()));
    if let Some(l) = &hover_pill {
        let tip = match &l.kind {
            RefKind::Head { current: true } => format!("{} (checked out)", l.name),
            RefKind::Head { .. } => format!("Branch {}  (double-click to checkout)", l.name),
            RefKind::Remote { .. } => format!("Remote branch {}", l.name),
            RefKind::Tag => format!("Tag {}", l.name),
        };
        resp.clone().on_hover_text(tip);
    } else if c.kind != NodeKind::Wip && resp.hovered() && !c.body.is_empty() {
        resp.clone().on_hover_text(format!("{}\n\n{}", c.summary, c.body));
    }

    if resp.double_clicked() {
        match hover_pill.as_ref().map(|l| &l.kind) {
            Some(RefKind::Head { current: false }) => actions.push(Action::Checkout(hover_pill.as_ref().unwrap().name.clone())),
            Some(RefKind::Remote { .. }) => actions.push(Action::CheckoutRemote(hover_pill.as_ref().unwrap().name.clone())),
            _ => {}
        }
    } else if resp.clicked() {
        actions.push(Action::Select(if c.kind == NodeKind::Wip { Sel::Wip } else { Sel::Commit(c.id) }));
    }
    resp.context_menu(|ui| {
        if !selected {
            actions.push(Action::Select(if c.kind == NodeKind::Wip { Sel::Wip } else { Sel::Commit(c.id) }));
        }
        context_menu(ui, view, c, refs, actions);
    });
}

fn draw_refs(p: &egui::Painter, zone: Rect, refs: &[RefLabel], color: Color32, wip: bool) -> Vec<(Rect, RefLabel)> {
    let mut out = Vec::new();
    if wip || refs.is_empty() {
        return out;
    }
    let p = p.with_clip_rect(zone);
    let font = FontId::proportional(12.0);
    let mut x = zone.left() + 6.0;
    let right = zone.right() - 4.0;
    let mut ordered: Vec<&RefLabel> = refs.iter().collect();
    ordered.sort_by_key(|l| match l.kind {
        RefKind::Head { current: true } => 0,
        RefKind::Head { .. } => 1,
        RefKind::Remote { .. } => 2,
        RefKind::Tag => 3,
    });
    let mut hidden = 0;
    for (i, l) in ordered.iter().enumerate() {
        let current = matches!(l.kind, RefKind::Head { current: true });
        let g = p.layout_no_wrap(l.name.clone(), font.clone(), if current { theme::TEXT_BRIGHT } else { theme::TEXT_NORMAL });
        let w = g.size().x + 24.0;
        let remaining = ordered.len() - i;
        let needs_overflow = remaining > 1;
        let reserve = if needs_overflow { 34.0 } else { 0.0 };
        if x + w + reserve > right && i > 0 {
            hidden = remaining;
            break;
        }
        let r = Rect::from_min_size(Pos2::new(x, zone.center().y - 9.0), egui::vec2(w.min(right - x), 18.0));
        p.rect_filled(r, CornerRadius::same(3), theme::fade(color, if current { 0.45 } else { 0.25 }));
        if current {
            p.rect_stroke(r, CornerRadius::same(3), Stroke::new(1.0, theme::fade(color, 0.9)), egui::StrokeKind::Inside);
        }
        let ic = Pos2::new(r.left() + 9.0, r.center().y);
        match l.kind {
            RefKind::Head { .. } => p.circle_filled(ic, 3.5, theme::fade(color, 0.95)),
            RefKind::Remote { .. } => p.circle_stroke(ic, 3.0, Stroke::new(1.5, theme::fade(color, 0.95))),
            RefKind::Tag => p.add(Shape::convex_polygon(
                vec![ic + egui::vec2(0.0, -4.0), ic + egui::vec2(4.0, 0.0), ic + egui::vec2(0.0, 4.0), ic + egui::vec2(-4.0, 0.0)],
                theme::fade(color, 0.95),
                Stroke::NONE,
            )),
        };
        p.with_clip_rect(r).galley(Pos2::new(r.left() + 18.0, r.center().y - g.size().y / 2.0), g, theme::TEXT_NORMAL);
        out.push((r, (*l).clone()));
        x += w + 4.0;
    }
    if hidden > 0 {
        p.text(Pos2::new(x, zone.center().y), Align2::LEFT_CENTER, format!("+{hidden}"), font, theme::TEXT_SECONDARY);
    }
    out
}

fn draw_lanes(p: &egui::Painter, graph: Rect, lay: &RowLayout, rect: Rect) {
    let p = p.with_clip_rect(graph);
    let top = rect.top();
    let bottom = rect.bottom();
    let mid = rect.center().y;
    let node_x = lane_x(graph, lay.column);
    for (col, e) in &lay.edges {
        let x = lane_x(graph, *col);
        let lane_color = theme::graph_color(*col);
        let stroke_for = |kind: NodeKind| Stroke::new(LINE_W, if kind == NodeKind::Wip { theme::fade(lane_color, 0.5) } else { lane_color });
        if let Some(pass) = e.pass {
            let s = stroke_for(pass.kind);
            if pass.kind == NodeKind::Wip {
                p.add(Shape::dashed_line(&[Pos2::new(x, top), Pos2::new(x, bottom)], s, 4.0, 3.0));
            } else {
                p.line_segment([Pos2::new(x, top), Pos2::new(x, bottom)], s);
            }
        }
        if let Some(end) = e.ending {
            let s = stroke_for(end.kind);
            if *col == lay.column {
                if end.kind == NodeKind::Wip {
                    p.add(Shape::dashed_line(&[Pos2::new(x, top), Pos2::new(x, mid)], s, 4.0, 3.0));
                } else {
                    p.line_segment([Pos2::new(x, top), Pos2::new(x, mid)], s);
                }
            } else {
                let curve = CubicBezierShape::from_points_stroke(
                    [Pos2::new(x, top), Pos2::new(x, mid), Pos2::new(x, mid), Pos2::new(node_x, mid)],
                    false,
                    Color32::TRANSPARENT,
                    s,
                );
                p.add(curve);
            }
        }
        if let Some(start) = e.starting {
            let s = stroke_for(start.kind);
            if *col == lay.column {
                p.line_segment([Pos2::new(x, mid), Pos2::new(x, bottom)], s);
            } else {
                let curve = CubicBezierShape::from_points_stroke(
                    [Pos2::new(node_x, mid), Pos2::new(x, mid), Pos2::new(x, mid), Pos2::new(x, bottom)],
                    false,
                    Color32::TRANSPARENT,
                    s,
                );
                p.add(curve);
            }
        }
    }
}

fn draw_node(p: &egui::Painter, graph: Rect, lay: &RowLayout, c: &Commit, color: Color32) {
    let p = p.with_clip_rect(graph);
    let center = Pos2::new(lane_x(graph, lay.column), graph.center().y);
    match c.kind {
        NodeKind::Merge => {
            p.circle_filled(center, MERGE_R, color);
        }
        NodeKind::Stash => {
            let r = Rect::from_center_size(center, egui::vec2(NODE_R * 2.0 - 4.0, NODE_R * 2.0 - 4.0));
            p.rect_filled(r, CornerRadius::same(2), theme::APP_BG);
            p.rect_stroke(r, CornerRadius::same(2), Stroke::new(LINE_W, color), egui::StrokeKind::Inside);
            p.text(center, Align2::CENTER_CENTER, "≡", FontId::proportional(13.0), color);
        }
        NodeKind::Wip => {
            p.circle_filled(center, NODE_R, theme::APP_BG);
            let pts: Vec<Pos2> = (0..=36)
                .map(|i| {
                    let a = i as f32 / 36.0 * std::f32::consts::TAU;
                    Pos2::new(center.x + NODE_R * a.cos(), center.y + NODE_R * a.sin())
                })
                .collect();
            p.add(Shape::dashed_line(&pts, Stroke::new(LINE_W, color), 3.0, 2.5));
            p.circle_filled(center, 3.0, theme::fade(color, 0.9));
        }
        NodeKind::Commit => {
            p.circle_filled(center, NODE_R, theme::APP_BG);
            p.circle_stroke(center, NODE_R, Stroke::new(LINE_W, color));
            super::avatar(&p, center, NODE_R - LINE_W, &c.author, &c.email, color);
        }
    }
}

fn context_menu(ui: &mut Ui, view: &RepoView, c: &Commit, refs: &[RefLabel], actions: &mut Vec<Action>) {
    ui.set_min_width(240.0);
    let head = view.head_name();
    if c.kind == NodeKind::Wip {
        if ui.button("Stash everything").clicked() {
            actions.push(Action::Dialog(Dialog::Stash { message: String::new(), include_untracked: true }));
            ui.close();
        }
        if ui.button("Stage everything").clicked() {
            actions.push(Action::StageAll);
            ui.close();
        }
        ui.separator();
        if ui.button(egui::RichText::new("Throw away all changes").color(theme::RED)).clicked() {
            actions.push(Action::Dialog(Dialog::Confirm {
                message: "Every staged, unstaged and untracked change in the working tree will be lost. Continue?".into(),
                action: Box::new(Action::DiscardAll),
            }));
            ui.close();
        }
        return;
    }
    if let Some(s) = view.stash_at(c.id) {
        super::left_panel::stash_menu(ui, s.index, &s.message, actions);
        return;
    }
    let is_head = view.data.head_oid == Some(c.id);
    for l in refs {
        match &l.kind {
            RefKind::Head { current: false } => {
                if ui.button(format!("Switch to {}", l.name)).clicked() {
                    actions.push(Action::Checkout(l.name.clone()));
                    ui.close();
                }
            }
            RefKind::Remote { .. } => {
                if ui.button(format!("Switch to {}", l.name)).clicked() {
                    actions.push(Action::CheckoutRemote(l.name.clone()));
                    ui.close();
                }
            }
            _ => {}
        }
    }
    if !is_head && ui.button("Check out here (no branch)").on_hover_text("Leaves you on no branch").clicked() {
        actions.push(Action::CheckoutCommit(c.id));
        ui.close();
    }
    if ui.button("New branch from here").clicked() {
        actions.push(Action::Dialog(Dialog::CreateBranch { at: c.id, name: String::new(), checkout: false }));
        ui.close();
    }
    if ui.button("New tag here").clicked() {
        actions.push(Action::Dialog(Dialog::CreateTag { at: c.id, name: String::new(), message: String::new() }));
        ui.close();
    }
    ui.separator();
    if view.data.head_branch.is_some() {
        for l in refs {
            if matches!(l.kind, RefKind::Head { current: false } | RefKind::Remote { .. }) {
                if ui.button(format!("Merge {} into {}", l.name, head)).clicked() {
                    actions.push(Action::Merge(l.name.clone()));
                    ui.close();
                }
                if ui.button(format!("Rebase {} onto {}", head, l.name)).clicked() {
                    actions.push(Action::Rebase(l.name.clone()));
                    ui.close();
                }
            }
        }
        if !is_head && ui.button(format!("Rebase {head} here")).clicked() {
            actions.push(Action::Rebase(c.id.to_string()));
            ui.close();
        }
        if !is_head && ui.button(format!("Reset {head} to this commit...")).clicked() {
            actions.push(Action::Dialog(Dialog::Reset { at: c.id }));
            ui.close();
        }
    }
    if !is_head && ui.button("Cherry-pick this commit").clicked() {
        actions.push(Action::CherryPick(c.id));
        ui.close();
    }
    if ui.button("Revert this commit").clicked() {
        actions.push(Action::Revert(c.id));
        ui.close();
    }
    ui.separator();
    for l in refs {
        if let RefKind::Head { current: false } = l.kind {
            if ui.button(format!("Rename {}", l.name)).clicked() {
                actions.push(Action::Dialog(Dialog::RenameBranch { old: l.name.clone(), name: l.name.clone() }));
                ui.close();
            }
            if ui.button(egui::RichText::new(format!("Delete {}", l.name)).color(theme::RED)).clicked() {
                actions.push(Action::Dialog(Dialog::Confirm {
                    message: format!("Delete \"{}\"? This cannot be undone.", l.name),
                    action: Box::new(Action::DeleteBranch(l.name.clone())),
                }));
                ui.close();
            }
        }
        if l.kind == RefKind::Tag && ui.button(egui::RichText::new(format!("Delete tag {}", l.name)).color(theme::RED)).clicked() {
            actions.push(Action::Dialog(Dialog::Confirm {
                message: format!("Delete \"{}\"? This cannot be undone.", l.name),
                action: Box::new(Action::DeleteTag(l.name.clone())),
            }));
            ui.close();
        }
    }
    if ui.button("Copy full hash").clicked() {
        actions.push(Action::Copy(c.id.to_string()));
        ui.close();
    }
}
