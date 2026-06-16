export function compactObject<T extends Record<string, unknown>>(input: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const output: Partial<Record<keyof T, unknown>> = {};
  for (const [key, value] of Object.entries(input) as Array<[keyof T, unknown]>) {
    if (value !== undefined) output[key] = value;
  }
  return output as { [K in keyof T]?: Exclude<T[K], undefined> };
}
