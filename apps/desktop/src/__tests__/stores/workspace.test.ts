import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "../../stores/workspace";

describe("useWorkspaceStore", () => {
  beforeEach(() => {
    // Reset store between tests
    useWorkspaceStore.setState({
      rootPath: null,
      fileTree: [],
      expandedDirs: new Set(),
      openTabs: [],
      activeTabPath: null,
    });
  });

  it("sets root path", () => {
    useWorkspaceStore.getState().setRootPath("/tmp/project");
    expect(useWorkspaceStore.getState().rootPath).toBe("/tmp/project");
  });

  it("opens a file tab", () => {
    const tab = {
      path: "/tmp/project/main.ts",
      name: "main.ts",
      content: "console.log('hello');",
      isDirty: false,
      language: "typescript",
    };

    useWorkspaceStore.getState().openFile(tab);
    const state = useWorkspaceStore.getState();

    expect(state.openTabs).toHaveLength(1);
    expect(state.openTabs[0].path).toBe("/tmp/project/main.ts");
    expect(state.activeTabPath).toBe("/tmp/project/main.ts");
  });

  it("does not duplicate an already-open tab", () => {
    const tab = {
      path: "/tmp/project/main.ts",
      name: "main.ts",
      content: "hello",
      isDirty: false,
      language: "typescript",
    };

    useWorkspaceStore.getState().openFile(tab);
    useWorkspaceStore.getState().openFile(tab);
    expect(useWorkspaceStore.getState().openTabs).toHaveLength(1);
  });

  it("closes a tab and selects an adjacent one", () => {
    const tabA = { path: "/a.ts", name: "a.ts", content: "", isDirty: false, language: "typescript" };
    const tabB = { path: "/b.ts", name: "b.ts", content: "", isDirty: false, language: "typescript" };
    const tabC = { path: "/c.ts", name: "c.ts", content: "", isDirty: false, language: "typescript" };

    const { openFile, closeTab } = useWorkspaceStore.getState();
    openFile(tabA);
    openFile(tabB);
    openFile(tabC);

    // Active tab is C (last opened)
    useWorkspaceStore.getState().setActiveTab("/b.ts");
    closeTab("/b.ts");

    const state = useWorkspaceStore.getState();
    expect(state.openTabs).toHaveLength(2);
    // Should select adjacent tab (c.ts at index 1, clamped)
    expect(state.activeTabPath).toBe("/c.ts");
  });

  it("marks tab dirty on content update", () => {
    const tab = { path: "/a.ts", name: "a.ts", content: "original", isDirty: false, language: "typescript" };
    useWorkspaceStore.getState().openFile(tab);
    useWorkspaceStore.getState().updateTabContent("/a.ts", "modified");

    const updated = useWorkspaceStore.getState().openTabs[0];
    expect(updated.content).toBe("modified");
    expect(updated.isDirty).toBe(true);
  });

  it("toggles directory expansion", () => {
    useWorkspaceStore.getState().toggleDir("/src");
    expect(useWorkspaceStore.getState().expandedDirs.has("/src")).toBe(true);

    useWorkspaceStore.getState().toggleDir("/src");
    expect(useWorkspaceStore.getState().expandedDirs.has("/src")).toBe(false);
  });

  it("inserts children into the file tree", () => {
    const tree = [
      { name: "src", path: "/src", isDir: true },
      { name: "README.md", path: "/README.md", isDir: false },
    ];
    useWorkspaceStore.getState().setFileTree(tree);

    const children = [
      { name: "index.ts", path: "/src/index.ts", isDir: false },
    ];
    useWorkspaceStore.getState().setDirChildren("/src", children);

    const srcNode = useWorkspaceStore.getState().fileTree.find((e) => e.path === "/src");
    expect(srcNode?.children).toHaveLength(1);
    expect(srcNode?.children?.[0].name).toBe("index.ts");
  });

  it("sets active tab to null when last tab closed", () => {
    const tab = { path: "/a.ts", name: "a.ts", content: "", isDirty: false, language: "typescript" };
    useWorkspaceStore.getState().openFile(tab);
    useWorkspaceStore.getState().closeTab("/a.ts");

    expect(useWorkspaceStore.getState().openTabs).toHaveLength(0);
    expect(useWorkspaceStore.getState().activeTabPath).toBeNull();
  });
});
