/** 用途固有の指定を終えてから、共通のカード判定へ進む。 */
export async function prepareCheckContext(context) {
    const prepared = foundry.utils.deepClone(context);
    const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
    const ask = (title, content, read) => foundry.applications.api.DialogV2.wait({
        window: { title },
        classes: ["tokyo-nova", "tnx-dialog"],
        content,
        buttons: [
            { action: "ok", label: "判定へ進む", default: true,
                callback: (_event, _button, dialog) => read(dialog.element) },
            { action: "cancel", label: "キャンセル", callback: () => false },
        ],
        close: () => false,
        rejectClose: false,
    });

    const reaction = prepared.reaction;
    const attack = reaction && !reaction.open
        ? game.messages.get(reaction.attackMessageId)?.getFlag(game.system.id, "attackCheck") : null;
    if (attack && attack.isAttack !== false) {
        const targets = (attack.targets ?? []).filter((_target, index) => index !== reaction.targetIndex);
        const result = await ask("リアクションの効果", `<fieldset><legend>対決に勝った場合の効果</legend>
            <label><input type="checkbox" name="failsAttack" ${reaction.failsAttack ? "checked" : ""}>攻撃を失敗させる</label>
            ${targets.length ? `<div>併せて回避する対象</div>${targets.map(target =>
                `<label class="tnx-dialog-check-row"><input type="checkbox" name="protect" value="${esc(target.uuid)}"
                    ${(reaction.protectedTargetUuids ?? []).includes(target.uuid) ? "checked" : ""}>${esc(target.name)}</label>`).join("")}` : ""}
            </fieldset>`, element => ({
            failsAttack: element.querySelector('[name="failsAttack"]').checked,
            protectedTargetUuids: [...element.querySelectorAll('[name="protect"]:checked')].map(input => input.value),
        }));
        if (!result || typeof result !== "object") return null;
        prepared.reaction = { ...reaction, ...result };
    }

    if (prepared.editableTargetValue) {
        const result = await ask("目標値の指定", `<label>目標値
            <input type="number" name="targetValue" value="${esc(prepared.targetValue)}"></label>`, element => {
            const input = element.querySelector('[name="targetValue"]');
            return { targetValue: input.value === "" ? null : input.valueAsNumber };
        });
        if (!result || typeof result !== "object") return null;
        if (result.targetValue !== null && !Number.isFinite(result.targetValue)) return null;
        prepared.targetValue = result.targetValue;
    }
    return prepared;
}
