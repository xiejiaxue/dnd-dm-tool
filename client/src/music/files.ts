function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dm-music', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function fileStore(id: string, file?: Blob): Promise<Blob | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', file ? 'readwrite' : 'readonly');
    const request = file ? tx.objectStore('files').put(file, id) : tx.objectStore('files').get(id);
    tx.oncomplete = () => { db.close(); resolve(file ?? request.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
