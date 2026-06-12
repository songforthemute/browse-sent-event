export interface InstalledGlobalPatch {
  uninstall(): void;
}

export function installGlobalPatch<
  TTarget extends object,
  TKey extends keyof TTarget & PropertyKey,
>(
  target: TTarget,
  key: TKey,
  createReplacement: (original: TTarget[TKey]) => TTarget[TKey],
): InstalledGlobalPatch {
  const original = target[key];
  const replacement = createReplacement(original);

  Reflect.set(target, key, replacement);

  return {
    uninstall() {
      if (Reflect.get(target, key) === replacement) {
        Reflect.set(target, key, original);
      }
    },
  };
}
