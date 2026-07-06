export function rootPathForName(name: string): string {
  return `/${encodeURIComponent(name)}/`;
}

export function childPathForName(parentPath: string, parentParam: string, name: string): string {
  return `${parentPath.replace(/\/+$/g, "")}/{${parentParam}}/${encodeURIComponent(name)}/`;
}

export function parentIdParamForName(name: string): string {
  return `${name}Id`;
}
