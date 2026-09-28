export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(value.trim())
      value = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(value.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }

  row.push(value.trim())
  if (row.some(Boolean)) rows.push(row)
  if (rows.length < 2) return []

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, ''))
  return rows.slice(1).map((cells) => Object.fromEntries(
    headers.map((header, index) => [header, cells[index] ?? '']),
  ))
}
