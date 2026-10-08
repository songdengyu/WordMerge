export type HouseStyle = { tier: string; roofType: 'thatch' | 'wood' | 'tile'; floor: number; wall: number; roof: number; trim: number; accent: number; rise: number }
const rustic: HouseStyle = { tier: '简朴', roofType: 'wood', floor: 0xc3a477, wall: 0xa48663, roof: 0xb7795e, trim: 0xe4c89d, accent: 0x819d91, rise: 14 }
const cozy: HouseStyle = { tier: '温馨', roofType: 'tile', floor: 0xcda978, wall: 0xd9c9a5, roof: 0x718e7e, trim: 0xf0dfb8, accent: 0x7098a1, rise: 20 }
const elegant: HouseStyle = { tier: '精致', roofType: 'tile', floor: 0xd9c5ae, wall: 0xc3c0b3, roof: 0x8c7998, trim: 0xf2e1cb, accent: 0x7baab5, rise: 26 }
export function houseStyle(id: string): HouseStyle {
  if (id === 'meadow-hut') return { ...rustic, roofType: 'thatch', roof: 0xb6a164, wall: 0x9b815c, rise: 12 }
  if (id === 'cedar-home' || id === 'garden-cabin') return cozy
  if (id === 'rose-manor') return elegant
  if (id === 'guest-cabin') return { ...elegant, roof: 0x70879d }
  if (id === 'lodge') return { ...cozy, roof: 0x8f665b }
  return rustic
}
export const hexColor = (color: number) => `#${color.toString(16).padStart(6, '0')}`
