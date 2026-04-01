/** File System Access API helpers (paths use forward slashes, relative to project root). */

export type DirEntry = { name: string; kind: "file" | "dir"; path: string };

export function hasDirectoryPicker(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickProjectDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!hasDirectoryPicker()) return null;
  try {
    return await window.showDirectoryPicker({ mode: "readwrite" });
  } catch {
    return null;
  }
}

async function walkDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  pathPrefix: string
): Promise<DirEntry[]> {
  const out: DirEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue;
    const p = pathPrefix ? `${pathPrefix}/${name}` : name;
    if (handle.kind === "directory") {
      out.push({ name, kind: "dir", path: p });
    } else {
      out.push({ name, kind: "file", path: p });
    }
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return out;
}

export async function listChildren(root: FileSystemDirectoryHandle, dirPath: string): Promise<DirEntry[]> {
  const dir = await resolveDirectory(root, dirPath);
  return walkDirectoryHandle(dir, dirPath);
}

async function resolveDirectory(
  root: FileSystemDirectoryHandle,
  relPath: string
): Promise<FileSystemDirectoryHandle> {
  let h: FileSystemDirectoryHandle = root;
  const parts = relPath.split("/").filter(Boolean);
  for (const part of parts) {
    h = await h.getDirectoryHandle(part);
  }
  return h;
}

export async function readTextFile(root: FileSystemDirectoryHandle, relPath: string): Promise<string> {
  const parts = relPath.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error("Invalid file path");
  let dir = root;
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p);
  }
  const fh = await dir.getFileHandle(fileName);
  const file = await fh.getFile();
  return file.text();
}

export async function writeTextFile(
  root: FileSystemDirectoryHandle,
  relPath: string,
  content: string
): Promise<void> {
  const parts = relPath.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error("Invalid file path");
  let dir = root;
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p, { create: true });
  }
  const fh = await dir.getFileHandle(fileName, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

export async function deleteEntry(root: FileSystemDirectoryHandle, relPath: string): Promise<void> {
  const parts = relPath.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error("Invalid path");
  let dir = root;
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p);
  }
  await dir.removeEntry(name);
}

export async function createEmptyFile(
  root: FileSystemDirectoryHandle,
  relPath: string
): Promise<void> {
  await writeTextFile(root, relPath, "");
}
