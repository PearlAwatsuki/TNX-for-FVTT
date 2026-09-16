import { SystemDataModel } from "../abstract.mjs";

/** 車両の性能は正本Itemを参照する。キャラクター用能力・経験点・手札は持たない。 */
export class VehicleDataModel extends SystemDataModel {
    static defineSchema() {
        const f = foundry.data.fields;
        return {
            description: new f.HTMLField({ initial: "" }),
            outfitUuid: new f.StringField({ initial: "" }),
            crew: new f.ArrayField(new f.SchemaField({
                actorUuid: new f.StringField({ required: true, blank: false }),
                tokenUuid: new f.StringField({ initial: "" }),
                role: new f.StringField({ choices: ["driver", "passenger"], initial: "passenger" }),
                operationMode: new f.StringField({ choices: ["onboard", "remote"], initial: "onboard" }),
            })),
        };
    }
}
