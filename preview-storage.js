const DB_NAME = 'dazen-texture-converter';
const DB_VERSION = 1;
const STORE = 'conversion-jobs';
const MAX_SAVED_JOBS = 3;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open local preview storage.'));
  });
}

export async function saveConversionJob(job) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(job);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Unable to save conversion preview.'));
  });
  await pruneOldJobs(db);
  db.close();
  return job.id;
}

export async function getConversionJob(id) {
  const db = await openDb();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Unable to read conversion preview.'));
  });
  db.close();
  return result;
}

async function pruneOldJobs(db) {
  const jobs = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  const stale = jobs
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(MAX_SAVED_JOBS);

  if (!stale.length) return;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const job of stale) store.delete(job.id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export function makeJobId() {
  return globalThis.crypto?.randomUUID?.() ||
    `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
