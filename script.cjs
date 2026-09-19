const fs = require('fs');
const path = require('path');
const dir = 'd:/Users/Akoya Tsukishiro/AppData/Local/FoundryVTT/Data/systems/tokyo-nova-axleration/templates';
function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else if (file.endsWith('.hbs')) { 
            results.push(file);
        }
    });
    return results;
}
const files = walk(dir);
let modifiedCount = 0;
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    const regex = /\{\{\s*editor\s+([^\s]+)\s+target=\"([^\"]+)\"\s+engine=\"prosemirror\"\s+button=(true|false)\s+owner=owner\s+editable=editable\s*\}\}/g;
    if (regex.test(content)) {
        content = content.replace(regex, (match, enriched, target, button) => {
            const toggled = button === 'true' ? 'true' : 'false';
            // Wait, for toggled, the author wanted the editor to be open but without a button.
            // A <prose-mirror> with toggled="true" will show the editor inline directly!
            // If button was false, it was meant to be inline directly!
            return '<prose-mirror name="' + target + '" data-document-uuid="{{document.uuid}}" value="{{' + target + '}}" toggled="true">{{{' + enriched + '}}}</prose-mirror>';
        });
        fs.writeFileSync(file, content);
        modifiedCount++;
        console.log('Modified: ' + file);
    }
});
console.log('Modified ' + modifiedCount + ' files.');
