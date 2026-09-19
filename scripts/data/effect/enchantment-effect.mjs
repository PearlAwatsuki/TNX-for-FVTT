const BaseClass = foundry.data?.ActiveEffectTypeDataModel ?? foundry.abstract.TypeDataModel;

export class EnchantmentEffectDataModel extends BaseClass {
    static defineSchema() {
        const schema = BaseClass.defineSchema ? BaseClass.defineSchema() : {};
        if (!schema.changes) {
            schema.changes = new foundry.data.fields.ArrayField(
                new foundry.data.fields.SchemaField({
                    key: new foundry.data.fields.StringField({ required: true, blank: false }),
                    mode: new foundry.data.fields.NumberField({ integer: true, initial: 2 }),
                    value: new foundry.data.fields.StringField({ required: true }),
                    priority: new foundry.data.fields.NumberField()
                })
            );
        }
        return schema;
    }
}
