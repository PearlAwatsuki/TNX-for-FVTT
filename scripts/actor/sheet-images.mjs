/** コマ画像を直接選択し、立ち絵と独立して保存する。 */
export async function editTokenImage(event, target) {
    event.preventDefault();
    if (!this.isEditable || !this._isEditMode) return;
    const actor = this.actor;
    const token = actor.isToken ? actor.token : actor.prototypeToken;
    const picker = new foundry.applications.apps.FilePicker.implementation({
        type: "image",
        current: token.texture.src,
        callback: async path => {
            if (!this.isEditable || !this._isEditMode) return;
            if (actor.isToken) await token.update({ "texture.src": path });
            else await actor.update({ "prototypeToken.texture.src": path });
            target.src = path;
        },
        position: { top: this.position.top + 40, left: this.position.left + 10 }
    });
    await picker.browse();
}
