export function safeImage(value: string | null): string {
    if (!value || value.length > 2048) return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
}

export function readOverlayOptions(params = new URLSearchParams(window.location.search)) {
    return {
        title: (params.get('title') || '').slice(0, 100),
        color: /^#[0-9a-f]{6}$/i.test(params.get('color') || '') ? params.get('color')! : '',
        teamLogo: safeImage(params.get('teamLogo')),
        opponentLogo: safeImage(params.get('opponentLogo')),
        sponsor: safeImage(params.get('sponsor')),
    };
}

export function applyOverlayOptions() {
    const options = readOverlayOptions();
    const overlay = document.querySelector<HTMLElement>('.overlay');
    if (options.color && overlay) {
        overlay.style.setProperty('--surface-pill', options.color);
        const rgb = options.color.slice(1).match(/../g)!.map(n => parseInt(n, 16));
        const foreground = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 155 ? '#101827' : '#ffffff';
        overlay.style.setProperty('--fg-title', foreground);
        overlay.style.setProperty('--fg-pill', foreground);
    }
    if (options.sponsor) {
        const image = document.querySelector<HTMLImageElement>('#overlay-image');
        if (image) { image.src = options.sponsor; image.style.display = 'block'; }
    }
}
