import { readFile } from 'node:fs/promises'

const dependencyName = '@codycodeagent/cody-web-core'
const consumers = [
  '../apps/workbench-server/package.json',
  '../apps/workbench-web/package.json',
]

const expectedVersions = new Set()
for (const consumer of consumers) {
  const packageJson = JSON.parse(await readFile(new URL(consumer, import.meta.url), 'utf8'))
  const dependencySpec = packageJson.dependencies?.[dependencyName]
  const expectedVersion = dependencySpec?.match(/#v(\d+\.\d+\.\d+)$/)?.[1]
  if (!expectedVersion) {
    throw new Error(`${consumer} must use an immutable vX.Y.Z tag for ${dependencyName}`)
  }
  expectedVersions.add(expectedVersion)
}

if (expectedVersions.size !== 1) {
  throw new Error(`${dependencyName} consumers disagree: ${[...expectedVersions].join(', ')}`)
}

const expectedVersion = [...expectedVersions][0]
const installedPackageJson = JSON.parse(
  await readFile(
    new URL('../apps/workbench-server/node_modules/@codycodeagent/cody-web-core/package.json', import.meta.url),
    'utf8',
  ),
)
if (installedPackageJson.version !== expectedVersion) {
  throw new Error(
    `${dependencyName} runtime mismatch: manifests require ${expectedVersion}, `
      + `but node_modules contains ${installedPackageJson.version}. Regenerate the lockfile and reinstall.`,
  )
}

console.log(`${dependencyName} runtime verified: ${installedPackageJson.version}`)
