import "@testing-library/jest-dom/vitest";

// Mock Tauri invoke API — tests run outside the Tauri shell,
// so we provide a no-op stub that individual tests can override.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock Tauri event API
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));
