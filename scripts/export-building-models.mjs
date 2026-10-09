import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/game/buildingConfig.ts')
  const { buildingModel, completeModelBuilding, modelToObj } = await server.ssrLoadModule('/src/scene/buildingModel.ts')
  const output = 'public/assets/survival/models'
  await mkdir(output, { recursive: true })
  const colors = new Set()
  for (const blueprint of BLUEPRINTS) {
    const mesh = buildingModel(completeModelBuilding(blueprint), blueprint)
    mesh.forEach(face => colors.add(face.color))
    await writeFile(`${output}/${blueprint.id}.obj`, modelToObj(mesh), 'utf8')
  }
  await writeFile(`${output}/materials.mtl`, [...colors].map(color => `newmtl c_${color.toString(16)}\nKd ${[16, 8, 0].map(shift => ((color >> shift) & 255) / 255).join(' ')}\nd 1\nillum 1\n`).join('\n'))
  console.log(`Exported ${BLUEPRINTS.length} building models to ${output}`)
} finally { await server.close() }
