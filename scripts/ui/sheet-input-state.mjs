/** 値の復元は入力欄だけに行う。checkbox.value への代入は value 属性を追加し、
 * Foundry のフォーム送信を boolean から文字列に変えてしまう。 */
export function isValueEntry(input) {
    return !!input?.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="image"]):not([type="hidden"])');
}

const viewDisabled = new WeakSet();

/** CSS の pointer-events では防げないラベル・キーボード経由の操作も止める。 */
export function syncViewModeCheckboxes(element, isEditMode) {
    for (const input of element.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
        if (!isEditMode && !input.disabled) {
            viewDisabled.add(input);
            input.disabled = true;
        } else if (isEditMode && viewDisabled.has(input)) {
            viewDisabled.delete(input);
            input.disabled = false;
        }
    }
}
