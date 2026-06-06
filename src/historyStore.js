/**
 * historyStore.js — Local-only IndexedDB persistence for audio analysis history.
 * Stores audio blobs + compact analysis logs + human review tags in the browser.
 */

const DB_NAME = 'chunks-audio-history';
const DB_VERSION = 2;
const STORE_ANALYSES = 'analyses';

function openHistoryDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Failed to open history database.'));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ANALYSES)) {
        db.close();
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        deleteRequest.onerror = () => reject(deleteRequest.error || new Error('Failed to repair history database.'));
        deleteRequest.onsuccess = () => openHistoryDb().then(resolve).catch(reject);
        return;
      }
      resolve(db);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ANALYSES)) {
        const store = db.createObjectStore(STORE_ANALYSES, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

async function withStore(mode, callback) {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ANALYSES, mode);
    const store = tx.objectStore(STORE_ANALYSES);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('History database transaction failed.'));
    tx.onabort = () => reject(tx.error || new Error('History database transaction aborted.'));
    try {
      result = callback(store);
    } catch (err) {
      reject(err);
    }
  }).finally(() => db.close());
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

export async function saveAnalysisEntry(entry) {
  await withStore('readwrite', store => store.put(entry));
  return entry.id;
}

export async function listAnalysisEntries() {
  const entries = await withStore('readonly', store => requestToPromise(store.getAll()));
  return entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getAnalysisEntry(id) {
  return withStore('readonly', store => requestToPromise(store.get(id)));
}

export async function patchAnalysisEntry(id, patch) {
  const existing = await getAnalysisEntry(id);
  if (!existing) throw new Error('History entry not found.');
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await saveAnalysisEntry(updated);
  return updated;
}

export async function updateAnalysisReview(id, review) {
  return patchAnalysisEntry(id, { review });
}

export async function deleteAnalysisEntry(id) {
  await withStore('readwrite', store => store.delete(id));
}

export async function clearAnalysisHistory() {
  await withStore('readwrite', store => store.clear());
}
