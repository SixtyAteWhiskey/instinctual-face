/** Connect IQ Instinct profiles. Sources and exclusions: docs/GARMIN.md. */
export const MONOCHROME_COLORS = Object.freeze(['#111111', '#eeeeee']);
export const AMOLED_COLORS = Object.freeze(['#000000', '#ffffff', '#eeeeee', '#ff7557', '#63deae', '#73b9ff', '#ffd479', '#bd9aff']);

function profile(id, name, width, height, display, options = {}) {
  return Object.freeze({
    id, name, width, height, size: Math.min(width, height), display,
    subtitle: `${width} × ${height} px · ${display === 'amoled' ? 'AMOLED color' : 'monochrome MIP'}`,
    colors: display === 'amoled' ? AMOLED_COLORS : MONOCHROME_COLORS,
    supported: true, shape: display === 'amoled' ? 'round' : 'semi-octagon',
    subscreen: null, hasSubscreen: display === 'mip',
    maxFontSize: display === 'amoled' ? 512 : 128,
    fontMax: display === 'amoled' ? 512 : 128,
    minApiLevel: '3.2.7', launcherIconSize: 62,
    // Conservative geometry around the rounded MIP corners and opaque window
    // bezel. Exact subscreen coordinates below come from Garmin SDK profiles.
    displayCornerCut: 0.24,
    ...options,
  });
}

export const DEVICES = Object.freeze({
  instinct2: profile('instinct2', 'Instinct 2 / Solar', 176, 176, 'mip', { variants: ['Standard', 'Solar / Dual Power', 'Tactical', 'Surf', 'Camo', 'dēzl'], subscreen: Object.freeze({ x: 113, y: 1, width: 62, height: 62 }) }),
  instinct2s: profile('instinct2s', 'Instinct 2S / Solar', 163, 156, 'mip', { variants: ['Standard', 'Solar / Dual Power', 'Surf', 'Camo'], launcherIconSize: 54, subscreen: Object.freeze({ x: 109, y: 0, width: 54, height: 54 }) }),
  instinct2x: profile('instinct2x', 'Instinct 2X Solar', 176, 176, 'mip', { variants: ['Solar', 'Solar Tactical'], subscreen: Object.freeze({ x: 113, y: 1, width: 62, height: 62 }) }),
  instinct3solar45mm: profile('instinct3solar45mm', 'Instinct 3 Solar 45 mm', 176, 176, 'mip', { variants: ['Solar', 'Solar Tactical'], minApiLevel: '5.0.0', minNativeFontHeight: 23, subscreen: Object.freeze({ x: 113, y: 0, width: 62, height: 62 }) }),
  // Garmin groups both Solar case sizes in the same SDK product profile.
  instinct3solar50mm: profile('instinct3solar45mm', 'Instinct 3 Solar 50 mm', 176, 176, 'mip', { variants: ['Solar', 'Solar Tactical'], minApiLevel: '5.0.0', sharedProfile: 'instinct3solar45mm', minNativeFontHeight: 23, subscreen: Object.freeze({ x: 113, y: 0, width: 62, height: 62 }) }),
  instinct3amoled45mm: profile('instinct3amoled45mm', 'Instinct 3 AMOLED 45 mm', 390, 390, 'amoled', { variants: ['AMOLED', 'AMOLED Tactical'], minApiLevel: '5.0.0', launcherIconSize: 60 }),
  instinct3amoled50mm: profile('instinct3amoled50mm', 'Instinct 3 AMOLED 50 mm', 416, 416, 'amoled', { variants: ['AMOLED', 'AMOLED Tactical'], minApiLevel: '5.0.0', launcherIconSize: 60 }),
  instinctcrossover: profile('instinctcrossover', 'Instinct Crossover / Solar', 176, 176, 'mip', { hybrid: true, hasSubscreen: false, variants: ['Standard', 'Solar', 'Solar Tactical'], launcherIconSize: 26 }),
  instinctcrossoveramoled: profile('instinctcrossoveramoled', 'Instinct Crossover AMOLED', 390, 390, 'amoled', { hybrid: true, variants: ['AMOLED', 'AMOLED Tactical'], minApiLevel: '5.0.0', launcherIconSize: 38 }),
  instincte40mm: profile('instincte40mm', 'Instinct E 40 mm', 166, 166, 'mip', { minApiLevel: '5.0.0', launcherIconSize: 52 }),
  instincte45mm: profile('instincte45mm', 'Instinct E 45 mm', 176, 176, 'mip', { minApiLevel: '5.0.0' }),
});

/** Legacy hardware cannot install third-party Connect IQ watch faces. */
export const UNSUPPORTED_DEVICES = Object.freeze([
  Object.freeze({ id: 'instinct', name: 'Original Instinct (including Tactical, Camo, Esports)', supported: false, reason: 'First-generation Instinct hardware does not support Connect IQ watch-face apps.' }),
  Object.freeze({ id: 'instinctsolar', name: 'Original Instinct Solar (including Tactical, Surf)', supported: false, reason: 'First-generation Instinct Solar hardware does not support Connect IQ watch-face apps.' }),
]);

export function isDeviceColor(color, device) {
  const profile = typeof device === 'string' ? DEVICES[device] : device;
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) &&
    (profile?.display === 'amoled' || MONOCHROME_COLORS.includes(color.toLowerCase()));
}

export function quantizeMonochrome(color) {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Colors must use #RRGGBB hexadecimal notation.');
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 >= 128 ? '#eeeeee' : '#111111';
}
