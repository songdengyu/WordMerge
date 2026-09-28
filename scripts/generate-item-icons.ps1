$ErrorActionPreference = 'Stop'

$itemsPath = Join-Path $PSScriptRoot '../public/config/merge/items.csv'
$svgPath = Join-Path $PSScriptRoot '../public/assets/fantasy-pack/items.svg'
$rows = Import-Csv $itemsPath
$colors = @('#91a4b7', '#69b7d1', '#8d78cf', '#d99852', '#65b879', '#d76888', '#d45d52', '#e5bd4d', '#74d5dc', '#9673df', '#ef7d43', '#b7d967', '#e85b91', '#66a5ef', '#f2d76b')

function Get-LevelMarks([int] $level) {
  $marks = for ($index = 0; $index -lt [Math]::Min(5, [Math]::Ceiling($level / 2)); $index++) {
    $x = 23 + $index * 12
    "<circle fill=`"#fff4bd`" cx=`"$x`" cy=`"78`" r=`"2.5`"/>"
  }
  return $marks -join ''
}

function Get-ItemArt([int] $chain, [int] $level, [string] $color, [string] $light) {
  $marks = Get-LevelMarks $level
  switch ($chain) {
    1 { return "<path class=`"o`" fill=`"$color`" d=`"M14 34h68v51H14z`"/><path class=`"o`" fill=`"$light`" d=`"M10 24h76v18H10z`"/><path class=`"s`" fill=`"#f4cf61`" d=`"M41 39h14v24H41z`"/><path fill=`"#fff2a6`" d=`"M48 9l4 9 10 2-8 7 2 10-8-5-8 5 2-10-8-7 10-2z`"/>$marks" }
    2 { return "<path class=`"o`" fill=`"$color`" d=`"M14 36h68v49H14z`"/><path class=`"o`" fill=`"$light`" d=`"M10 27h76v17H10z`"/><path class=`"s`" fill=`"#dffaff`" d=`"M48 8l17 18-17 25-17-25z`"/><path fill=`"#fff`" opacity=`".7`" d=`"M48 8v43M31 26h34`"/>$marks" }
    3 { return "<path class=`"o`" fill=`"$color`" d=`"M18 43h60v43H18z`"/><path class=`"o`" fill=`"$light`" d=`"M9 47L48 13l39 34z`"/><path class=`"s`" fill=`"#3a2843`" d=`"M39 59h18v27H39z`"/><path fill=`"#ffe477`" d=`"M44 67h8v9h-8z`"/><path class=`"s`" fill=`"none`" d=`"M67 17v-8m-5 3l5-3 5 3`"/>$marks" }
    4 { return "<path class=`"o`" fill=`"$color`" d=`"M57 5h27v27L42 74 20 52z`"/><path class=`"o`" fill=`"#f0c75a`" d=`"M17 43l34 34-9 10L8 53z`"/><path class=`"o`" fill=`"#71452f`" d=`"M25 70l12 12-13 12-12-12z`"/>$marks" }
    5 { return "<path class=`"o`" fill=`"$color`" d=`"M48 7l34 13v25q0 29-34 44Q14 74 14 45V20z`"/><path class=`"s`" fill=`"$light`" d=`"M48 18l23 9v18q0 19-23 31Q25 64 25 45V27z`"/><path fill=`"#fff2a6`" d=`"M48 27l5 11 12 2-9 8 3 12-11-6-11 6 3-12-9-8 12-2z`"/>$marks" }
    6 {
      $shapes = @('M48 7l35 41-35 41L13 48z', 'M48 6l38 28-15 48H25L10 34z', 'M27 9h42l22 39-22 39H27L5 48z', 'M48 5l20 16 25 7-10 24 2 27-27 1-22 13-13-24L3 51l18-19 5-26z')
      $shape = $shapes[($level - 1) % $shapes.Count]
      return "<path class=`"o`" fill=`"$color`" d=`"$shape`"/><path class=`"s`" fill=`"$light`" d=`"M48 16l20 30-20 30-20-30z`"/><path fill=`"#fff`" opacity=`".65`" d=`"M48 16v60M28 46h40`"/>$marks"
    }
    7 { return "<path class=`"o`" fill=`"$color`" d=`"M12 17q20-8 36 5v65q-16-13-36-5zM84 17q-20-8-36 5v65q16-13 36-5z`"/><path class=`"s`" fill=`"none`" d=`"M22 35h17M22 46h17M57 35h17M57 46h17`"/><path fill=`"#f4d65c`" d=`"M48 9l5 11 12 2-9 8 3 12-11-6-11 6 3-12-9-8 12-2z`"/>$marks" }
    8 {
      $horns = if ($level -ge 7) { '<path class="o" fill="#f1dc96" d="M27 32L17 7l22 21m30 4L79 7 57 28"/>' } else { '' }
      return "$horns<path class=`"o`" fill=`"$color`" d=`"M19 43Q22 17 48 17t29 26q13 10 7 29-8 20-36 20T12 72q-6-19 7-29z`"/><path class=`"s`" fill=`"$light`" d=`"M27 58q21-17 42 0-2 25-21 27-19-2-21-27z`"/><circle fill=`"#fff3a0`" cx=`"34`" cy=`"48`" r=`"6`"/><circle fill=`"#fff3a0`" cx=`"62`" cy=`"48`" r=`"6`"/><circle fill=`"#2b2035`" cx=`"35`" cy=`"49`" r=`"3`"/><circle fill=`"#2b2035`" cx=`"61`" cy=`"49`" r=`"3`"/><path fill=`"#2b2035`" d=`"M42 67h12l-6 7z`"/>$marks"
    }
  }
}

$symbols = foreach ($row in $rows) {
  $level = [int] $row.level
  $color = $colors[($level - 1) % $colors.Count]
  $light = $colors[$level % $colors.Count]
  $art = Get-ItemArt ([int] $row.chain_type) $level $color $light
  "<symbol id=`"item-$($row.item_id)`" viewBox=`"0 0 96 96`">$art</symbol>"
}

$svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs><style>.o{stroke:#25182f;stroke-width:4;stroke-linejoin:round;stroke-linecap:round}.s{stroke:#25182f;stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}</style>' + ($symbols -join '') + '</defs></svg>'
[IO.File]::WriteAllText($svgPath, $svg, [Text.UTF8Encoding]::new($false))

$lines = [IO.File]::ReadAllLines($itemsPath)
for ($index = 1; $index -lt $lines.Length; $index++) {
  $id = ($lines[$index] -split '","')[0].TrimStart('"')
  $lines[$index] = [regex]::Replace($lines[$index], ',"[^"]+\.svg","[^"]+","([^"]*)"$', ",`"items.svg`",`"item-$id`",`"`$1`"")
}
[IO.File]::WriteAllLines($itemsPath, $lines, [Text.UTF8Encoding]::new($true))
