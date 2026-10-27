use std::collections::BTreeMap;

use git2::Oid;

use crate::repo::Commit;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NodeKind {
    Commit,
    Merge,
    Stash,
    Wip,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Edge {
    pub parent: Oid,
    pub kind: NodeKind,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RowEdge {
    pub ending: Option<Edge>,
    pub pass: Option<Edge>,
    pub starting: Option<Edge>,
}

#[derive(Clone, Debug, Default)]
pub struct RowLayout {
    pub column: usize,
    pub edges: BTreeMap<usize, RowEdge>,
}

fn take_free(lanes: &mut Vec<Option<Edge>>) -> usize {
    match lanes.iter().position(Option::is_none) {
        Some(i) => i,
        None => {
            lanes.push(None);
            lanes.len() - 1
        }
    }
}

pub fn layout(rows: &[Commit]) -> (Vec<RowLayout>, usize) {
    let mut lanes: Vec<Option<Edge>> = Vec::new();
    let mut out = Vec::with_capacity(rows.len());
    let mut max_col = 0;
    for row in rows {
        let mut edges: BTreeMap<usize, RowEdge> = BTreeMap::new();
        let mut column = None;
        for (i, lane) in lanes.iter_mut().enumerate() {
            let Some(e) = *lane else { continue };
            if e.parent == row.id {
                edges.entry(i).or_default().ending = Some(e);
                if column.is_none() {
                    column = Some(i);
                } else {
                    *lane = None;
                }
            } else {
                edges.entry(i).or_default().pass = Some(e);
            }
        }
        let column = column.unwrap_or_else(|| take_free(&mut lanes));
        let mut parents = row.parents.iter();
        lanes[column] = parents.next().map(|p| Edge { parent: *p, kind: row.kind });
        if let Some(e) = lanes[column] {
            edges.entry(column).or_default().starting = Some(e);
        }
        for p in parents {
            let e = Edge { parent: *p, kind: row.kind };
            let target = match lanes.iter().position(|l| l.is_some_and(|l| l.parent == *p)) {
                Some(i) => i,
                None => {
                    let i = take_free(&mut lanes);
                    lanes[i] = Some(e);
                    i
                }
            };
            edges.entry(target).or_default().starting = Some(e);
        }
        while lanes.last().is_some_and(Option::is_none) {
            lanes.pop();
        }
        max_col = max_col.max(column).max(edges.keys().next_back().copied().unwrap_or(0));
        out.push(RowLayout { column, edges });
    }
    (out, max_col)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(n: u8) -> Oid {
        Oid::from_bytes(&[n; 20]).unwrap()
    }

    fn row(id: u8, parents: &[u8], kind: NodeKind, time: i64) -> Commit {
        Commit {
            id: oid(id),
            parents: parents.iter().map(|p| oid(*p)).collect(),
            kind,
            time,
            author: String::new(),
            email: String::new(),
            summary: String::new(),
            body: String::new(),
        }
    }

    #[test]
    fn feature_branch_merge_uses_two_lanes_then_frees_one() {
        let rows = vec![
            row(5, &[4, 3], NodeKind::Merge, 50),
            row(4, &[2], NodeKind::Commit, 40),
            row(3, &[2], NodeKind::Commit, 30),
            row(2, &[1], NodeKind::Commit, 20),
            row(1, &[], NodeKind::Commit, 10),
        ];
        let (l, max) = layout(&rows);
        assert_eq!(l.iter().map(|r| r.column).collect::<Vec<_>>(), vec![0, 0, 1, 0, 0]);
        assert_eq!(max, 1);
        assert!(l[0].edges[&1].starting.is_some(), "merge edge starts in the feature lane");
        assert!(l[1].edges[&1].pass.is_some(), "feature lane passes through the main commit row");
        assert!(l[2].edges[&1].ending.is_some(), "feature lane ends at the feature commit");
        assert!(l[3].edges[&1].ending.is_some(), "feature lane curves into the base commit");
        assert!(l[4].edges.get(&1).is_none(), "lane 1 is free below the base commit");
    }

    #[test]
    fn second_parent_joins_an_existing_lane() {
        let rows = vec![
            row(6, &[5], NodeKind::Commit, 60),
            row(5, &[4, 3], NodeKind::Merge, 50),
            row(4, &[2], NodeKind::Commit, 40),
            row(3, &[2], NodeKind::Commit, 30),
            row(2, &[1], NodeKind::Commit, 20),
            row(1, &[], NodeKind::Commit, 10),
        ];
        let (l, max) = layout(&rows);
        assert_eq!(max, 1);
        assert_eq!(l[1].column, 0);
        assert_eq!(l[3].column, 1);
        assert_eq!(l[1].edges[&1].starting.map(|e| e.parent), Some(oid(3)));
    }

    #[test]
    fn wip_row_sits_on_head_lane() {
        let rows = vec![
            row(9, &[2], NodeKind::Wip, 99),
            row(2, &[1], NodeKind::Commit, 20),
            row(1, &[], NodeKind::Commit, 10),
        ];
        let (l, max) = layout(&rows);
        assert_eq!(l.iter().map(|r| r.column).collect::<Vec<_>>(), vec![0, 0, 0]);
        assert_eq!(max, 0);
        assert_eq!(l[1].edges[&0].ending.map(|e| e.kind), Some(NodeKind::Wip));
    }
}
