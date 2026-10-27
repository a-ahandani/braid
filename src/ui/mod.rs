pub mod detail_panel;
pub mod dialogs;
pub mod graph_view;
pub mod left_panel;
pub mod toolbar;

use egui::load::{SizeHint, TexturePoll};
use egui::{Align2, Color32, FontId, Painter, Pos2, Rect, TextureOptions};

use crate::theme;

pub fn initials(name: &str) -> String {
    let mut it = name.split_whitespace().filter_map(|w| w.chars().next());
    let a = it.next().unwrap_or('?');
    let b = it.last();
    match b {
        Some(b) => format!("{}{}", a, b).to_uppercase(),
        None => a.to_uppercase().to_string(),
    }
}

pub fn avatar(p: &Painter, center: Pos2, radius: f32, name: &str, email: &str, color: Color32) {
    if !email.is_empty() {
        let url = format!("https://www.gravatar.com/avatar/{:x}?s=64&d=404", md5::compute(email.trim().to_lowercase()));
        let hint = SizeHint::Size { width: 64, height: 64, maintain_aspect_ratio: true };
        if let Ok(TexturePoll::Ready { texture }) = p.ctx().try_load_texture(&url, TextureOptions::LINEAR, hint) {
            let mut mesh = egui::Mesh::with_texture(texture.id);
            mesh.vertices.push(egui::epaint::Vertex { pos: center, uv: Pos2::new(0.5, 0.5), color: Color32::WHITE });
            let n = 32u32;
            for i in 0..n {
                let a = i as f32 / n as f32 * std::f32::consts::TAU;
                mesh.vertices.push(egui::epaint::Vertex {
                    pos: Pos2::new(center.x + radius * a.cos(), center.y + radius * a.sin()),
                    uv: Pos2::new(0.5 + 0.5 * a.cos(), 0.5 + 0.5 * a.sin()),
                    color: Color32::WHITE,
                });
                mesh.add_triangle(0, 1 + i, 1 + (i + 1) % n);
            }
            p.add(egui::Shape::mesh(mesh));
            return;
        }
    }
    p.circle_filled(center, radius, theme::fade(color, 0.85));
    p.text(center, Align2::CENTER_CENTER, initials(name), FontId::proportional(radius * 0.95), Color32::WHITE);
}

pub fn date(time: i64) -> String {
    chrono::DateTime::from_timestamp(time, 0)
        .map(|d| d.with_timezone(&chrono::Local).format("%b %-d, %Y %-I:%M %p").to_string())
        .unwrap_or_default()
}

pub fn ago(time: i64) -> String {
    let secs = (chrono::Utc::now().timestamp() - time).max(0);
    let (n, unit) = if secs < 3600 {
        return "less than an hour ago".into();
    } else if secs < 86_400 {
        (secs / 3600, "hour")
    } else if secs < 7 * 86_400 {
        (secs / 86_400, "day")
    } else if secs < 30 * 86_400 {
        (secs / (7 * 86_400), "week")
    } else if secs < 365 * 86_400 {
        (secs / (30 * 86_400), "month")
    } else {
        (secs / (365 * 86_400), "year")
    };
    if n == 1 { format!("1 {unit} ago") } else { format!("{n} {unit}s ago") }
}

pub fn short(oid: &git2::Oid) -> String {
    oid.to_string()[..7].to_string()
}

pub fn text_in(p: &Painter, rect: Rect, text: &str, font: FontId, color: Color32) {
    p.with_clip_rect(rect).text(rect.left_center(), Align2::LEFT_CENTER, text, font, color);
}

pub fn status_color(kind: crate::repo::ChangeKind) -> Color32 {
    use crate::repo::ChangeKind::*;
    match kind {
        Added | Untracked => theme::GREEN,
        Deleted => theme::RED,
        Modified | TypeChange => theme::YELLOW,
        Renamed => theme::BLUE,
        Conflicted => theme::ORANGE,
    }
}
