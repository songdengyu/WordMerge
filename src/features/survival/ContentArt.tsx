import { OUTFITS, type DecorId } from '../../game/progressionConfig'
import { houseStyle, hexColor } from '../../scene/houseStyle'
import { blueprintById } from '../../game/buildingConfig'
import { useId, useState } from 'react'
import { sceneArtUrl } from '../../scene/sceneArtCatalog'

export function HouseArt({ id }: { id: string }) {
  const patternId = useId().replace(/:/g, '')
  const s = houseStyle(id), fancy = s.tier === '精致'
  const blueprint = blueprintById(id)
  if (blueprint?.cells) {
    const cells = blueprint.cells, project = (x: number, y: number, h = 0) => `${50 + (x - y) * 9},${18 + (x + y) * 5 - h}`
    return <svg viewBox="0 0 100 84" aria-hidden="true">
      <ellipse cx="50" cy="64" rx="42" ry="9" fill="#5c7358" opacity=".12" />
      {cells.map(c => <g key={`${c.x},${c.y}`}>
        {[[1, 0], [0, 1]].filter(([dx, dy]) => !cells.some(n => n.x === c.x + dx && n.y === c.y + dy)).map(([dx, dy]) => {
          const a = [c.x + dx / 2 - dy / 2, c.y + dy / 2 + dx / 2], b = [c.x + dx / 2 + dy / 2, c.y + dy / 2 - dx / 2]
          return <polygon key={`${dx},${dy}`} points={[project(a[0], a[1]), project(b[0], b[1]), project(b[0], b[1], -12), project(a[0], a[1], -12)].join(' ')} fill={hexColor(s.wall)} stroke={hexColor(s.trim)} strokeWidth=".6" />
        })}
        <polygon points={[[c.x - .5, c.y - .5], [c.x + .5, c.y - .5], [c.x + .5, c.y + .5], [c.x - .5, c.y + .5]].map(([x, y]) => project(x, y)).join(' ')} fill={hexColor(s.roof)} />
        <path d={`M${project(c.x - .3, c.y)}L${project(c.x + .3, c.y)}`} stroke={hexColor(s.trim)} opacity=".45" strokeWidth=".6" />
      </g>)}
    </svg>
  }
  return <svg viewBox="0 0 100 84" aria-hidden="true">
    {id === 'cabin' && <defs>
      <pattern id={`${patternId}-wall`} patternUnits="userSpaceOnUse" width="24" height="40">
        <rect width="24" height="40" fill={hexColor(s.wall)} /><image href={sceneArtUrl('wall')} width="24" height="40" preserveAspectRatio="none" />
      </pattern>
      <pattern id={`${patternId}-roof`} patternUnits="userSpaceOnUse" width="70" height="55">
        <rect width="70" height="55" fill={hexColor(s.roof)} /><image href={sceneArtUrl('roof')} width="70" height="55" preserveAspectRatio="none" />
      </pattern>
    </defs>}
    <ellipse cx="50" cy="74" rx="42" ry="7" fill="#5c7358" opacity=".12" />
    <path d="M14 40 55 27 89 44v24L49 80 14 62Z" fill={id === 'cabin' ? `url(#${patternId}-wall)` : hexColor(s.wall)} stroke={hexColor(s.trim)} strokeWidth="2" />
    <path d="M14 51 49 68 89 55M49 51v29" fill="none" stroke={hexColor(s.trim)} strokeWidth="1.5" />
    <path d="m9 40 23-30 40 13 22 20-43 17Z" fill={id === 'cabin' ? `url(#${patternId}-roof)` : hexColor(s.roof)} stroke={hexColor(s.trim)} strokeWidth="2" />
    <path d="m32 10 19 50 21-37M20 29l61 21M26 20l48 18" fill="none" stroke={hexColor(s.trim)} strokeWidth="1" opacity=".7" />
    <path d="M25 54 37 60v14l-12-6Z" fill="#966846" stroke={hexColor(s.trim)} />
    <path d="M62 60 77 55v12l-15 5Z" fill={hexColor(s.accent)} stroke={hexColor(s.trim)} strokeWidth="2" />
    <path d="m69 58 1 12M62 66l15-5" stroke={hexColor(s.trim)} />
    {fancy && <><path d="M67 22V10h9v18" fill="#afaaa0" stroke={hexColor(s.trim)} strokeWidth="2" /><path d="m9 41 42 19 43-17" fill="none" stroke="#f6e9d3" strokeWidth="3" /></>}
    {s.roofType === 'thatch' && <path d="m15 37 7-11m1 16 8-14m1 18 8-13m13 23 9-15m1 11 10-14m1 9 10-12" stroke="#e0cf94" strokeWidth="2" />}
  </svg>
}

export function OutfitArt({ id }: { id: string }) {
  const outfit = OUTFITS.find(o => o.id === id) ?? OUTFITS[0]
  return <svg viewBox="0 0 60 72" aria-hidden="true">
    <path d="M21 20 8 30l6 13 8-4-6 27h28l-6-27 8 4 6-13-13-10q-9 8-18 0" fill={hexColor(outfit.color)} stroke="#f5e4c7" strokeWidth="1.5" />
    <path d="M22 39h16M24 26l14 34" stroke="#f4e2bd" fill="none" strokeWidth="2" />
    {id === 'meadow' && <><path d="M19 16q0-16 11-16t11 16" fill="#d8be7b" /><ellipse cx="30" cy="17" rx="23" ry="5" fill="#e5cc8b" /><path d="M22 38h16v20H22Z" fill="#ece2b4" /></>}
    {id === 'rain' && <><path d="M18 23q-3-23 12-23t12 23l-12-7Z" fill="#709fb3" /><path d="M22 25 13 55l17-8 17 8-9-30" fill="#82b2c3" /><circle cx="30" cy="29" r="2" fill="#ead48c" /></>}
    {id === 'starlight' && <><path d="m23 40-10 26h34L37 40" fill="#a39cc8" /><path d="m30 46 2 4 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1Z" fill="#f2dc95" /><path d="M33 2a7 7 0 1 0 7 10A8 8 0 0 1 33 2" fill="#ead694" /></>}
  </svg>
}

export function DecorationArt({ kind }: { kind: DecorId }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (failed !== kind) return <svg viewBox="0 0 80 80" aria-hidden="true">
    <image href={sceneArtUrl(kind)} x="4" y="2" width="72" height="76" preserveAspectRatio="xMidYMid meet" onError={() => setFailed(kind)} />
  </svg>
  return <svg viewBox="0 0 80 80" aria-hidden="true" strokeLinejoin="round" strokeLinecap="round">
    <ellipse cx="40" cy="68" rx="30" ry="6" fill="#5f7357" opacity=".12" />
    {kind === 'chair' ? <><path d="M22 47V18h36v29M24 54v16m32-16v16" fill="#d4b886" stroke="#91724f" strokeWidth="5" /><path d="M20 44h40v13H20Z" fill="#eee0bd" stroke="#aa8c64" strokeWidth="3" /><path d="M29 23v17m11-17v17m11-17v17" stroke="#f3deb0" strokeWidth="3" /></>
      : kind === 'table' ? <><path d="M24 39v30m32-30v30" stroke="#8b6648" strokeWidth="6" /><ellipse cx="40" cy="34" rx="30" ry="17" fill="#cfa579" stroke="#95714f" strokeWidth="3" /><ellipse cx="40" cy="32" rx="24" ry="12" fill="none" stroke="#e9c89d" /></>
      : kind === 'sofa' ? <><rect x="14" y="19" width="52" height="36" rx="9" fill="#d1b7a0" stroke="#b29378" strokeWidth="3" /><rect x="10" y="43" width="60" height="21" rx="6" fill="#eddec7" stroke="#b29378" strokeWidth="3" /><path d="M16 41v15m48-15v15M24 67v4m32-4v4" stroke="#9d795a" strokeWidth="5" /><path d="M24 29h13v17H24Zm19 0h13v17H43Z" fill="#adbfa3" /></>
      : kind === 'bookshelf' ? <><rect x="15" y="9" width="50" height="61" rx="3" fill="#ad875d" stroke="#775b41" strokeWidth="3" /><path d="M19 36h42M19 59h42" stroke="#e3c496" strokeWidth="4" /><path d="M25 15v17m10-17v17m10-17v17m10-17v17" stroke="#8ea4a2" strokeWidth="7" /><path d="M26 43v12m11-12v12m14-12 4 12" stroke="#c78f87" strokeWidth="8" /></>
      : kind === 'tea-set' ? <><ellipse cx="40" cy="56" rx="31" ry="12" fill="#cda678" /><path d="M19 36h22v16H19Zm28 10h15v12H47Z" fill="#d6e2d6" stroke="#7e9c95" strokeWidth="3" /><path d="M41 38h8v8h-8m21 2h7v7h-7" fill="none" stroke="#7e9c95" strokeWidth="3" /><path d="M25 28q-5-7 1-13m9 13q-5-7 1-13" fill="none" stroke="#b7b69c" strokeWidth="2" /></>
      : kind === 'flowerstand' ? <><path d="M20 68V15h40v53M20 32h40M20 49h40m-30-34v48m20-48v48" fill="none" stroke="#b18d61" strokeWidth="4" /><path d="M14 57h52l-6 15H20Z" fill="#b7896f" /><path d="M26 60q-8-34 18-40m4 41q18-30-1-40" fill="none" stroke="#80a171" strokeWidth="5" />{[[24,31],[46,20],[57,40],[34,49]].map(([x,y])=><g key={`${x}-${y}`}><circle cx={x} cy={y} r="7" fill="#cd92a1" /><circle cx={x} cy={y} r="3" fill="#f1d89a" /></g>)}</>
      : kind === 'rug' ? <><ellipse cx="40" cy="45" rx="33" ry="21" fill="#c69487" stroke="#eed7a4" strokeWidth="3" /><ellipse cx="40" cy="45" rx="24" ry="14" fill="none" stroke="#efd7a8" strokeWidth="2" /><ellipse cx="40" cy="45" rx="13" ry="7" fill="none" stroke="#a7766a" /></>
      : kind === 'planter' ? <><path d="M24 47h32l-5 23H29Z" fill="#bb8e70" /><path d="M40 49V21m0 20-12-9m12 4 11-11" stroke="#82a071" strokeWidth="5" /><circle cx="40" cy="19" r="11" fill="#e4b9bd" /><circle cx="40" cy="19" r="4" fill="#e4c575" /></>
      : <><circle cx="40" cy="42" r="28" fill="#f3df9e" opacity=".35" /><path d="M29 23q0-20 11-20t11 20" fill="none" stroke="#a48258" strokeWidth="4" /><rect x="23" y="22" width="34" height="46" rx="7" fill="#eed798" stroke="#a48258" strokeWidth="4" /><path d="M40 30v30" stroke="#fff3be" strokeWidth="8" /></>}
  </svg>
}
