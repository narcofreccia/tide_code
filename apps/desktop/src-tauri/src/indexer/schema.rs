use rusqlite::Connection;

pub fn create_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS repos (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            root_path   TEXT NOT NULL UNIQUE,
            last_indexed_at TEXT,
            file_count  INTEGER DEFAULT 0,
            symbol_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS files (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_id      INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
            rel_path     TEXT NOT NULL,
            language     TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            line_count   INTEGER DEFAULT 0,
            byte_size    INTEGER DEFAULT 0,
            indexed_at   TEXT NOT NULL,
            UNIQUE(repo_id, rel_path)
        );

        CREATE TABLE IF NOT EXISTS symbols (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id          INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            symbol_id        TEXT NOT NULL,
            name             TEXT NOT NULL,
            qualified_name   TEXT NOT NULL,
            kind             TEXT NOT NULL,
            start_line       INTEGER NOT NULL,
            end_line         INTEGER NOT NULL,
            start_col        INTEGER NOT NULL,
            end_col          INTEGER NOT NULL,
            signature        TEXT,
            docstring        TEXT,
            parent_symbol_id TEXT,
            visibility       TEXT,
            is_exported      INTEGER DEFAULT 0,
            body_hash        TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
        CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
        CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
        CREATE INDEX IF NOT EXISTS idx_symbols_qualified ON symbols(qualified_name);
        CREATE INDEX IF NOT EXISTS idx_symbols_symbol_id ON symbols(symbol_id);
        CREATE INDEX IF NOT EXISTS idx_files_repo ON files(repo_id);
        CREATE INDEX IF NOT EXISTS idx_files_path ON files(repo_id, rel_path);
        ",
    )?;

    // FTS5 virtual table for symbol search
    // We create this separately since CREATE VIRTUAL TABLE doesn't support IF NOT EXISTS
    // in all SQLite versions the same way
    let has_fts: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='symbols_fts'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !has_fts {
        conn.execute_batch(
            "
            CREATE VIRTUAL TABLE symbols_fts USING fts5(
                name, qualified_name, signature, docstring,
                content=symbols, content_rowid=id
            );
            ",
        )?;
    }

    // Triggers to keep FTS in sync
    conn.execute_batch(
        "
        CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
            INSERT INTO symbols_fts(rowid, name, qualified_name, signature, docstring)
            VALUES (new.id, new.name, new.qualified_name, new.signature, new.docstring);
        END;

        CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
            INSERT INTO symbols_fts(symbols_fts, rowid, name, qualified_name, signature, docstring)
            VALUES ('delete', old.id, old.name, old.qualified_name, old.signature, old.docstring);
        END;

        CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
            INSERT INTO symbols_fts(symbols_fts, rowid, name, qualified_name, signature, docstring)
            VALUES ('delete', old.id, old.name, old.qualified_name, old.signature, old.docstring);
            INSERT INTO symbols_fts(rowid, name, qualified_name, signature, docstring)
            VALUES (new.id, new.name, new.qualified_name, new.signature, new.docstring);
        END;
        ",
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        create_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn create_tables_succeeds() {
        let conn = in_memory_db();
        // Verify core tables exist
        let count: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('repos','files','symbols')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn create_tables_is_idempotent() {
        let conn = in_memory_db();
        // Should not fail when called a second time
        create_tables(&conn).unwrap();
    }

    #[test]
    fn fts5_table_created() {
        let conn = in_memory_db();
        let has_fts: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='symbols_fts'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(has_fts);
    }

    #[test]
    fn insert_repo_and_file() {
        let conn = in_memory_db();
        conn.execute(
            "INSERT INTO repos (root_path) VALUES (?1)",
            ["/tmp/project"],
        )
        .unwrap();

        let repo_id: i64 = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO files (repo_id, rel_path, language, content_hash, indexed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![repo_id, "src/main.rs", "rust", "abc123", "2025-01-01T00:00:00"],
        )
        .unwrap();

        let file_count: u32 = conn
            .query_row("SELECT COUNT(*) FROM files WHERE repo_id = ?1", [repo_id], |row| row.get(0))
            .unwrap();
        assert_eq!(file_count, 1);
    }

    #[test]
    fn cascade_delete_removes_symbols() {
        let conn = in_memory_db();
        conn.execute("INSERT INTO repos (root_path) VALUES ('/tmp')", []).unwrap();
        let repo_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO files (repo_id, rel_path, language, content_hash, indexed_at) VALUES (?1, 'a.rs', 'rust', 'h', '2025-01-01')",
            [repo_id],
        ).unwrap();
        let file_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO symbols (file_id, symbol_id, name, qualified_name, kind, start_line, end_line, start_col, end_col) VALUES (?1, 'sym1', 'main', 'main', 'function', 1, 10, 0, 0)",
            [file_id],
        ).unwrap();

        // Delete the file — symbol should cascade
        conn.execute("DELETE FROM files WHERE id = ?1", [file_id]).unwrap();
        let sym_count: u32 = conn
            .query_row("SELECT COUNT(*) FROM symbols", [], |row| row.get(0))
            .unwrap();
        assert_eq!(sym_count, 0);
    }
}
