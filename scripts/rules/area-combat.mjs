/** エリア盤面の座標・経路・距離。Foundry非依存。 */
export function validateAreaBoard(config) {
    if (!config || config.schemaVersion !== 1) return "対応していないエリア設定です。";
    if (![config.origin?.x, config.origin?.y, config.cell?.width, config.cell?.height].every(Number.isFinite)) return "位置と寸法には数値を入力してください。";
    if (config.cell.width <= 0 || config.cell.height <= 0) return "エリアの幅と高さは0より大きくしてください。";
    if (![config.rows, config.columns].every(n => Number.isInteger(n) && n > 0 && n <= 100)
        || config.rows * config.columns > 2500) return "行・列は1〜100、エリア数は2500以内にしてください。";
    if (!/^#[0-9a-f]{6}$/i.test(config.style?.color ?? "")
        || !Number.isFinite(config.style?.alpha) || config.style.alpha < 0 || config.style.alpha > 1) return "線色と透明度を確認してください。";
    if (![config.origin.x + config.cell.width * config.columns,
        config.origin.y + config.cell.height * config.rows].every(Number.isFinite)) return "盤面の寸法が大きすぎます。";
    return null;
}

/** 境界上は右・下のエリアに属する。丸めはエリア座標上の誤差だけを吸収する。 */
function cellIndex(value) {
    const nearest = Math.round(value);
    return Math.floor(Math.abs(value - nearest) < 1e-9 ? nearest : value);
}

export function getAreaAtPoint(config, point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const column = cellIndex((point.x - config.origin.x) / config.cell.width);
    const row = cellIndex((point.y - config.origin.y) / config.cell.height);
    return column >= 0 && row >= 0 && column < config.columns && row < config.rows ? { row, column } : null;
}

/** 実際の線分列を境界で分割。往復・角・境界上での分割を保持する。 */
export function measureAreaPath(config, points) {
    if (validateAreaBoard(config) || !Array.isArray(points) || !points.length
        || points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
        return { status: "invalid", stages: null, transitions: [] };
    }
    if (points.some(p => !getAreaAtPoint(config, p))) return { status: "outside", stages: null, transitions: [] };
    const transitions = [];
    let stages = 0;
    const visit = point => {
        const area = getAreaAtPoint(config, point);
        const previous = transitions.at(-1);
        if (previous) {
            const cost = Math.abs(area.row - previous.row) + Math.abs(area.column - previous.column);
            if (!cost) return;
            stages += cost;
        }
        transitions.push(area);
    };
    visit(points[0]);
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const times = [0, 1];
        for (const [axis, count, size] of [["x", config.columns, config.cell.width], ["y", config.rows, config.cell.height]]) {
            if (a[axis] === b[axis]) continue;
            for (let j = 1; j < count; j++) {
                const t = (config.origin[axis] + size * j - a[axis]) / (b[axis] - a[axis]);
                if (t > 0 && t < 1) times.push(t);
            }
        }
        times.sort((x, y) => x - y);
        for (let j = 1; j < times.length; j++) {
            if (times[j] - times[j - 1] < 1e-12) continue;
            const t = (times[j] + times[j - 1]) / 2;
            visit({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
        visit(b);
    }
    return { status: "ok", stages, transitions };
}
