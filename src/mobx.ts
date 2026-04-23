// oxlint-disable typescript/no-unsafe-type-assertion
import JSAN from "jsan";
import * as mobx from "mobx";

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
    const obj = {
      ...Object.fromEntries(Object.entries(this).map(([k, v]) => [k, serializeObservable(v)])),
      ...Object.fromEntries(
        [...getObservableMap(this)].map(([k]) => [
          k,
          serializeObservable((this as Record<string, unknown>)[k]),
        ]),
      ),
    };
    const Class = (Object.getPrototypeOf(this) as typeof Serializable).constructor;
    const res = { data: obj, __serializedType__: Class.name };

    Serializable.serializedObjects.set(this, res);
    return res;
  }
  static fromPlain(Self: typeof Serializable, v: unknown): object {
    const revived = Serializable.revivedObjects.get(typeof v === "object" && !!v ? v : {});
    if (revived) return revived;
    const fresh = {};
    Object.setPrototypeOf(fresh, Self.prototype);
    Object.assign(fresh, v);
    (fresh as Serializable).init();
    if (typeof v === "object" && !!v) Serializable.revivedObjects.set(v, fresh as Serializable);
    return fresh;
  }
  init(): void {}
  static fromObj(v: unknown): unknown {
    if (isSerializedTypeClass(v)) {
      if (v.__serializedType__ === "Map") {
        const rawData = v.data as [unknown, unknown][] | Record<string, unknown>;
        const data = Array.isArray(rawData) ? rawData : Object.entries(rawData);
        const marker = data.find(([key]) => key === "__ownKeys__");
        const map = new Map(data.filter((d) => d !== marker));
        if (marker) {
          Object.assign(map, marker[1]);
        }
        return map;
      }
      if (v.__serializedType__ === "Set") {
        const data = v.data as unknown[];
        const marker = data.find(
          (val, i) => i === 0 && typeof val === "object" && !!val && "#" in val,
        );
        const set = new Set(data.filter((d) => d !== marker));
        if (marker) {
          const { ["#"]: _, ...markerData } = marker as Record<string, unknown>;
          Object.assign(set, markerData);
        }
        return set;
      }
      const Class = Serializable.knownConstructors.get(v.__serializedType__);
      if (Class) {
        return Class.fromPlain(Class, v.data);
      }
      console.error("Couldn't deserialize ", v.__serializedType__);
      return v.data;
    }
    return v;
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
const defaultObservableSetKeys = new Set(Object.keys(new mobx.ObservableMap()));

function serializeObservableSet(v: mobx.ObservableSet) {
  const obj = {
    __serializedType__: "Set",
    data: [] as unknown[],
  };
  const nonDefaultKeys = Object.keys(v).filter((k) => !defaultObservableSetKeys.has(k));
  if (nonDefaultKeys.length > 0) {
    const marker: Record<string, unknown> = { "#": "props" };
    for (const key of nonDefaultKeys) {
      marker[key] = (v as mobx.ObservableSet & Record<string, unknown>)[key];
    }
    obj.data.push(marker);
  }
  for (const [value] of v.values()) {
    obj.data.push(value);
  }
  return obj;
}
function isMapWithPlainKeys(
  v: mobx.ObservableMap<unknown, unknown>,
): v is mobx.ObservableMap<string | number | symbol, unknown> {
  const allKeysAreObjectKeys = v
    .keys()
    .every((key) => typeof key === "number" || typeof key === "string" || typeof key === "symbol");

  return allKeysAreObjectKeys;
}
function serializeObservableMap(v: mobx.ObservableMap<unknown, unknown>) {
  const allKeysAreObjectKeys = isMapWithPlainKeys(v);
  let marker: Record<string, unknown> | undefined;
  const nonDefaultKeys = Object.keys(v).filter((k) => !defaultObservableMapKeys.has(k));
  if (nonDefaultKeys.length > 0) {
    marker = {};
    for (const key of nonDefaultKeys) {
      marker[key] = (v as mobx.ObservableMap & Record<string, unknown>)[key];
    }
  }
  if (allKeysAreObjectKeys) {
    const obj = {
      __serializedType__: "Map",
      data: {} as Record<number | string | symbol, unknown>,
    };

    if (marker) obj.data["__ownKeys__"] = marker;
    for (const [key, value] of v.entries()) {
      obj.data[key] = value;
    }
    return obj;
  }
  const obj = {
    __serializedType__: "Map",
    data: [] as [unknown, unknown][],
  };
  if (marker) obj.data.push(["__ownKeys__", marker]);

  for (const [key, value] of v.entries()) {
    obj.data.push([key, value]);
  }
  return obj;
}
function serializeObservableArray(v: Array<unknown>) {
  const nonIdx: Record<string, unknown> = { "#": "props" };
  // oxlint-disable-next-line typescript/no-for-in-array
  for (const key in v) {
    if (Number.isInteger(Number(key))) continue;
    nonIdx[key] = serializeObservable(v[key]);
  }
  const mapped: unknown[] = Object.keys(nonIdx).length > 1 ? [nonIdx] : [];
  for (const element of v) {
    mapped.push(serializeObservable(element));
  }
  return mapped;
}
function serializeObservable(v: unknown): unknown {
  if (v instanceof Serializable) return v.toObj();
  if (v instanceof mobx.ObservableSet) {
    return serializeObservableSet(v);
  }
  if (v instanceof mobx.ObservableMap) {
    return serializeObservableMap(v);
  }
  if (Array.isArray(v)) {
    return serializeObservableArray(v);
  }
  if (!!v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, serializeObservable(val)]));
  }
  return v;
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
export function revive(
  raw: unknown,
  map: (key: string | number | symbol | undefined, val: unknown) => unknown,
  key?: string | number | symbol,
): unknown {
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

        revive(val, map, subKey);
        const mapped = map(subKey, val);
        if (mapped !== val) props[subKey] = mapped;
      }

      Object.assign(raw, props);
    }
    for (const [idx, val] of raw.entries()) {
      revive(val, map, idx);
      const mapped = map(idx, val);
      if (mapped !== val) {
        raw[idx] = mapped;
      }
    }
  } else if (typeof raw === "object" && !!raw) {
    for (const subKey in raw) {
      const val = (raw as Record<string, unknown>)[subKey];

      revive(val, map, subKey);
      const mapped = map(subKey, val);
      if (mapped !== val) (raw as Record<string, unknown>)[subKey] = mapped;
    }
  }
  return map(key, raw);
}
