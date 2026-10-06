const DB_NAME = 'dazen-texture-converter';
const DB_VERSION = 1;
const STORE = 'conversion-jobs';
const MAX_SAVED_JOBS = 3;
const OPEN_TIMEOUT_MS = 8000;
const READ_TIMEOUT_MS = 12000;
const WRITE_TIMEOUT_MS = 30000;

function timeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function openDb() {
  if (!globalThis.indexedDB) {
    return Promise.reject(
      new Error('Local browser storage (IndexedDB) is unavailable in this browser/context.')
    );
  }

  return withTimeout(
    new Promise((resolve, reject) => {
      let settled = false;
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };

      request.onsuccess = () => {
        if (settled) {
          request.result?.close();
          return;
        }
        settled = true;
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };

      request.onerror = () => {
        if (settled) return;
        settled = true;
        reject(
          request.error ||
          new Error('Unable to open local conversion-preview storage.')
        );
      };

      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            'Local preview storage is blocked by another open tab. Close other converter tabs and try again.'
          )
        );
      };
    }),
    OPEN_TIMEOUT_MS,
    'Local preview storage did not respond in time.'
  );
}

function runTransaction(db, mode, operation, timeoutMs, timeoutMessage) {
  return withTimeout(
    new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE, mode);
      } catch (error) {
        reject(error);
        return;
      }

      let result;
      try {
        result = operation(tx.objectStore(STORE), tx);
      } catch (error) {
        try { tx.abort(); } catch {}
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(result?.value);
      tx.onerror = () =>
        reject(tx.error || new Error('Local preview-storage transaction failed.'));
      tx.onabort = () =>
        reject(tx.error || new Error('Local preview-storage transaction was aborted.'));
    }),
    timeoutMs,
    timeoutMessage
  );
}

export async function saveConversionJob(job) {
  const db = await openDb();

  try {
    await runTransaction(
      db,
      'readwrite',
      store => {
        store.put(job);
        return { value: job.id };
      },
      WRITE_TIMEOUT_MS,
      'Saving the conversion preview took too long. The output pack is still available for direct download.'
    );

    // Cleanup must never make an otherwise successful save look like a failure.
    try {
      await withTimeout(
        pruneOldJobs(db),
        5000,
        'Preview cleanup timed out.'
      );
    } catch (error) {
      console.warn('[Dazen/PreviewStorage] Cleanup skipped:', error);
    }

    return job.id;
  } finally {
    try { db.close(); } catch {}
  }
}

export async function getConversionJob(id) {
  if (!id) return null;

  const db = await openDb();

  try {
    return await withTimeout(
      new Promise((resolve, reject) => {
        let tx;
        try {
          tx = db.transaction(STORE, 'readonly');
        } catch (error) {
          reject(error);
          return;
        }

        const request = tx.objectStore(STORE).get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () =>
          reject(
            request.error ||
            new Error('Unable to read the locally stored conversion preview.')
          );

        tx.onabort = () =>
          reject(
            tx.error ||
            new Error('Reading the conversion preview was aborted.')
          );
      }),
      READ_TIMEOUT_MS,
      'Reading this conversion preview took too long. The browser may be blocking or struggling with local storage.'
    );
  } finally {
    try { db.close(); } catch {}
  }
}

export async function hasConversionJob(id) {
  if (!id) return false;
  const db = await openDb();

  try {
    return await withTimeout(
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const request =
          typeof store.getKey === 'function'
            ? store.getKey(id)
            : store.get(id);

        request.onsuccess = () => resolve(request.result != null);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error);
      }),
      5000,
      'Preview verification timed out.'
    );
  } finally {
    try { db.close(); } catch {}
  }
}

async function pruneOldJobs(db) {
  const jobs = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error);
  });

  const stale = jobs
    .sort(
      (a, b) =>
        Number(b.createdAt || 0) -
        Number(a.createdAt || 0)
    )
    .slice(MAX_SAVED_JOBS);

  if (!stale.length) return;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    for (const job of stale) {
      store.delete(job.id);
    }

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function makeJobId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `job-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
}
