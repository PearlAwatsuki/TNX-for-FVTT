export function wrapMenu(menu) {
    return menu.map(opt => {
        const wrapped = { ...opt };
        if (opt.onClick) {
            wrapped.onClick = (...args) => {
                const target = args[0] instanceof Event ? (args[1] || args[0].currentTarget || args[0].target) : args[0];
                return opt.onClick(target);
            };
        }
        if (opt.visible && typeof opt.visible === 'function') {
            wrapped.visible = (...args) => {
                const target = args[0] instanceof Event ? (args[1] || args[0].currentTarget || args[0].target) : args[0];
                return opt.visible(target);
            };
        }
        return wrapped;
    });
}

