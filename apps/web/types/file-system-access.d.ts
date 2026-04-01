/** File System Access API (Chromium) — augment until lib.dom includes full surface. */

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: FileSystemHandle | string;
  }): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
}
