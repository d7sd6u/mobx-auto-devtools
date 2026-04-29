// oxlint-disable typescript/no-unsafe-type-assertion
import JSAN from "jsan";
import * as mobx from "mobx";

import { getConstructor } from "./function-reflection";

export class Serializable {
  static knownConstructors: Map<string, typeof Serializable> = new Map();
  constructor() {
    Serializable.knownConstructors.set(new.target.name, new.target);
  }
  static revivedObjects: WeakMap<object, Serializable> = new WeakMap();
  static serializedObjects: WeakMap<object, unknown> = new WeakMap();
  toObj(clear?: boolean): object {
    if (clear) Serializable.serializedObjects = new WeakMap();
    const serialized = Serializable.serializedObjects.get(this);
    if (serialized) return serialized;
    const obj = {};
    const Class = (Object.getPrototypeOf(this) as typeof Serializable).constructor;
    const res = { data: obj, __serializedType__: Class.name };
    Serializable.serializedObjects.set(this, res);

    Object.assign(obj, {
      ...Object.fromEntries(Object.entries(this).map(([k, v]) => [k, serializeObservable(v)])),
      ...Object.fromEntries(
        [...getObservableMap(this)].map(([k]) => [
          k,
          serializeObservable((this as Record<string, unknown>)[k]),
        ]),
      ),
    });
    return res;
  }
  static fromPlain(Self: typeof Serializable, v: object, data?: object): object {
    const revived = Serializable.revivedObjects.get(v);
    if (revived) return revived;
    // const fresh = {};
    Object.setPrototypeOf(v, Self.prototype);
    if (data) Object.assign(v, data);
    (v as Serializable).init();
    Serializable.revivedObjects.set(v, v as Serializable);
    return v;
  }
  init(): void {}
  static fromObj(obj: unknown): unknown {
    return revive(obj);
  }
}
function isSerializedTypeClass(v: unknown): v is { __serializedType__: string; data: object } {
  return (
    typeof v === "object" &&
    !!v &&
    "__serializedType__" in v &&
    typeof v.__serializedType__ === "string" &&
    "data" in v &&
    typeof v.data === "object" &&
    !!v.data
  );
}
export function getObservableMap(v: unknown): Map<string, { raw(): unknown }> {
  const mobxSymbol = Object.getOwnPropertySymbols(v)[0];
  if (!mobxSymbol) return new Map();
  return (
    (v as Record<string | symbol, { values_: Map<string, { raw(): unknown }> }>)[mobxSymbol]
      ?.values_ ?? new Map<string, { raw(): unknown }>()
  );
}

const defaultObservableMapKeys = new Set(Object.keys(new mobx.ObservableMap()));
const defaultObservableSetKeys = new Set([...Object.keys(new mobx.ObservableMap()), "atom_"]);

function serializeObservableSet(
  v: mobx.ObservableSet<unknown> | Set<unknown>,
  traversedEntries?: Map<unknown, unknown>,
) {
  const obj = {
    __serializedType__: "Set",
    data: [] as unknown[],
  };
  traversedEntries?.set(v, obj);
  const nonDefaultKeys = Object.keys(v).filter((k) => !defaultObservableSetKeys.has(k));
  if (nonDefaultKeys.length > 0) {
    const marker: Record<string, unknown> = { "#": "props" };
    for (const key of nonDefaultKeys) {
      marker[key] = serializeObservable(
        (v as mobx.ObservableSet & Record<string, unknown>)[key],
        traversedEntries,
      );
    }
    obj.data.push(marker);
  }
  for (const value of v.values()) {
    obj.data.push(serializeObservable(value, traversedEntries));
  }
  return obj;
}
function isMapWithPlainKeys(
  v: mobx.ObservableMap<unknown, unknown> | Map<unknown, unknown>,
): v is mobx.ObservableMap<string | number | symbol, unknown> {
  const allKeysAreObjectKeys = v.keys().every((key) => typeof key === "string");

  return allKeysAreObjectKeys;
}
function serializeObservableMap(
  v: mobx.ObservableMap<unknown, unknown> | Map<unknown, unknown>,
  traversedEntries?: Map<unknown, unknown>,
) {
  const obj = {
    __serializedType__: "Map",
    data: {} as Record<number | string | symbol, unknown> | [unknown, unknown][],
  };
  traversedEntries?.set(v, obj);
  const allKeysAreObjectKeys = isMapWithPlainKeys(v);
  let marker: Record<string, unknown> | undefined;
  const nonDefaultKeys = Object.keys(v).filter((k) => !defaultObservableMapKeys.has(k));
  if (nonDefaultKeys.length > 0) {
    marker = {};
    for (const key of nonDefaultKeys) {
      marker[key] = serializeObservable(
        (v as mobx.ObservableMap & Record<string, unknown>)[key],
        traversedEntries,
      );
    }
  }
  if (allKeysAreObjectKeys) {
    obj.data = {};
    if (marker) obj.data["__ownKeys__"] = marker;
    for (const [key, value] of v.entries()) {
      obj.data[key] = serializeObservable(value, traversedEntries);
    }
    return obj;
  }
  obj.data = [];
  if (marker) obj.data.push(["__ownKeys__", marker]);

  for (const [key, value] of v.entries()) {
    obj.data.push([
      serializeObservable(key, traversedEntries),
      serializeObservable(value, traversedEntries),
    ]);
  }
  return obj;
}
function serializeObservableArray(v: Array<unknown>, traversedEntries?: Map<unknown, unknown>) {
  const nonIdx: Record<string, unknown> = { "#": "props" };
  // oxlint-disable-next-line typescript/no-for-in-array
  for (const key in v) {
    if (Number.isInteger(Number(key))) continue;
    nonIdx[key] = serializeObservable(v[key], traversedEntries);
  }
  const mapped: unknown[] = Object.keys(nonIdx).length > 1 ? [nonIdx] : [];
  for (const element of v) {
    mapped.push(serializeObservable(element, traversedEntries));
  }
  return mapped;
}
const externalObjects = new Map<ExternalObjectId, unknown>();
if (typeof window === "object")
  (window as typeof window & { externalObjects?: unknown }).externalObjects = externalObjects;
function serializeObservable(
  v: unknown,
  traversedEntries: Map<unknown, unknown> = new Map(),
): unknown {
  function process() {
    if (v instanceof Serializable) return v.toObj();
    if (v instanceof mobx.ObservableSet || v instanceof Set) {
      return serializeObservableSet(v, traversedEntries);
    }
    if (v instanceof mobx.ObservableMap || v instanceof Map) {
      return serializeObservableMap(v, traversedEntries);
    }
    if (Array.isArray(v)) {
      return serializeObservableArray(v, traversedEntries);
    }
    if (!!v && typeof v === "object") {
      if (isExternalObject(v)) return createExternalObject(v);
      const res: Record<string, unknown> = {};
      traversedEntries.set(v, res);
      for (const [k, val] of Object.entries(v)) {
        res[k] = serializeObservable(val, traversedEntries);
      }
      return res;
    }
    return v;
  }
  if (traversedEntries.has(v)) return traversedEntries.get(v);
  const res = process();
  traversedEntries.set(v, res);
  return res;
}

function isExternalId(id: unknown): id is ExternalObjectId {
  return typeof id === "string" && id.startsWith("external-class-");
}
function getExternalObjectById(id: ExternalObjectId) {
  return externalObjects.get(id);
}
type ExternalObjectId = `external-class-${string}`;

function createExternalObject(v: object): ExternalObjectId {
  const existingId = externalObjects.entries().find(([, val]) => val === v)?.[0];
  if (existingId) return existingId;
  // oxlint-disable-next-line typescript/no-base-to-string
  const name = String(v);
  const idFromName = `external-class-${name}` as const;
  // oxlint-disable-next-line typescript/no-base-to-string
  if (name !== String({})) {
    externalObjects.set(idFromName, v);
    return idFromName;
  }
  const className = getConstructor(v)?.name ?? "anonymous";
  const randId = Math.random().toString().slice(4);
  const id = `external-class-${className}-${randId}` as const;
  externalObjects.set(id, v);
  return id;
}

function isExternalObject(v: object) {
  return getConstructor(v) !== Object || Object.values(v).some((val) => typeof val === "function");
}

mobx.configure({
  reactionScheduler: (f) => {
    queueMicrotask(f);
  },
});
export function serializedRoot(root: Serializable): unknown {
  return JSON.parse(
    JSAN.stringify(
      mobx.untracked(() => root.toObj(true)),
      undefined,
      undefined,
      {
        circular: true,
        regex: true,
        map: true,
        set: true,
        nan: true,
        infinity: true,
        error: true,
        undefined: true,
        symbol: true,
        date: true,
      },
    ),
  );
}
// oxlint-disable-next-line max-lines-per-function
export function revive(raw: unknown, revived: Map<unknown, unknown> = new Map()): unknown {
  if (revived.has(raw)) return revived.get(raw);
  const v = raw;
  if (isExternalId(v)) return getExternalObjectById(v);
  if (isSerializedTypeClass(v)) {
    if (v.__serializedType__ === "Map") {
      const rawData = v.data as [unknown, unknown][] | Record<string, unknown>;
      const data = Array.isArray(rawData) ? rawData : Object.entries(rawData);
      const marker = data.find(([k]) => k === "__ownKeys__");
      const mapObj = new Map();
      revived.set(v, mapObj);
      for (const element of data
        .filter((d) => d !== marker)
        .map((d) => [revive(d[0], revived), revive(d[1], revived)] as const)) {
        mapObj.set(...element);
      }
      if (marker) {
        Object.assign(mapObj, revive(marker[1], revived));
      }
      return mapObj;
    }
    if (v.__serializedType__ === "Set") {
      const data = v.data as unknown[];
      const marker = data.find(
        (val, i) => i === 0 && typeof val === "object" && !!val && "#" in val,
      );
      const set = new Set();
      revived.set(v, set);
      for (const element of data.filter((d) => d !== marker).map((d) => revive(d, revived))) {
        set.add(element);
      }
      if (marker) {
        const { ["#"]: _, ...markerData } = marker as Record<string, unknown>;
        Object.assign(set, revive(markerData, revived));
      }
      return set;
    }
    const Class = Serializable.knownConstructors.get(v.__serializedType__);
    if (Class) {
      const data = v.data;
      delete (v as Partial<typeof v>).__serializedType__;
      delete (v as Partial<typeof v>).data;
      revived.set(v, v);
      for (const subKey in data) {
        const val = (data as Record<string, unknown>)[subKey];

        const mapped = revive(val, revived);
        if (mapped !== val) (data as Record<string, unknown>)[subKey] = mapped;
      }
      const ret = Class.fromPlain(Class, v, data);

      return ret;
    }
    console.error("Couldn't deserialize ", v.__serializedType__);
    return v.data;
  }
  if (Array.isArray(raw)) {
    const markerElement: unknown = raw[0];
    if (
      typeof markerElement === "object" &&
      !!markerElement &&
      "#" in markerElement &&
      markerElement["#"] === "props"
    ) {
      const props = raw.splice(0, 1)[0] as Record<string, unknown>;

      for (const subKey in props) {
        const val = props[subKey];

        const mapped = revive(val);
        if (mapped !== val) props[subKey] = mapped;
      }

      Object.assign(raw, props);
    }
    for (const [idx, val] of raw.entries()) {
      const mapped = revive(val, revived);
      if (mapped !== val) {
        raw[idx] = mapped;
      }
    }
  } else if (typeof raw === "object" && !!raw) {
    revived.set(raw, raw);
    for (const subKey in raw) {
      const val = (raw as Record<string, unknown>)[subKey];
      const mapped = revive(val, revived);
      if (mapped !== val) (raw as Record<string, unknown>)[subKey] = mapped;
    }
  }
  return raw;
}
