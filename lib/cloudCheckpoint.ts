import { parseCloudSyncCheckpoint, type CloudSyncCheckpoint } from "@/lib/cloudSync";

const DATABASE_NAME = "universal-dashboard-cloud-sync";
const DATABASE_VERSION = 1;
const OBJECT_STORE = "checkpoints";
const FALLBACK_PREFIX = "universal-dashboard-cloud-checkpoint-v1:";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cloud sync storage could not be opened."));
    request.onblocked = () => reject(new Error("Cloud sync storage is blocked by another tab."));
  });
}

async function readIndexedCheckpoint(userId: string): Promise<CloudSyncCheckpoint | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(OBJECT_STORE, "readonly").objectStore(OBJECT_STORE).get(userId);
      request.onsuccess = () => resolve(parseCloudSyncCheckpoint(JSON.stringify(request.result ?? null)));
      request.onerror = () => reject(request.error ?? new Error("Cloud sync checkpoint could not be read."));
    });
  } finally {
    database.close();
  }
}

export async function loadCloudCheckpoint(userId: string): Promise<CloudSyncCheckpoint | null> {
  if (typeof indexedDB !== "undefined") {
    try {
      const indexed = await readIndexedCheckpoint(userId);
      if (indexed) return indexed;
    } catch {
      // Fall through to the compact localStorage backup.
    }
  }
  try {
    return parseCloudSyncCheckpoint(window.localStorage.getItem(`${FALLBACK_PREFIX}${userId}`));
  } catch {
    return null;
  }
}

export async function saveCloudCheckpoint(userId: string, checkpoint: CloudSyncCheckpoint): Promise<void> {
  let indexedSaved = false;
  if (typeof indexedDB !== "undefined") {
    try {
      const database = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(OBJECT_STORE, "readwrite");
          transaction.objectStore(OBJECT_STORE).put(checkpoint, userId);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error("Cloud sync checkpoint could not be saved."));
          transaction.onabort = () => reject(transaction.error ?? new Error("Cloud sync checkpoint save was cancelled."));
        });
        indexedSaved = true;
      } finally {
        database.close();
      }
    } catch {
      indexedSaved = false;
    }
  }

  try {
    window.localStorage.setItem(`${FALLBACK_PREFIX}${userId}`, JSON.stringify(checkpoint));
    return;
  } catch {
    if (!indexedSaved) throw new Error("The browser could not save its cloud sync checkpoint.");
  }
}
