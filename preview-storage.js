const DB_NAME = 'dazen-texture-converter';
const DB_VERSION = 1;
const STORE = 'conversion-jobs';
const MAX_SAVED_JOBS = 3;

const OPEN_TIMEOUT_MS = 8000;
const READ_TIMEOUT_MS = 12000;
const WRITE_TIMEOUT_MS = 30000;
const VERIFY_TIMEOUT_MS = 5000;

function makeTimeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(
        new Error(
          'Local browser storage (IndexedDB) is unavailable in this browser/context.'
        )
      );
      return;
    }

    let settled = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        makeTimeoutError(
          'Local preview storage did not respond in time.'
        )
      );
    }, OPEN_TIMEOUT_MS);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: 'id',
        });
        store.createIndex('createdAt', 'createdAt');
      }
    };

    request.onsuccess = () => {
      if (settled) {
        request.result?.close();
        return;
      }

      settled = true;
      clearTimeout(timer);

      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        request.error ||
          new Error(
            'Unable to open local conversion-preview storage.'
          )
      );
    };

    request.onblocked = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          'Local preview storage is blocked by another converter tab. Close the other converter tabs and try again.'
        )
      );
    };
  });
}

function transactionWithTimeout({
  db,
  mode,
  timeoutMs,
  timeoutMessage,
  start,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let tx;

    try {
      tx = db.transaction(STORE, mode);
    } catch (error) {
      reject(error);
      return;
    }

    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    const resolveOnce = finish(resolve);
    const rejectOnce = finish(reject);

    const timer = setTimeout(() => {
      if (settled) return;
      try {
        tx.abort();
      } catch {}
      rejectOnce(makeTimeoutError(timeoutMessage));
    }, timeoutMs);

    tx.onerror = () =>
      rejectOnce(
        tx.error ||
          new Error(
            'Local preview-storage transaction failed.'
          )
      );

    tx.onabort = () => {
      if (settled) return;
      rejectOnce(
        tx.error ||
          new Error(
            'Local preview-storage transaction was aborted.'
          )
      );
    };

    try {
      start({
        store: tx.objectStore(STORE),
        tx,
        resolve: resolveOnce,
        reject: rejectOnce,
      });
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      rejectOnce(error);
    }
  });
}

export async function saveConversionJob(job) {
  const db = await openDb();

  try {
    await transactionWithTimeout({
      db,
      mode: 'readwrite',
      timeoutMs: WRITE_TIMEOUT_MS,
      timeoutMessage:
        'Saving the conversion preview took too long. The converted pack is still available for direct download.',
      start: ({ store, tx, resolve, reject }) => {
        const request = store.put(job);

        request.onerror = () =>
          reject(
            request.error ||
              new Error(
                'Unable to save the conversion preview.'
              )
          );

        tx.oncomplete = () => resolve(job.id);
      },
    });

    // Cleanup uses keys only. Never clone previous output blobs simply to
    // decide which old jobs should be removed.
    try {
      await pruneOldJobs(db);
    } catch (error) {
      console.warn(
        '[Dazen/PreviewStorage] Old-preview cleanup skipped:',
        error
      );
    }

    return job.id;
  } finally {
    try {
      db.close();
    } catch {}
  }
}

export async function getConversionJob(id) {
  if (!id) return null;

  const db = await openDb();

  try {
    return await transactionWithTimeout({
      db,
      mode: 'readonly',
      timeoutMs: READ_TIMEOUT_MS,
      timeoutMessage:
        'Reading this conversion preview took too long. The browser may be blocking or struggling with local storage.',
      start: ({ store, resolve, reject }) => {
        const request = store.get(id);

        request.onsuccess = () =>
          resolve(request.result || null);

        request.onerror = () =>
          reject(
            request.error ||
              new Error(
                'Unable to read the locally stored conversion preview.'
              )
          );
      },
    });
  } finally {
    try {
      db.close();
    } catch {}
  }
}

export async function hasConversionJob(id) {
  if (!id) return false;

  const db = await openDb();

  try {
    return await transactionWithTimeout({
      db,
      mode: 'readonly',
      timeoutMs: VERIFY_TIMEOUT_MS,
      timeoutMessage:
        'Preview verification timed out.',
      start: ({ store, resolve, reject }) => {
        // count(key) checks existence without cloning the heavy job value.
        const request = store.count(id);

        request.onsuccess = () =>
          resolve(Number(request.result || 0) > 0);

        request.onerror = () =>
          reject(
            request.error ||
              new Error(
                'Unable to verify the saved preview.'
              )
          );
      },
    });
  } finally {
    try {
      db.close();
    } catch {}
  }
}

async function pruneOldJobs(db) {
  if (!db.objectStoreNames.contains(STORE)) return;

  const staleIds = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);

    if (!store.indexNames.contains('createdAt')) {
      resolve([]);
      return;
    }

    const index = store.index('createdAt');

    // openKeyCursor reads only index/primary keys and does not structured-clone
    // the huge job values containing the output archive and PNG blobs.
    if (typeof index.openKeyCursor !== 'function') {
      resolve([]);
      return;
    }

    const ids = [];
    let seen = 0;
    const request = index.openKeyCursor(null, 'prev');

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(ids);
        return;
      }

      if (seen >= MAX_SAVED_JOBS) {
        ids.push(cursor.primaryKey);
      }

      seen++;
      cursor.continue();
    };

    request.onerror = () =>
      reject(request.error || new Error('Cleanup cursor failed.'));

    tx.onabort = () =>
      reject(tx.error || new Error('Cleanup scan was aborted.'));
  });

  if (!staleIds.length) return;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    for (const id of staleIds) {
      store.delete(id);
    }

    tx.oncomplete = resolve;
    tx.onerror = () =>
      reject(tx.error || new Error('Old-preview cleanup failed.'));
    tx.onabort = () =>
      reject(tx.error || new Error('Old-preview cleanup was aborted.'));
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
