/**
 * @fileoverview TnxRollTableDataModel - カード引きロールテーブルの DataModel
 *
 * deckMode "doc"        : 仮想 DoC（54枚フルデッキ）から毎回ドロー。カード数値スロット 14 種固定。
 * deckMode "configured" : ゲーム内の実デッキに紐付け。HUD ドロー時に自動ルックアップ。
 *                         エントリはカード名（label）と結果テキスト（text）の動的配列。
 */

import { SystemDataModel } from "../abstract.mjs";

export class TnxRollTableDataModel extends SystemDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    const slotField = () => new fields.StringField({ initial: "", blank: true, nullable: false });

    return {
      deckMode: new fields.StringField({ initial: "doc", blank: false, nullable: false }),
      deckId:   new fields.StringField({ initial: "", blank: true }),
      // Doc モード固定スロット (Joker / 2-A)
      docResults: new fields.SchemaField({
        joker:  slotField(),
        two:    slotField(),
        three:  slotField(),
        four:   slotField(),
        five:   slotField(),
        six:    slotField(),
        seven:  slotField(),
        eight:  slotField(),
        nine:   slotField(),
        ten:    slotField(),
        jack:   slotField(),
        queen:  slotField(),
        king:   slotField(),
        ace:    slotField(),
      }),
      // Configured モード動的エントリ
      deckResults: new fields.ArrayField(new fields.SchemaField({
        label: new fields.StringField({ initial: "", blank: true }),
        text:  new fields.StringField({ initial: "", blank: true }),
      })),
    };
  }
}

// ─── DoC ドローユーティリティ ─────────────────────────────────────────────────

/** 54 枚フルデッキから仮想ドローし、スロットキーを返す */
export function drawVirtualDoC() {
  const KEYS = ["joker","two","three","four","five","six","seven","eight","nine","ten","jack","queen","king","ace"];
  // joker: 2 枚 / 2-A: 各 4 枚 = 計 54
  const idx = Math.floor(Math.random() * 54);
  if (idx < 2) return "joker";
  return KEYS[1 + Math.floor((idx - 2) / 4)];
}

export const DOC_SLOT_LABELS = {
  joker: "Joker", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  jack: "J", queen: "Q", king: "K", ace: "A",
};

/**
 * HUD ドロー後、開いている tnxTable シートをルックアップしてチャット投稿する。
 * @param {Card}   card           ドローされた Card ドキュメント
 * @param {string} sourceDeckUuid ドロー元デッキの UUID
 */
export async function lookupFromCard(card, sourceDeckUuid) {
  for (const app of foundry.applications.instances.values()) {
    const table = app.document;
    if (!(table instanceof RollTable)) continue;
    if (table.type !== "tnxTable") continue;
    if (table.system.deckMode !== "configured") continue;
    if (table.system.deckId !== sourceDeckUuid) continue;

    const cardName = card.name ?? "";
    const entry = table.system.deckResults.find(e => {
      if (!e.label) return false;
      return cardName.includes(e.label) || e.label.includes(cardName);
    });
    if (!entry?.text) continue;

    await ChatMessage.create({
      content: `<div class="tnx-roll-table-result">
        <strong>${table.name}</strong>
        <div class="tnx-result-card-name">${cardName}</div>
        <div class="tnx-result-text">${entry.text}</div>
      </div>`,
      speaker: { alias: table.name },
    });
  }
}
