interface ArtIconProps {
  sheet: 'ui' | 'heroes' | 'monsters' | 'weapons' | 'items' | 'survival'
  name: string
  viewBox?: string
  className?: string
}

export type ArtSheet = ArtIconProps['sheet']

export function ArtIcon({ sheet, name, viewBox = '0 0 64 64', className }: ArtIconProps) {
  return (
    <svg viewBox={viewBox} className={className} aria-hidden>
      <use href={`${import.meta.env.BASE_URL}assets/${sheet === 'survival' ? 'survival/items' : `fantasy-pack/${sheet}`}.svg#${name}`} />
    </svg>
  )
}
