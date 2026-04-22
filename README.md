# mobx-auto-devtools

Redux Devtools adapter for Mobx. Works with Mobx 6, supports Maps, Sets, time-travel, classes, everything JSAN supports. Supports async stacktraces and AsyncLocalStorage-like context for keeping track of async actions (no need for ugly generator syntax, transpilers or "orphan" events in Redux Devtools). Autobatching of microtasks. Finally, proper devtools for proper tool.

## Decorators 

Decorator for logging action function parameters and tracking async mutations across awaits.

Decorators for obserable async values and streams (as sets, arrays or maps) for the most concise description of data fetching:

```tsx
class Node extends Serializable {
  @observable accessor name: string;

  @set("parents") accessor parents: ObservableAsyncSetGenerator<NodeModel>;

  getParents(): AsyncGenerator<NodeModel, void, void>;
  watchParents(cb: (val: Set<NodeModel>) => void): void;
}
// library may work with any framework that supports Mobx
function Node({ node }: { node: Node }) {
  if (node.parents instanceof Error) return <div>Error during loading parents: {node.parents.message}</div>;
  if (!node.parents) return <div>Loading parents...</div>;
  return (
    <>
      {node.parents.loading && "Ongoing fetch..."}
      <ul>
        {[...node.parents.entries()].map(({ name }) => (
          <li key={name}>
            {name}
          </li>
        ))}
      </ul>
    </>
  );
}
```