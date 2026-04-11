# Tide IDE v0.2.0 Tasks

## Priority 1: Testing Foundation

- [x] **Task 1: Add Vitest + first test suite**
  - Set up Vitest in apps/desktop (`vitest.config.ts`, `setup.ts`)
  - Unit tests for stores: `stream.test.ts`, `workspace.test.ts`
  - Unit tests for IPC layer (`ipc.test.ts`)
  - Rust tests for indexer: `schema.rs` (5 tests), `query.rs` (7 tests)
  - Added `test` and `test:watch` scripts to package.json files
  - **Note:** `pnpm install` blocked by VS Code file lock — run after closing VS Code

- [x] **Task 2: Fix panicking unwrap()/expect() in Rust**
  - `lib.rs:19` — `expect()` → `unwrap_or_else` with fallback to "."
  - `keychain.rs:58-68` — `with_store` now returns `Result`, handles mutex poisoning
  - `lib.rs:664,711` — `to_string_pretty().unwrap()` → `.map_err()` error propagation

- [x] **Task 3: Add test step to CI**
  - Added `pnpm test` step to ci.yml (runs after dependency install)
  - Added `cargo test` step for Rust backend
  - Both steps fail CI on test failures

## Priority 2: Performance

- [ ] **Task 4: Virtualize FileTree** — react-window/react-virtual for large projects
- [ ] **Task 5: Split lib.rs into modules** — commands/, cli.rs, platform/
- [ ] **Task 6: Granular Zustand selectors + memoize TreeItem/EditorTabs**
- [ ] **Task 7: Code-split Monaco + lazy load heavy panels**

## Priority 3: Distribution

- [ ] **Task 8: Wire up code signing in release workflow** — Apple notarization, Windows Authenticode
- [ ] **Task 9: Update README** — Linux is ready, not "planned"
- [ ] **Task 10: Replace 38 `any` types with proper interfaces**
