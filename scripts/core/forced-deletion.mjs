/** Foundry v14 の強制削除演算子を返す。旧 "-=key" 構文は使用しない。 */
export function forcedDeletion() {
  const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
  if (!ForcedDeletion) throw new Error("FoundryのForcedDeletion APIが利用できません。");
  return ForcedDeletion.create();
}

/** updateData のネストパスへ強制削除演算子を設定する。 */
export function setForcedDeletion(updateData, path) {
  const parts = String(path).split(".");
  let current = updateData;
  for (const part of parts.slice(0, -1)) current = current[part] ??= {};
  current[parts.at(-1)] = forcedDeletion();
  return updateData;
}
