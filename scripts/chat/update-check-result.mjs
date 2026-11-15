/** カード・内訳を保ったまま、保存する本文の達成値と成否を更新する。 */
export function updateCheckResultContent(content, result, { showSuccess = false, targetValue = null } = {}) {
    const template = document.createElement("template");
    template.innerHTML = content;
    for (const row of template.content.querySelectorAll(".tnx-card__field")) {
        if (row.querySelector(".tnx-card__field-label")?.textContent.trim() !== "達成値") continue;
        const value = row.querySelector(".tnx-card__field-value--total, .tnx-card__field-value");
        if (value) value.textContent = String(result.achievement);
    }
    if (showSuccess && !result.fumble) {
        const host = template.content.querySelector(".tnx-card__body") ?? template.content.querySelector(".tnx-card");
        let banner = host?.querySelector(".tnx-card__result--success, .tnx-card__result--failure");
        if (!banner && host) { banner = document.createElement("div"); host.append(banner); }
        if (banner) {
            banner.className = `tnx-card__result tnx-card__result--${result.success ? "success" : "failure"}`;
            banner.replaceChildren();
            const text = document.createElement("span");
            text.className = "tnx-card__result-text";
            const icon = document.createElement("i");
            icon.className = `fas ${result.success ? "fa-check" : "fa-times"}`;
            text.append(icon, result.success ? " 成功" : " 失敗");
            const note = value => {
                const span = document.createElement("span");
                span.className = "tnx-card__result-note";
                span.textContent = value;
                text.append(span);
            };
            if (result.forcedFailure) note(result.forcedFailure);
            if (targetValue !== null) note(`目標値 ${targetValue}`);
            if (Number.isFinite(result.diff)) note(`差分値 ${result.diff >= 0 ? "+" : ""}${result.diff}`);
            banner.append(text);
        }
    }
    return template.innerHTML;
}
