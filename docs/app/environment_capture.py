"""Bounded Pyodide environment metadata without invoking user-defined methods.

The worker calls capture(globals()) in its persistent interpreter. Arbitrary
objects are opaque; only exact built-in containers are traversed.
"""
import json

MAX_NODES = 256
MAX_CHILDREN = 12
MAX_DEPTH = 2
MAX_VARIABLES = 128
MAX_BYTES = 65536


def capture(namespace):
    if type(namespace) is not dict:
        raise TypeError("Environment must be a Python globals dictionary")
    state = {"nodes": 0, "truncated": False}

    def describe(name, value, depth, ancestors):
        if state["nodes"] >= MAX_NODES:
            state["truncated"] = True
            return None
        state["nodes"] += 1
        exact = type(value)
        kind = type.__getattribute__(exact, "__name__")[:100]
        size = len(value) if exact in (str, bytes, list, tuple, dict, set, frozenset) else None
        if exact is str:
            preview = repr(value[:120])
        elif exact is int:
            preview = str(value) if value.bit_length() <= 512 else "<large integer>"
        elif exact in (float, bool, type(None)):
            preview = repr(value)
        elif exact is bytes:
            preview = repr(value[:64])
        elif size is not None:
            preview = f"{size} item(s)"
        else:
            preview = "<not evaluated>"
        node = {"name": name[:160], "type": kind, "preview": preview[:160],
                "shape": [size] if exact in (list, tuple) else None}
        if depth >= MAX_DEPTH or exact not in (list, tuple, dict):
            return node
        if id(value) in ancestors:
            node["cycle"] = True
            return node
        next_ancestors = ancestors | {id(value)}
        children = []
        if exact in (list, tuple):
            items = ((f"[{i}]", value[i]) for i in range(min(size, MAX_CHILDREN)))
        else:
            def safe_items():
                for i, (key, item) in enumerate(value.items()):
                    if i >= MAX_CHILDREN:
                        break
                    if type(key) is str:
                        label = "[" + json.dumps(key[:80], ensure_ascii=True) + "]"
                    elif type(key) is int and key.bit_length() <= 512:
                        label = "[" + str(key) + "]"
                    else:
                        state["truncated"] = True
                        continue
                    yield label, item
            items = safe_items()
        for label, item in items:
            child = describe(label, item, depth + 1, next_ancestors)
            if child is None:
                break
            children.append(child)
        if children:
            node["children"] = children
        if size > len(children):
            node["truncated"] = True
            state["truncated"] = True
        return node

    variables = []
    for name, value in namespace.items():
        if type(name) is not str or name.startswith("_"):
            continue
        if len(variables) >= MAX_VARIABLES:
            state["truncated"] = True
            break
        node = describe(name, value, 0, frozenset())
        if node is None:
            break
        variables.append(node)

    result = {"variables": variables, "truncated": state["truncated"]}
    encoded = json.dumps(result, ensure_ascii=True, separators=(",", ":"))
    while len(encoded.encode("utf-8")) > MAX_BYTES and variables:
        variables.pop()
        result["truncated"] = True
        encoded = json.dumps(result, ensure_ascii=True, separators=(",", ":"))
    return result
