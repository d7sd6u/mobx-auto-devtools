import { action, computed, observable } from "mobx";
// oxlint-disable max-classes-per-file
// oxlint-disable max-lines-per-function
import { test, expect, describe } from "vitest";

import { Serializable } from "./mobx";

describe("Serializable.toObj", () => {
  test("it works with ordinary primitive fields", () => {
    class Test extends Serializable {
      ordinaryField = 123;
    }
    const obj = new Test();
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "ordinaryField": 123,
        },
      }
    `);
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with computeds", () => {
    class Test extends Serializable {
      @computed get ordinaryField() {
        return 123;
      }
      get other() {
        return "";
      }
      @action test() {
        return this.ordinaryField;
      }
    }
    const obj = new Test();
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "get ordinaryField()": 123,
          "get other()": "",
        },
      }
    `);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const serialized = Serializable.fromObj(obj.toObj()) as Test;
    expect(serialized.test()).toBe(123);
    expect(serialized.ordinaryField).toBe(123);
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with arrow fn fields", () => {
    class Test extends Serializable {
      @observable accessor ordinaryField = 123;
      @action test = () => {
        return this.ordinaryField;
      };
    }
    const obj = new Test();
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "ordinaryField": 123,
        },
      }
    `);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const serialized = Serializable.fromObj(obj.toObj()) as Test;
    expect(serialized.test()).toBe(123);
    serialized.ordinaryField = 444;
    const unbounded = serialized.test;
    expect(unbounded()).toBe(444);
    // bounded functions are not referentially equal
    // expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with getters", () => {
    class Test extends Serializable {
      ordinaryField = 123;
      get getter() {
        return this.ordinaryField;
      }
    }
    const obj = new Test();
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "get getter()": 123,
          "ordinaryField": 123,
        },
      }
    `);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const serialized = Serializable.fromObj(obj.toObj()) as Test;
    serialized.ordinaryField = 444;
    expect(serialized.getter).toBe(444);
    serialized.ordinaryField = 123;
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with ordinary object fields", () => {
    class Test extends Serializable {
      ordinaryField = { test: 123 };
    }
    const obj = new Test();
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "ordinaryField": {
            "test": 123,
          },
        },
      }
    `);
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with ordinary external objects", () => {
    class Test extends Serializable {
      ordinaryField = { test: 123, fn() {} };
    }
    const obj = new Test();
    expect(obj.toObj()).toEqual({
      __serializedType__: "Test",
      data: {
        ordinaryField: expect.stringMatching(/external-class-Object-\d+/) as unknown,
      },
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const serialized = Serializable.fromObj(obj.toObj()) as Test;
    expect(serialized.ordinaryField).toEqual(obj.ordinaryField);
  });
  test("it works with shallow observed external objects", () => {
    class Test extends Serializable {
      @observable.ref accessor ordinaryField = { test: 123, fn() {} };
    }
    const obj = new Test();
    expect(obj.toObj()).toEqual({
      __serializedType__: "Test",
      data: {
        ordinaryField: expect.stringMatching(/external-class-Object-\d+/) as unknown,
      },
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const serialized = Serializable.fromObj(obj.toObj()) as Test;
    expect(serialized.ordinaryField).toEqual(obj.ordinaryField);
  });
  test("it works with deep observed external objects", () => {
    class Test extends Serializable {
      @observable accessor ordinaryField = { test: 123, fn() {} };
    }
    const obj = new Test();
    expect(obj.toObj()).toEqual({
      __serializedType__: "Test",
      data: {
        ordinaryField: expect.stringMatching(/external-class-Object-\d+/) as unknown,
      },
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const serialized = Serializable.fromObj(obj.toObj()) as Test;
    expect(serialized.ordinaryField).toEqual(obj.ordinaryField);
  });
  test("it works with ordinary object fields with cyclical refs", () => {
    const boom = { itself: null as unknown };
    boom.itself = boom;
    class Test extends Serializable {
      ordinaryField = { boom };
    }
    const obj = new Test();
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "ordinaryField": {
            "boom": {
              "itself": [Circular],
            },
          },
        },
      }
    `);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const deserialized = Serializable.fromObj(obj.toObj()) as typeof obj;
    expect(deserialized.ordinaryField.boom.itself).toBe(deserialized.ordinaryField.boom);
  });
  test("it works with cyclical refs in itself to itself", () => {
    class Test extends Serializable {
      ordinaryField = {};
    }
    const obj = new Test();
    obj.ordinaryField = obj;
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "ordinaryField": [Circular],
        },
      }
    `);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const deserialized = Serializable.fromObj(obj.toObj()) as typeof obj;
    expect(deserialized.ordinaryField).toBe(deserialized);
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with cyclical refs (two hops)", () => {
    class Test extends Serializable {
      nested = new Nested();
    }
    class Nested extends Serializable {
      parent = {};
    }
    const obj = new Test();
    obj.nested.parent = obj;
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "nested": {
            "__serializedType__": "Nested",
            "data": {
              "parent": [Circular],
            },
          },
        },
      }
    `);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const deserialized = Serializable.fromObj(obj.toObj()) as typeof obj;
    expect(deserialized.nested.parent).toBe(deserialized);
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with cyclical refs (two hops through Sets)", () => {
    class Test extends Serializable {
      nested = new Set<Nested>();
    }
    class Nested extends Serializable {
      parent = new Set<Test>();
    }
    const obj = new Test();
    const nested = new Nested();
    obj.nested.add(nested);
    nested.parent.add(obj);
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "nested": {
            "__serializedType__": "Set",
            "data": [
              {
                "__serializedType__": "Nested",
                "data": {
                  "parent": {
                    "__serializedType__": "Set",
                    "data": [
                      [Circular],
                    ],
                  },
                },
              },
            ],
          },
        },
      }
    `);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const deserialized = Serializable.fromObj(obj.toObj()) as typeof obj;
    expect([...[...deserialized.nested.values()][0]!.parent][0]).toBe(deserialized);
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with cyclical refs of Sets to Sets", () => {
    class Test extends Serializable {
      nested = new Set<Set<unknown>>();
    }
    const obj = new Test();
    obj.nested.add(obj.nested);
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "nested": {
            "__serializedType__": "Set",
            "data": [
              [Circular],
            ],
          },
        },
      }
    `);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const deserialized = Serializable.fromObj(obj.toObj()) as typeof obj;
    expect([...deserialized.nested.values()][0]).toBe(deserialized.nested);
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with observed primitive fields", () => {
    class Test extends Serializable {
      @observable accessor observed = 123;
    }
    const obj = new Test();
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "observed": 123,
        },
      }
    `);
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with observed object fields", () => {
    class Test extends Serializable {
      @observable accessor observed = { test: 123 };
    }
    const obj = new Test();
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "observed": {
            "test": 123,
          },
        },
      }
    `);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const serialized = Serializable.fromObj(obj.toObj()) as Test;
    expect(serialized.observed.test).toEqual(obj.observed.test);
  });
  test("it works with ordinary Set and Map fields", () => {
    class Test extends Serializable {
      ordinaryField = {
        test: new Map([
          [1, 2],
          [3, 4],
        ]),
        set: new Set(["test", "it"]),
      };
    }
    const obj = new Test();
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "ordinaryField": {
            "set": {
              "__serializedType__": "Set",
              "data": [
                "test",
                "it",
              ],
            },
            "test": {
              "__serializedType__": "Map",
              "data": [
                [
                  1,
                  2,
                ],
                [
                  3,
                  4,
                ],
              ],
            },
          },
        },
      }
    `);
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
  test("it works with observable Set and Map fields", () => {
    class Test extends Serializable {
      @observable accessor observed = {
        test: new Map([
          [1, 2],
          [3, 4],
        ]),
        set: new Set(["test", "it"]),
      };
    }
    const obj = new Test();
    expect(obj.toObj()).toMatchInlineSnapshot(`
      {
        "__serializedType__": "Test",
        "data": {
          "observed": {
            "set": {
              "__serializedType__": "Set",
              "data": [
                "test",
                "it",
              ],
            },
            "test": {
              "__serializedType__": "Map",
              "data": [
                [
                  1,
                  2,
                ],
                [
                  3,
                  4,
                ],
              ],
            },
          },
        },
      }
    `);
    expect(Serializable.fromObj(obj.toObj())).toEqual(obj);
  });
});
