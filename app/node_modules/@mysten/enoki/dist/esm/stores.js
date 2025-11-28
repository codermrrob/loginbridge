function createWebStorage(storage) {
  return {
    get(key) {
      return storage.getItem(key);
    },
    set(key, value) {
      storage.setItem(key, value);
    },
    delete(key) {
      storage.removeItem(key);
    }
  };
}
function createInMemoryStorage() {
  const store = /* @__PURE__ */ new Map();
  return {
    get(key) {
      return store.get(key) ?? null;
    },
    set(key, value) {
      store.set(key, value);
    },
    delete(key) {
      store.delete(key);
    }
  };
}
function createLocalStorage() {
  if (typeof window === "undefined") {
    console.warn("`window.localStorage` is not available, falling back to in-memory storage");
    return createInMemoryStorage();
  }
  return createWebStorage(window.localStorage);
}
function createSessionStorage() {
  if (typeof window === "undefined") {
    console.warn("`window.sessionStorage` is not available, falling back to in-memory storage");
    return createInMemoryStorage();
  }
  return createWebStorage(window.sessionStorage);
}
export {
  createInMemoryStorage,
  createLocalStorage,
  createSessionStorage
};
//# sourceMappingURL=stores.js.map
