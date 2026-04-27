// Full audit-log query for the Event History panel.
//
// The live `swarm:update` channel only ships the most recent N events (the
// ring buffer in stores/swarm.ts). For deep-history exploration the UI calls
// `event_history_query` directly against `swarm.db`, paginating back through
// the events table by descending id.

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use swarm_protocol::Event;
use swarm_state::swarm_db_path;

use crate::model::AppError;

const DEFAULT_LIMIT: u32 = 200;
const MAX_LIMIT: u32 = 1000;

const KNOWN_CATEGORIES: &[&str] = &["message", "task", "kv", "context", "instance"];

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventHistoryQuery {
    /// Restrict to a single scope (None / null = all scopes).
    #[serde(default)]
    pub scope: Option<String>,
    /// Type-prefix categories to include (e.g. `message`, `task`). Empty or
    /// null means "all known categories"; unknown prefixes are dropped.
    #[serde(default)]
    pub categories: Option<Vec<String>>,
    /// Filter rows whose actor matches this instance id.
    #[serde(default)]
    pub actor: Option<String>,
    /// Filter rows whose subject matches this instance/task/etc id.
    #[serde(default)]
    pub subject: Option<String>,
    /// Substring match against either `type` or `payload`.
    #[serde(default)]
    pub text: Option<String>,
    /// Lower bound (inclusive) for `created_at`, unix seconds.
    #[serde(default)]
    pub start_at: Option<i64>,
    /// Upper bound (inclusive) for `created_at`, unix seconds.
    #[serde(default)]
    pub end_at: Option<i64>,
    /// Pagination cursor — return rows with `id < before_id`.
    #[serde(default)]
    pub before_id: Option<i64>,
    /// Max rows to return. Capped server-side at `MAX_LIMIT`.
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventHistoryPage {
    pub events: Vec<Event>,
    pub has_more: bool,
    pub oldest_id: Option<i64>,
    pub total_in_db: i64,
}

#[tauri::command]
pub fn event_history_query(query: EventHistoryQuery) -> Result<EventHistoryPage, AppError> {
    let path = swarm_db_path().map_err(AppError::Internal)?;
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|err| AppError::Operation(format!("failed to open swarm db: {err}")))?;

    let mut where_parts: Vec<String> = Vec::new();
    let mut params: Vec<SqlValue> = Vec::new();

    if let Some(scope) = query.scope.as_ref().filter(|s| !s.is_empty()) {
        where_parts.push("scope = ?".to_string());
        params.push(SqlValue::Text(scope.clone()));
    }

    if let Some(actor) = query.actor.as_ref().filter(|s| !s.is_empty()) {
        where_parts.push("actor = ?".to_string());
        params.push(SqlValue::Text(actor.clone()));
    }

    if let Some(subject) = query.subject.as_ref().filter(|s| !s.is_empty()) {
        where_parts.push("subject = ?".to_string());
        params.push(SqlValue::Text(subject.clone()));
    }

    if let Some(start) = query.start_at {
        where_parts.push("created_at >= ?".to_string());
        params.push(SqlValue::Integer(start));
    }

    if let Some(end) = query.end_at {
        where_parts.push("created_at <= ?".to_string());
        params.push(SqlValue::Integer(end));
    }

    if let Some(before) = query.before_id {
        where_parts.push("id < ?".to_string());
        params.push(SqlValue::Integer(before));
    }

    let categories = normalize_categories(query.categories.as_deref());
    if !categories.is_empty() {
        // Build "type LIKE ? OR type LIKE ? ..." — can't use IN with LIKE.
        let placeholders = categories
            .iter()
            .map(|_| "type LIKE ?")
            .collect::<Vec<_>>()
            .join(" OR ");
        where_parts.push(format!("({placeholders})"));
        for cat in &categories {
            params.push(SqlValue::Text(format!("{cat}.%")));
        }
    }

    if let Some(text) = query.text.as_ref().filter(|s| !s.is_empty()) {
        // Match either the type column or the JSON payload. SQLite LIKE is
        // case-insensitive for ASCII by default, which is what users expect
        // for searching event types like `task.created`.
        where_parts.push("(type LIKE ? OR IFNULL(payload, '') LIKE ?)".to_string());
        let pattern = format!("%{}%", escape_like(text));
        params.push(SqlValue::Text(pattern.clone()));
        params.push(SqlValue::Text(pattern));
    }

    let limit = query
        .limit
        .map_or(DEFAULT_LIMIT, |n| n.clamp(1, MAX_LIMIT))
        .min(MAX_LIMIT);

    let where_clause = if where_parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_parts.join(" AND "))
    };

    // Fetch limit+1 so we can report whether more rows exist beyond this page
    // without a second COUNT query.
    let probe_limit = i64::from(limit) + 1;
    let sql = format!(
        "SELECT id, scope, type, actor, subject, payload, created_at
           FROM events{where_clause}
          ORDER BY id DESC
          LIMIT ?"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| AppError::Operation(format!("failed to prepare events query: {err}")))?;
    let mut bound: Vec<SqlValue> = params.clone();
    bound.push(SqlValue::Integer(probe_limit));
    let bound_refs: Vec<&dyn rusqlite::ToSql> =
        bound.iter().map(|v| v as &dyn rusqlite::ToSql).collect();

    let mut rows = stmt
        .query_map(bound_refs.as_slice(), |row| {
            Ok(Event {
                id: row.get(0)?,
                scope: row.get(1)?,
                type_: row.get(2)?,
                actor: row.get(3)?,
                subject: row.get(4)?,
                payload: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|err| AppError::Operation(format!("failed to query events: {err}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| AppError::Operation(format!("failed to read events: {err}")))?;

    let limit_usize = limit as usize;
    let has_more = rows.len() > limit_usize;
    if has_more {
        rows.truncate(limit_usize);
    }

    let oldest_id = rows.last().map(|evt| evt.id);

    // Total row count (for the same filter set sans `before_id`) so the UI
    // can show "X of N events" without double-paginating. This stays cheap
    // because SQLite indexes scope/type and the events table is small.
    let total = count_total(&conn, &query)?;

    Ok(EventHistoryPage {
        events: rows,
        has_more,
        oldest_id,
        total_in_db: total,
    })
}

fn count_total(conn: &Connection, query: &EventHistoryQuery) -> Result<i64, AppError> {
    let mut where_parts: Vec<String> = Vec::new();
    let mut params: Vec<SqlValue> = Vec::new();

    if let Some(scope) = query.scope.as_ref().filter(|s| !s.is_empty()) {
        where_parts.push("scope = ?".to_string());
        params.push(SqlValue::Text(scope.clone()));
    }
    if let Some(actor) = query.actor.as_ref().filter(|s| !s.is_empty()) {
        where_parts.push("actor = ?".to_string());
        params.push(SqlValue::Text(actor.clone()));
    }
    if let Some(subject) = query.subject.as_ref().filter(|s| !s.is_empty()) {
        where_parts.push("subject = ?".to_string());
        params.push(SqlValue::Text(subject.clone()));
    }
    if let Some(start) = query.start_at {
        where_parts.push("created_at >= ?".to_string());
        params.push(SqlValue::Integer(start));
    }
    if let Some(end) = query.end_at {
        where_parts.push("created_at <= ?".to_string());
        params.push(SqlValue::Integer(end));
    }
    let categories = normalize_categories(query.categories.as_deref());
    if !categories.is_empty() {
        let placeholders = categories
            .iter()
            .map(|_| "type LIKE ?")
            .collect::<Vec<_>>()
            .join(" OR ");
        where_parts.push(format!("({placeholders})"));
        for cat in &categories {
            params.push(SqlValue::Text(format!("{cat}.%")));
        }
    }
    if let Some(text) = query.text.as_ref().filter(|s| !s.is_empty()) {
        where_parts.push("(type LIKE ? OR IFNULL(payload, '') LIKE ?)".to_string());
        let pattern = format!("%{}%", escape_like(text));
        params.push(SqlValue::Text(pattern.clone()));
        params.push(SqlValue::Text(pattern));
    }

    let where_clause = if where_parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_parts.join(" AND "))
    };
    let sql = format!("SELECT COUNT(*) FROM events{where_clause}");
    let bound_refs: Vec<&dyn rusqlite::ToSql> =
        params.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    conn.query_row(&sql, bound_refs.as_slice(), |row| row.get::<_, i64>(0))
        .map_err(|err| AppError::Operation(format!("failed to count events: {err}")))
}

/// Drop unknown / unsafe category strings so we never let user input reach
/// the LIKE pattern unsanitized. Returns the sanitized list — empty means
/// "no category filter".
fn normalize_categories(input: Option<&[String]>) -> Vec<String> {
    let Some(raw) = input else {
        return Vec::new();
    };
    if raw.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for entry in raw {
        let trimmed = entry.trim();
        if KNOWN_CATEGORIES.contains(&trimmed) && !out.iter().any(|c: &String| c == trimmed) {
            out.push(trimmed.to_string());
        }
    }
    // If the caller listed every known category, treat it the same as "no
    // filter" so the SQL stays simple.
    if out.len() == KNOWN_CATEGORIES.len() {
        return Vec::new();
    }
    out
}

fn escape_like(value: &str) -> String {
    // SQLite's LIKE supports `%` and `_` as wildcards; users typing those
    // characters mean them literally. There's no built-in ESCAPE clause on
    // our query, so just strip them (the alternative is appending ESCAPE '\'
    // and rewriting all LIKE clauses — overkill for free-text search).
    value.replace(['%', '_'], "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_categories_drops_unknown() {
        let input = vec!["task".to_string(), "bogus".to_string()];
        assert_eq!(normalize_categories(Some(&input)), vec!["task".to_string()]);
    }

    #[test]
    fn normalize_categories_collapses_full_set() {
        let input: Vec<String> = KNOWN_CATEGORIES.iter().map(|s| (*s).to_string()).collect();
        assert!(normalize_categories(Some(&input)).is_empty());
    }

    #[test]
    fn escape_like_strips_wildcards() {
        assert_eq!(escape_like("foo%bar_baz"), "foobarbaz");
    }
}
