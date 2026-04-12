use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct FileNode {
    pub rel_path: String,
    pub language: String,
    pub symbol_count: u32,
    pub line_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolOutline {
    pub symbol_id: String,
    pub name: String,
    pub qualified_name: String,
    pub kind: String,
    pub start_line: u32,
    pub end_line: u32,
    pub signature: Option<String>,
    pub parent_symbol_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolDetail {
    pub symbol_id: String,
    pub name: String,
    pub qualified_name: String,
    pub kind: String,
    pub start_line: u32,
    pub end_line: u32,
    pub signature: Option<String>,
    pub docstring: Option<String>,
    pub body: String,
    pub file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoOutline {
    pub root: String,
    pub total_files: u32,
    pub total_symbols: u32,
    pub files: Vec<FileNode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMatch {
    pub file_path: String,
    pub line: u32,
    pub content: String,
}

pub fn get_file_tree(conn: &Connection, repo_id: i64) -> rusqlite::Result<Vec<FileNode>> {
    let mut stmt = conn.prepare(
        "SELECT f.rel_path, f.language, f.line_count, COUNT(s.id) as sym_count
         FROM files f
         LEFT JOIN symbols s ON s.file_id = f.id
         WHERE f.repo_id = ?1
         GROUP BY f.id
         ORDER BY f.rel_path",
    )?;
    let rows = stmt.query_map([repo_id], |row| {
        Ok(FileNode {
            rel_path: row.get(0)?,
            language: row.get(1)?,
            line_count: row.get::<_, u32>(2)?,
            symbol_count: row.get::<_, u32>(3)?,
        })
    })?;
    rows.collect()
}

pub fn get_file_outline(
    conn: &Connection,
    repo_id: i64,
    rel_path: &str,
) -> rusqlite::Result<Vec<SymbolOutline>> {
    let mut stmt = conn.prepare(
        "SELECT s.symbol_id, s.name, s.qualified_name, s.kind,
                s.start_line, s.end_line, s.signature, s.parent_symbol_id
         FROM symbols s
         JOIN files f ON s.file_id = f.id
         WHERE f.repo_id = ?1 AND f.rel_path = ?2
         ORDER BY s.start_line",
    )?;
    let rows = stmt.query_map(rusqlite::params![repo_id, rel_path], |row| {
        Ok(SymbolOutline {
            symbol_id: row.get(0)?,
            name: row.get(1)?,
            qualified_name: row.get(2)?,
            kind: row.get(3)?,
            start_line: row.get(4)?,
            end_line: row.get(5)?,
            signature: row.get(6)?,
            parent_symbol_id: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn get_symbol(
    conn: &Connection,
    workspace_root: &str,
    symbol_id: &str,
) -> rusqlite::Result<Option<SymbolDetail>> {
    let mut stmt = conn.prepare(
        "SELECT s.symbol_id, s.name, s.qualified_name, s.kind,
                s.start_line, s.end_line, s.signature, s.docstring,
                f.rel_path
         FROM symbols s
         JOIN files f ON s.file_id = f.id
         WHERE s.symbol_id = ?1
         LIMIT 1",
    )?;

    let result = stmt.query_row([symbol_id], |row| {
        Ok((
            SymbolOutline {
                symbol_id: row.get(0)?,
                name: row.get(1)?,
                qualified_name: row.get(2)?,
                kind: row.get(3)?,
                start_line: row.get(4)?,
                end_line: row.get(5)?,
                signature: row.get(6)?,
                parent_symbol_id: None,
            },
            row.get::<_, Option<String>>(7)?,
            row.get::<_, String>(8)?,
        ))
    });

    match result {
        Ok((outline, docstring, rel_path)) => {
            let full_path = Path::new(workspace_root).join(&rel_path);
            let body = if full_path.exists() {
                let content = std::fs::read_to_string(&full_path).unwrap_or_default();
                let lines: Vec<&str> = content.lines().collect();
                let start = (outline.start_line as usize).saturating_sub(1);
                let end = (outline.end_line as usize).min(lines.len());
                lines[start..end].join("\n")
            } else {
                String::new()
            };

            Ok(Some(SymbolDetail {
                symbol_id: outline.symbol_id,
                name: outline.name,
                qualified_name: outline.qualified_name,
                kind: outline.kind,
                start_line: outline.start_line,
                end_line: outline.end_line,
                signature: outline.signature,
                docstring,
                body,
                file_path: rel_path,
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn search_symbols(
    conn: &Connection,
    repo_id: i64,
    query: &str,
    kind_filter: Option<&str>,
    limit: u32,
) -> rusqlite::Result<Vec<SymbolOutline>> {
    // Use FTS5 for search
    let fts_query = format!("{}*", query.replace('"', ""));

    let sql = if kind_filter.is_some() {
        "SELECT s.symbol_id, s.name, s.qualified_name, s.kind,
                s.start_line, s.end_line, s.signature, s.parent_symbol_id
         FROM symbols s
         JOIN files f ON s.file_id = f.id
         JOIN symbols_fts fts ON fts.rowid = s.id
         WHERE f.repo_id = ?1 AND fts.symbols_fts MATCH ?2 AND s.kind = ?3
         ORDER BY rank
         LIMIT ?4"
    } else {
        "SELECT s.symbol_id, s.name, s.qualified_name, s.kind,
                s.start_line, s.end_line, s.signature, s.parent_symbol_id
         FROM symbols s
         JOIN files f ON s.file_id = f.id
         JOIN symbols_fts fts ON fts.rowid = s.id
         WHERE f.repo_id = ?1 AND fts.symbols_fts MATCH ?2
         ORDER BY rank
         LIMIT ?4"
    };

    let mut stmt = conn.prepare(sql)?;

    let mut results = Vec::new();
    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<SymbolOutline> {
        Ok(SymbolOutline {
            symbol_id: row.get(0)?,
            name: row.get(1)?,
            qualified_name: row.get(2)?,
            kind: row.get(3)?,
            start_line: row.get(4)?,
            end_line: row.get(5)?,
            signature: row.get(6)?,
            parent_symbol_id: row.get(7)?,
        })
    };

    if let Some(kind) = kind_filter {
        let rows = stmt.query_map(rusqlite::params![repo_id, fts_query, kind, limit], map_row)?;
        for row in rows {
            results.push(row?);
        }
    } else {
        let rows = stmt.query_map(rusqlite::params![repo_id, fts_query, "", limit], map_row)?;
        for row in rows {
            results.push(row?);
        }
    };
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::indexer::schema;

    fn setup_db() -> (Connection, i64, i64) {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        schema::create_tables(&conn).unwrap();

        conn.execute("INSERT INTO repos (root_path) VALUES ('/project')", []).unwrap();
        let repo_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO files (repo_id, rel_path, language, content_hash, line_count, byte_size, indexed_at) VALUES (?1, 'src/main.rs', 'rust', 'hash1', 50, 1024, '2025-01-01')",
            [repo_id],
        ).unwrap();
        let file_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO symbols (file_id, symbol_id, name, qualified_name, kind, start_line, end_line, start_col, end_col, signature) VALUES (?1, 'sym-main', 'main', 'crate::main', 'function', 1, 10, 0, 0, 'fn main()')",
            [file_id],
        ).unwrap();

        conn.execute(
            "INSERT INTO symbols (file_id, symbol_id, name, qualified_name, kind, start_line, end_line, start_col, end_col, signature) VALUES (?1, 'sym-helper', 'helper', 'crate::helper', 'function', 12, 20, 0, 0, 'fn helper() -> bool')",
            [file_id],
        ).unwrap();

        (conn, repo_id, file_id)
    }

    #[test]
    fn get_file_tree_returns_files() {
        let (conn, repo_id, _) = setup_db();
        let files = get_file_tree(&conn, repo_id).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].rel_path, "src/main.rs");
        assert_eq!(files[0].language, "rust");
        assert_eq!(files[0].symbol_count, 2);
    }

    #[test]
    fn get_file_outline_returns_symbols() {
        let (conn, repo_id, _) = setup_db();
        let symbols = get_file_outline(&conn, repo_id, "src/main.rs").unwrap();
        assert_eq!(symbols.len(), 2);
        assert_eq!(symbols[0].name, "main");
        assert_eq!(symbols[1].name, "helper");
    }

    #[test]
    fn get_file_outline_empty_for_unknown_path() {
        let (conn, repo_id, _) = setup_db();
        let symbols = get_file_outline(&conn, repo_id, "nonexistent.rs").unwrap();
        assert!(symbols.is_empty());
    }

    #[test]
    fn search_symbols_via_fts5() {
        let (conn, repo_id, _) = setup_db();
        let results = search_symbols(&conn, repo_id, "main", None, 10).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].name, "main");
    }

    #[test]
    fn search_symbols_with_kind_filter() {
        let (conn, repo_id, _) = setup_db();
        let results = search_symbols(&conn, repo_id, "main", Some("function"), 10).unwrap();
        assert!(!results.is_empty());

        let results = search_symbols(&conn, repo_id, "main", Some("class"), 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn get_repo_outline_aggregates() {
        let (conn, repo_id, _) = setup_db();
        let outline = get_repo_outline(&conn, repo_id).unwrap();
        assert_eq!(outline.root, "/project");
        assert_eq!(outline.total_files, 1);
        assert_eq!(outline.total_symbols, 2);
        assert_eq!(outline.files.len(), 1);
    }

    #[test]
    fn get_symbol_not_found() {
        let (conn, _, _) = setup_db();
        let result = get_symbol(&conn, "/project", "nonexistent-id").unwrap();
        assert!(result.is_none());
    }
}

pub fn get_repo_outline(conn: &Connection, repo_id: i64) -> rusqlite::Result<RepoOutline> {
    let root: String = conn.query_row(
        "SELECT root_path FROM repos WHERE id = ?1",
        [repo_id],
        |row| row.get(0),
    )?;

    let total_files: u32 = conn.query_row(
        "SELECT COUNT(*) FROM files WHERE repo_id = ?1",
        [repo_id],
        |row| row.get(0),
    )?;

    let total_symbols: u32 = conn.query_row(
        "SELECT COUNT(*) FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.repo_id = ?1",
        [repo_id],
        |row| row.get(0),
    )?;

    let files = get_file_tree(conn, repo_id)?;

    Ok(RepoOutline {
        root,
        total_files,
        total_symbols,
        files,
    })
}
