// Auto-increment the build tag (bN → bN+1) before a validation run so the
// on-screen dev badge always reflects the latest build without a manual edit.
import { readFileSync, writeFileSync } from 'node:fs'

const path = new URL('../src/buildTag.ts', import.meta.url)
const src = readFileSync(path, 'utf8')

const match = src.match(/BUILD_TAG = 'b(\d+)'/)
if (!match) {
  console.error("bumpBuild: couldn't find BUILD_TAG in src/buildTag.ts")
  process.exit(1)
}

const next = `b${Number(match[1]) + 1}`
writeFileSync(path, src.replace(/BUILD_TAG = 'b\d+'/, `BUILD_TAG = '${next}'`))
console.log(`build tag → ${next}`)
