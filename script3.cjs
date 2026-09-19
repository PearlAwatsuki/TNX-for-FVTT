const fs = require('fs');
function replaceContextMenu(file) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Replace { name: "...", icon: "...", condition: ... }
    content = content.replace(/name:\s*([^,]+),\s*icon:\s*([^,]+),\s*condition:/g, 'label: $1,\n            icon: $2,\n            visible:');
    
    // Special replacements for one-liners or specific formats
    content = content.replace(/name: \"(.*?)\",(\s*)icon:/g, 'label: "$1",$2icon:');
    content = content.replace(/condition: \(\) => this\.isEditable/g, 'visible: () => this.isEditable');
    content = content.replace(/condition: \(\) => !!this\.item\.system\.miracle\?\.id/g, 'visible: () => !!this.item.system.miracle?.id');
    content = content.replace(/condition: \(\) => !!this\.item\.system\.skillName \|\| !!this\.item\.system\.skillId/g, 'visible: () => !!this.item.system.skillName || !!this.item.system.skillId');
    
    content = content.replace(/condition: game\.user\.isGM/g, 'visible: game.user.isGM');
    content = content.replace(/condition: \(li\) =>/g, 'visible: (li) =>');
    content = content.replace(/condition: \(\) => sheet\.isEditable/g, 'visible: () => sheet.isEditable');
    // Only in ContextMenu
    if (file.includes('dictionary-cards')) {
        content = content.replace(/condition: system\.usageCondition/g, 'visible: system.usageCondition');
    }

    fs.writeFileSync(file, content);
}

replaceContextMenu('d:/Users/Akoya Tsukishiro/AppData/Local/FoundryVTT/Data/systems/tokyo-nova-axleration/scripts/item/tnx-style-skill-sheet.mjs');
replaceContextMenu('d:/Users/Akoya Tsukishiro/AppData/Local/FoundryVTT/Data/systems/tokyo-nova-axleration/scripts/item/tnx-style-sheet.mjs');
replaceContextMenu('d:/Users/Akoya Tsukishiro/AppData/Local/FoundryVTT/Data/systems/tokyo-nova-axleration/scripts/item/tnx-outfit-sheet.mjs');
replaceContextMenu('d:/Users/Akoya Tsukishiro/AppData/Local/FoundryVTT/Data/systems/tokyo-nova-axleration/scripts/item/outfit-combine.mjs');
replaceContextMenu('d:/Users/Akoya Tsukishiro/AppData/Local/FoundryVTT/Data/systems/tokyo-nova-axleration/scripts/item/tnx-life-path-sheet.mjs');
replaceContextMenu('d:/Users/Akoya Tsukishiro/AppData/Local/FoundryVTT/Data/systems/tokyo-nova-axleration/scripts/app/tnx-hud.mjs');
replaceContextMenu('d:/Users/Akoya Tsukishiro/AppData/Local/FoundryVTT/Data/systems/tokyo-nova-axleration/scripts/core/register-ui-injections.mjs');

