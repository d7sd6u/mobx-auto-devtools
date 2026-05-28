export const reflectFunctionParams = (f: UnknownFunction): string[] =>
  /(?:(?:function)?\s*\w*)?\s*(?:\((.*?)\)|([^\s]+))/
    .exec(
      f
        .toString()
        .replaceAll(/[\r\n\s]*async/g, "")
        .replaceAll(/[\r\n\s]+/g, " "),
    )
    ?.slice(1, 3)
    .join("")
    .split(/\s*,\s*/)
    .filter((v) => !!v.trim()) ?? [];

// Function is not compatible with (...args: unknown[]) => unknown
// And the only inbuilt guards for functions return Function (typeof fn === 'function')
// oxlint-disable-next-line typescript/ban-types
export type UnknownFunction = Function;
export function getConstructor(v: unknown): UnknownFunction | undefined {
  if (typeof v !== "object" || !v) return undefined;
  const prototype: unknown = Object.getPrototypeOf(v);

  if (
    !!prototype &&
    typeof prototype === "object" &&
    "constructor" in prototype &&
    typeof prototype.constructor === "function"
  ) {
    return prototype.constructor;
  }
  return undefined;
}
