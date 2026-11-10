/**
 * IndexedDB mirror of UNSENT meeting-recording chunks.
 *
 * A chunk is written here the moment it is cut and deleted the moment its upload
 * succeeds, so a page reload or a closed tab while offline loses nothing: on the
 * next app start the recorder resumes uploading what is left, in index order.
 * Every call swallows its own errors (private mode, quota, no IndexedDB): the
 * recorder then simply keeps its in-memory behaviour.
 */
const DB_NAME = 'focusos-meeting-chunks';
const STORE = 'chunks';

export interface StoredChunk {
  key: string; // `${sessionId}:${index padded}`
  sessionId: string;
  chunkIndex: number;
  data: ArrayBuffer;
  mime: string;
  createdAt?: number;
}

const keyOf = (sessionId: string, chunkIndex: number) =>
  `${sessionId}:${String(chunkIndex).padStart(8, '0')}`;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function wrap<T>(fn: (store: IDBObjectStore) => IDBRequest<T> | null, mode: IDBTransactionMode, fallback: T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (!db) return resolve(fallback);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req ? (req.result as T) : fallback);
          tx.onerror = () => resolve(fallback);
          tx.onabort = () => resolve(fallback);
        } catch {
          resolve(fallback);
        }
      }),
  );
}

export async function putChunk(sessionId: string, chunkIndex: number, blob: Blob): Promise<void> {
  try {
    const data = await blob.arrayBuffer();
    const rec: StoredChunk = { key: keyOf(sessionId, chunkIndex), sessionId, chunkIndex, data, mime: blob.type, createdAt: Date.now() };
    await wrap((s) => s.put(rec), 'readwrite', undefined as unknown as IDBValidKey);
  } catch {
    /* in-memory behaviour only */
  }
}

export async function deleteChunk(sessionId: string, chunkIndex: number): Promise<void> {
  await wrap((s) => s.delete(keyOf(sessionId, chunkIndex)), 'readwrite', undefined as unknown as undefined);
}

/** Every stored chunk of one session, ascending by index. */
export async function getSessionChunks(sessionId: string): Promise<StoredChunk[]> {
  const all = await wrap((s) => s.index('sessionId').getAll(sessionId), 'readonly', [] as StoredChunk[]);
  return (all || []).sort((a, b) => a.chunkIndex - b.chunkIndex);
}

/** Session ids that still hold unsent chunks. */
export async function listChunkSessionIds(): Promise<string[]> {
  // Primary keys are `${sessionId}:${padded index}`: parse the session off the front
  // (never load the audio just to list sessions).
  const keys = await wrap((s) => s.getAllKeys(), 'readonly', [] as IDBValidKey[]);
  return Array.from(
    new Set((keys || []).map((k) => String(k)).map((k) => k.slice(0, k.lastIndexOf(':')))),
  );
}

/** Drop every stored chunk of one session (Discard, a permanent server refusal). */
export async function deleteSessionChunks(sessionId: string): Promise<void> {
  const keys = await wrap((s) => s.getAllKeys(), 'readonly', [] as IDBValidKey[]);
  const mine = (keys || []).map(String).filter((k) => k.slice(0, k.lastIndexOf(':')) === sessionId);
  await Promise.all(mine.map((k) => wrap((s) => s.delete(k), 'readwrite', undefined as unknown as undefined)));
}

/**
 * Housekeeping: delete chunks older than `maxAgeMs` whose session has no record left
 * (`hasRecord` says so). A chunk without a createdAt stamp counts as old.
 */
export async function deleteStaleChunks(maxAgeMs: number, hasRecord: (sessionId: string) => boolean): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const v = cur.value as StoredChunk;
        if (!hasRecord(v.sessionId) && Date.now() - (v.createdAt ?? 0) > maxAgeMs) cur.delete();
        cur.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
