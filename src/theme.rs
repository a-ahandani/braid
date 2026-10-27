use egui::{Color32, CornerRadius, Stroke, Visuals};

pub const APP_BG: Color32 = Color32::from_rgb(0x15, 0x17, 0x1c);
pub const TOOLBAR_BG: Color32 = Color32::from_rgb(0x23, 0x26, 0x2e);
pub const PANEL_BG0: Color32 = Color32::from_rgb(0x1d, 0x20, 0x26);
pub const PANEL_BG1: Color32 = Color32::from_rgb(0x27, 0x2b, 0x33);
pub const PANEL_BG2: Color32 = Color32::from_rgb(0x33, 0x38, 0x41);
pub const BORDER: Color32 = Color32::from_rgba_premultiplied(0x14, 0x14, 0x14, 0x14);

pub const TEXT_BRIGHT: Color32 = Color32::from_rgb(0xf4, 0xf5, 0xf7);
pub const TEXT_NORMAL: Color32 = Color32::from_rgba_premultiplied(0xc4, 0xc6, 0xcc, 0xcc);
pub const TEXT_SECONDARY: Color32 = Color32::from_rgba_premultiplied(0x8e, 0x92, 0x9c, 0x9c);
pub const TEXT_DISABLED: Color32 = Color32::from_rgba_premultiplied(0x5e, 0x62, 0x6b, 0x6b);

pub const BLUE: Color32 = Color32::from_rgb(0x5b, 0x9c, 0xf6);
pub const GREEN: Color32 = Color32::from_rgb(0x3f, 0xb9, 0x50);
pub const RED: Color32 = Color32::from_rgb(0xe5, 0x53, 0x4b);
pub const ORANGE: Color32 = Color32::from_rgb(0xf0, 0x8a, 0x24);
pub const YELLOW: Color32 = Color32::from_rgb(0xe3, 0xb3, 0x41);

pub const GRAPH_COLORS: [Color32; 10] = [
    Color32::from_rgb(0x5b, 0x9c, 0xf6),
    Color32::from_rgb(0x3f, 0xb9, 0x50),
    Color32::from_rgb(0xf0, 0x8a, 0x24),
    Color32::from_rgb(0xe0, 0x5f, 0xb8),
    Color32::from_rgb(0x9a, 0x7c, 0xf5),
    Color32::from_rgb(0x2c, 0xb5, 0xa8),
    Color32::from_rgb(0xe5, 0x53, 0x4b),
    Color32::from_rgb(0xe3, 0xb3, 0x41),
    Color32::from_rgb(0x4a, 0xc8, 0xe8),
    Color32::from_rgb(0xb4, 0xc9, 0x3e),
];

pub fn graph_color(column: usize) -> Color32 {
    GRAPH_COLORS[column % GRAPH_COLORS.len()]
}

pub fn fade(c: Color32, alpha: f32) -> Color32 {
    Color32::from_rgba_unmultiplied(c.r(), c.g(), c.b(), (alpha * 255.0) as u8)
}

pub fn hover_row() -> Color32 {
    fade(BLUE, 0.12)
}

pub fn selected_row() -> Color32 {
    fade(BLUE, 0.22)
}

pub fn visuals() -> Visuals {
    let mut v = Visuals::dark();
    v.panel_fill = PANEL_BG0;
    v.window_fill = PANEL_BG1;
    v.extreme_bg_color = fade(Color32::BLACK, 0.2);
    v.faint_bg_color = PANEL_BG1;
    v.override_text_color = Some(TEXT_NORMAL);
    v.selection.bg_fill = fade(BLUE, 0.35);
    v.selection.stroke = Stroke::new(1.0, BLUE);
    v.hyperlink_color = Color32::from_rgb(0x4a, 0xc8, 0xe8);
    v.widgets.noninteractive.bg_fill = PANEL_BG0;
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, BORDER);
    v.widgets.inactive.bg_fill = PANEL_BG1;
    v.widgets.inactive.weak_bg_fill = PANEL_BG1;
    v.widgets.hovered.bg_fill = PANEL_BG2;
    v.widgets.hovered.weak_bg_fill = PANEL_BG2;
    v.widgets.active.bg_fill = fade(BLUE, 0.4);
    v.widgets.active.weak_bg_fill = fade(BLUE, 0.4);
    v.window_corner_radius = CornerRadius::same(6);
    v.menu_corner_radius = CornerRadius::same(4);
    v.window_stroke = Stroke::new(1.0, BORDER);
    v
}
