import type { AgentRole } from '../../shared/protocol';
import manifest from './assetManifest.json';
import { ROLE_ORDER } from './pixelWorld';

export type Appearance = { type: 'adult' | 'kid'; body: string; eyes: string; outfit: string; hair: string; accessory: string };
export function defaultAppearance(role: AgentRole, type: 'adult' | 'kid' = 'adult'): Appearance {
  const i = Math.max(0, ROLE_ORDER.indexOf(role));
  const groups = manifest.parts;
  const bodies = type === 'adult' ? groups.Bodies : groups.Bodies_kids;
  const eyes = type === 'adult' ? groups.Eyes : groups.Eyes_kids;
  const outfits = type === 'adult' ? groups.Outfits : groups.Outfits_kids;
  const hair = type === 'adult' ? groups.Hairstyles : groups.Hairstyles_kids;
  return { type, body:bodies[i % bodies.length], eyes:eyes[i % eyes.length], outfit:outfits[(i * (type === 'adult' ? 12 : 1)) % outfits.length], hair:hair[(i * (type === 'adult' ? 14 : 3)) % hair.length], accessory:'' };
}
