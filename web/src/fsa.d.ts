interface FileSystemDirectoryHandle {
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>
  keys(): AsyncIterableIterator<string>
}

interface Window {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite'; id?: string }): Promise<FileSystemDirectoryHandle>
}
