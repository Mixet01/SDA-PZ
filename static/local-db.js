(function () {
  const DB_NAME = "sda-local-first";
  const DB_VERSION = 1;
  const STORE_KV = "kv";
  const STORE_QUEUE = "queue";

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          const queue = db.createObjectStore(STORE_QUEUE, { keyPath: "id", autoIncrement: true });
          queue.createIndex("by_status", "status", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB non disponibile."));
    });
  }

  async function withStore(storeName, mode, handler) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("Errore transazione IndexedDB."));
      tx.onabort = () => reject(tx.error || new Error("Transazione IndexedDB annullata."));

      result = handler(store, tx);
    }).finally(() => db.close());
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Errore richiesta IndexedDB."));
    });
  }

  const api = {
    async get(key) {
      return withStore(STORE_KV, "readonly", async (store) => {
        const row = await requestToPromise(store.get(key));
        return row ? row.value : null;
      });
    },

    async set(key, value) {
      return withStore(STORE_KV, "readwrite", async (store) => {
        await requestToPromise(store.put({ key, value, updatedAt: Date.now() }));
        return true;
      });
    },

    async del(key) {
      return withStore(STORE_KV, "readwrite", async (store) => {
        await requestToPromise(store.delete(key));
        return true;
      });
    },

    async addQueue(item) {
      return withStore(STORE_QUEUE, "readwrite", async (store) => {
        const payload = {
          ...item,
          status: item.status || "pending",
          attempts: Number(item.attempts || 0),
          createdAt: item.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
        return requestToPromise(store.add(payload));
      });
    },

    async updateQueue(id, patch) {
      return withStore(STORE_QUEUE, "readwrite", async (store) => {
        const current = await requestToPromise(store.get(id));
        if (!current) return null;
        const next = { ...current, ...patch, updatedAt: Date.now() };
        await requestToPromise(store.put(next));
        return next;
      });
    },

    async deleteQueue(id) {
      return withStore(STORE_QUEUE, "readwrite", async (store) => {
        await requestToPromise(store.delete(id));
        return true;
      });
    },

    async listQueue(status) {
      return withStore(STORE_QUEUE, "readonly", async (store) => {
        const rows = await requestToPromise(store.getAll());
        const filtered = status ? rows.filter((row) => row.status === status) : rows;
        return filtered.sort((a, b) => a.createdAt - b.createdAt);
      });
    },
  };

  window.sdaLocalDB = api;
})();
