const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class TnxScenarioSettingWizard extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(journal, options = {}) {
        super(options);
        this.journal = journal;
    }

    static DEFAULT_OPTIONS = {
        id: "tnx-scenario-wizard",
        classes: ["tokyo-nova", "dialog"],
        position: { width: 500 },
        window: { title: "シナリオ・セットアップ", resizable: true },
        actions: {
            increment:   TnxScenarioSettingWizard._onIncrement,
            decrement:   TnxScenarioSettingWizard._onDecrement,
            finishSetup: TnxScenarioSettingWizard._onFinishSetup,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/parts/scenario-setting-wizard.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.journalName = this.journal.name;
        return context;
    }

    static _onIncrement(_event, target) {
        const input = target.closest(".number-input-spinner")?.querySelector('input[type="number"]');
        if (!input) return;
        let v = parseInt(input.value, 10);
        if (isNaN(v)) v = parseInt(input.min, 10) || 0;
        input.value = v + 1;
    }

    static _onDecrement(_event, target) {
        const input = target.closest(".number-input-spinner")?.querySelector('input[type="number"]');
        if (!input) return;
        let v = parseInt(input.value, 10);
        if (isNaN(v)) v = parseInt(input.min, 10) || 0;
        const min = parseInt(input.min, 10);
        input.value = isNaN(min) ? v - 1 : Math.max(v - 1, min);
    }

    static async _onFinishSetup(_event, _target) {
        const form = this.element.querySelector("form");
        const data = new FormDataExtended(form).object;
        await this._executeSetup(data);
    }

    async _executeSetup(data) {
        if (data.journalName && this.journal.name !== data.journalName) {
            await this.journal.update({ name: data.journalName });
        }

        const updates = {};

        // シーン構成を作成
        const sceneCounts = data.sceneCounts || {};
        const scenes = { opening: [], research: [], climax: [], ending: [] };
        let sceneCounter = 1;
        for (const phase in scenes) {
            const count = parseInt(sceneCounts[phase]) || 0;
            for (let i = 0; i < count; i++) {
                scenes[phase].push({
                    id: foundry.utils.randomID(), number: sceneCounter++, name: `新規シーン ${i + 1}`,
                    player: "", isMasterScene: false,
                    switchMessage: `▼ ${phase.charAt(0).toUpperCase() + phase.slice(1)} SCENE`,
                });
            }
        }
        updates['flags.tokyo-nova-axleration.scenes'] = scenes;
        updates['flags.tokyo-nova-axleration.currentState'] = { phase: 'opening', sceneId: scenes.opening[0]?.id || null };

        // ハンドアウトを作成
        const pcCount = parseInt(data.pcCount) || 4;
        const handouts = [];
        for (let i = 1; i <= pcCount; i++) {
            handouts.push({
                id: foundry.utils.randomID(), pcName: `PC${i}`, title: `ハンドアウト ${i}`,
                connections: "", recommendedSuit: "", recommendedStyle: "",
                content: "", ps: "",
            });
        }
        updates['flags.tokyo-nova-axleration.handouts'] = handouts;
        updates['flags.tokyo-nova-axleration.trailer'] = "";

        await this.journal.update(updates);

        ui.notifications.info("シナリオのセットアップが完了しました。カードのセットアップはゲーム設定の「カードをセットアップ」から行えます。");
        await this.journal.sheet.render({ force: true });
        this.close();
    }
}
