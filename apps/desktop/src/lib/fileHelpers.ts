import { fsReadFile } from "./ipc";
import { useWorkspaceStore } from "../stores/workspace";

export async function openFileByPath(filePath: string) {
  const rootPath = useWorkspaceStore.getState().rootPath;
  const fullPath = filePath.startsWith("/") ? filePath : `${rootPath}/${filePath}`;
  const name = filePath.split("/").pop() || filePath;

  try {
    const { content, language } = await fsReadFile(fullPath);
    useWorkspaceStore.getState().openFile({
      path: fullPath,
      name,
      content,
      isDirty: false,
      language,
    });
  } catch (err) {
    console.warn("Failed to open file:", filePath, err);
  }
}

/** Open a file and reveal/highlight a specific 1-based line (used by lesson code refs). */
export async function openFileAtLine(filePath: string, line: number) {
  const rootPath = useWorkspaceStore.getState().rootPath;
  const fullPath = filePath.startsWith("/") ? filePath : `${rootPath}/${filePath}`;
  const name = filePath.split("/").pop() || filePath;

  try {
    const { content, language } = await fsReadFile(fullPath);
    useWorkspaceStore.getState().openFile({
      path: fullPath,
      name,
      content,
      isDirty: false,
      language,
      revealLine: line,
    });
  } catch (err) {
    console.warn("Failed to open file at line:", filePath, line, err);
  }
}
