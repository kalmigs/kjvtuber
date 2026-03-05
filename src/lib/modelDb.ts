import { openDB } from 'idb';

interface ModelRow {
  id: string;
  name: string;
  blob: Blob;
  createdAt: string;
  updatedAt: string;
}

const DB_NAME = 'kjvtuber-models';
const STORE_NAME = 'models';

const getDb = () =>
  openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });

export interface StoredModelSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export const listStoredModels = async (): Promise<StoredModelSummary[]> => {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const rows = (await tx.store.getAll()) as ModelRow[];
  await tx.done;
  return rows.map(({ id, name, createdAt, updatedAt }) => ({
    id,
    name,
    createdAt,
    updatedAt,
  }));
};

export const saveUploadedModel = async (file: File): Promise<string> => {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const row: ModelRow = {
    id,
    name: file.name,
    blob: file,
    createdAt: now,
    updatedAt: now,
  };
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.store.put(row);
  await tx.done;
  return id;
};

export const getStoredModelBlob = async (id: string): Promise<Blob | undefined> => {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const row = (await tx.store.get(id)) as ModelRow | undefined;
  await tx.done;
  return row?.blob;
};

export const clearStoredModels = async (): Promise<void> => {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.store.clear();
  await tx.done;
};
