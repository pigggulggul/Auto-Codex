import iceCreamComponents from './iceCreamComponents.json';
// Independent objects extracted from reference layers.
export const EXTRA_INTERIOR_ASSETS = [
  '/assets/Interiors/Theme_Sorter_Singles_48x48/26_Condominium_Singles_48x48/Condominium_Singles_48x48_87.png',
  '/assets/Interiors/Theme_Sorter_Singles_48x48/26_Condominium_Singles_48x48/Condominium_Singles_48x48_90.png',
  '/assets/Interiors/Theme_Sorter_Singles_48x48/26_Condominium_Singles_48x48/Condominium_Singles_48x48_91.png',
  '/assets/Interiors/Theme_Sorter_Singles_48x48/8_Gym_Singles_48x48/Gym_Singles_48x48_210.png',
  ...iceCreamComponents.map(item => item.asset),
];
export const EXTRA_INTERIOR_DIMENSIONS: Record<string, [number, number]> = {
  [EXTRA_INTERIOR_ASSETS[1]]: [96, 48],
  [EXTRA_INTERIOR_ASSETS[2]]: [96, 112],
  [EXTRA_INTERIOR_ASSETS[3]]: [48, 99],
  ...Object.fromEntries(iceCreamComponents.map(item => [item.asset, [item.width, item.height] as [number, number]])),
};
