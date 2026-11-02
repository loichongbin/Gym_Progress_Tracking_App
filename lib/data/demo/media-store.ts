// IndexedDB blob store for media uploaded in demo mode.
// Uploaded files are stored as Blobs and referenced as `idb:<id>` URLs, which the
// <Media> component resolves to object URLs. Nothing leaves the browser.

const DB_NAME = "spotter-media";
const STORE = "blobs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putBlob(blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return `idb:${id}`;
}

const cache = new Map<string, string>();

export async function resolveIdbUrl(url: string): Promise<string | null> {
  if (!url.startsWith("idb:")) return url;
  const hit = cache.get(url);
  if (hit) return hit;
  const db = await open();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(url.slice(4));
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!blob) return null;
  const objectUrl = URL.createObjectURL(blob);
  cache.set(url, objectUrl);
  return objectUrl;
}

export async function clearBlobs() {
  const db = await open();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
  });
}
