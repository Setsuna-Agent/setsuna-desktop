export function saveName(input: string, save: (name: string) => Promise<boolean>) {
  const name = input.trim();
  return name && !/[\p{C}]/u.test(name) ? save(name) : Promise.resolve(false);
}

export function unusedName(base: string, names: readonly string[]) {
  const existing = new Set(names);
  let name = base;
  for (let suffix = 2; existing.has(name); suffix += 1) {
    const ending = ` ${suffix}`;
    const prefix = base.slice(0, 128 - ending.length).replace(/\p{Cs}$/u, '').trimEnd();
    name = `${prefix}${ending}`;
  }
  return name;
}
