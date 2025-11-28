"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stores_exports = {};
__export(stores_exports, {
  createInMemoryStorage: () => createInMemoryStorage,
  createLocalStorage: () => createLocalStorage,
  createSessionStorage: () => createSessionStorage
});
module.exports = __toCommonJS(stores_exports);
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
//# sourceMappingURL=stores.js.map
