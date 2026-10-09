export const MAX_LOCAL_FILE_SIZE = 25 * 1024 * 1024
export const FILE_DATABASE_NAME = 'moseek-local-files'
export const FILE_STORE_NAME = 'files'

function openFileDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FILE_STORE_NAME)) {
        request.result.createObjectStore(FILE_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withFileStore(mode, operation) {
  const database = await openFileDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FILE_STORE_NAME, mode)
    const request = operation(transaction.objectStore(FILE_STORE_NAME))
    let result
    request.onsuccess = () => { result = request.result }
    transaction.oncomplete = () => { database.close(); resolve(result) }
    transaction.onerror = () => { database.close(); reject(transaction.error) }
    transaction.onabort = () => { database.close(); reject(transaction.error) }
  })
}

export function storeLocalFile(id, file) {
  return withFileStore('readwrite', (store) => store.put({ id, file }))
}

export function getLocalFile(id) {
  return withFileStore('readonly', (store) => store.get(id)).then((record) => record?.file || null)
}

export function removeLocalFile(id) {
  return withFileStore('readwrite', (store) => store.delete(id))
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function canOpenLocalFile(resource) {
  return resource.mimeType === 'application/pdf' ||
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(resource.mimeType)
}

export function canPreviewImage(resource) {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(resource.mimeType)
}
