import { existsSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const layerRoots = new Map([
  ['contracts', path.join(repositoryRoot, 'packages/contracts/src')],
  ['runtime', path.join(repositoryRoot, 'packages/desktop-runtime/src')],
  ['main', path.join(repositoryRoot, 'apps/desktop/main/src')],
  ['preload', path.join(repositoryRoot, 'apps/desktop/preload/src')],
  ['renderer', path.join(repositoryRoot, 'apps/desktop/renderer/src')],
]);
const allowedLayerDependencies = new Map([
  ['contracts', new Set()],
  ['runtime', new Set(['contracts'])],
  ['main', new Set(['contracts', 'runtime'])],
  ['preload', new Set(['contracts'])],
  ['renderer', new Set(['contracts'])],
]);
const sourceExtensions = new Set(['.cjs', '.css', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const codeExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const testFilePattern = /\.(?:spec|test)\.[cm]?[jt]sx?$/u;
const compiledTestArtifactPattern = /\.(?:spec|test)(?:\.d)?\.[cm]?[jt]sx?(?:\.map)?$/u;
const maxCodeLines = 1_200;
const maxStyleLines = 1_600;
const maxDirectSourceFiles = 35;

async function collectFiles(directory, files = []) {
  if (!existsSync(directory)) return files;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(fullPath, files);
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function repositoryPath(filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll(path.sep, '/');
}

function isWithin(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sourceLayerForPath(filePath) {
  for (const [layer, root] of layerRoots) {
    if (isWithin(filePath, root)) return layer;
  }
  return null;
}

function sourceLayerForSpecifier(specifier) {
  if (specifier === '@setsuna-desktop/contracts' || specifier.startsWith('@setsuna-desktop/contracts/')) {
    return 'contracts';
  }
  if (specifier === '@setsuna-desktop/desktop-runtime' || specifier.startsWith('@setsuna-desktop/desktop-runtime/')) {
    return 'runtime';
  }
  if (specifier === '@renderer' || specifier.startsWith('@renderer/')) return 'renderer';
  return null;
}

function importedSpecifiers(sourceText) {
  const imports = ts.preProcessFile(sourceText, true, true).importedFiles;
  return imports.map((entry) => entry.fileName);
}

function resolveLocalModule(sourceFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const unresolved = path.resolve(path.dirname(sourceFile), specifier);
  const extension = path.extname(unresolved);
  const withoutRuntimeExtension = ['.cjs', '.js', '.jsx', '.mjs'].includes(extension)
    ? unresolved.slice(0, -extension.length)
    : unresolved;
  const candidates = [
    unresolved,
    `${withoutRuntimeExtension}.ts`,
    `${withoutRuntimeExtension}.tsx`,
    `${withoutRuntimeExtension}.mts`,
    `${withoutRuntimeExtension}.cts`,
    path.join(unresolved, 'index.ts'),
    path.join(unresolved, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? unresolved;
}

function countLines(sourceText) {
  if (!sourceText) return 0;
  const lines = sourceText.split(/\r?\n/u);
  return sourceText.endsWith('\n') ? lines.length - 1 : lines.length;
}

function stronglyConnectedComponents(graph) {
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function visit(node) {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(target)));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    components.push(component);
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return components;
}

const violations = [];
const productionFiles = [];
for (const root of layerRoots.values()) {
  productionFiles.push(...await collectFiles(root));
}

const directSourceCounts = new Map();
for (const filePath of productionFiles) {
  const extension = path.extname(filePath);
  if (!sourceExtensions.has(extension)) continue;

  const basename = path.basename(filePath);
  if (testFilePattern.test(basename)) {
    violations.push(`${repositoryPath(filePath)}: tests belong in the mirrored test/ tree, not src/.`);
  }

  const directory = path.dirname(filePath);
  directSourceCounts.set(directory, (directSourceCounts.get(directory) ?? 0) + 1);
  const sourceText = await readFile(filePath, 'utf8');
  const lineCount = countLines(sourceText);
  const lineLimit = extension === '.css' ? maxStyleLines : codeExtensions.has(extension) ? maxCodeLines : null;
  if (lineLimit && lineCount > lineLimit) {
    violations.push(`${repositoryPath(filePath)}: ${lineCount} lines exceeds the ${lineLimit}-line limit.`);
  }
}

for (const [directory, count] of directSourceCounts) {
  if (count > maxDirectSourceFiles) {
    violations.push(`${repositoryPath(directory)}/: ${count} direct source files exceeds the ${maxDirectSourceFiles}-file limit.`);
  }
}

for (const [layer, root] of layerRoots) {
  for (const filePath of productionFiles.filter((candidate) => isWithin(candidate, root))) {
    if (!codeExtensions.has(path.extname(filePath))) continue;
    const sourceText = await readFile(filePath, 'utf8');
    for (const specifier of importedSpecifiers(sourceText)) {
      const localTarget = resolveLocalModule(filePath, specifier);
      const targetLayer = localTarget ? sourceLayerForPath(localTarget) : sourceLayerForSpecifier(specifier);
      if (!targetLayer || targetLayer === layer) continue;
      if (!allowedLayerDependencies.get(layer)?.has(targetLayer)) {
        violations.push(`${repositoryPath(filePath)}: ${layer} cannot import ${targetLayer} via "${specifier}".`);
      }
    }
  }
}

const contractsRoot = layerRoots.get('contracts');
const contractFiles = productionFiles.filter(
  (filePath) => isWithin(filePath, contractsRoot) && codeExtensions.has(path.extname(filePath)),
);
const contractFileSet = new Set(contractFiles);
const contractGraph = new Map(contractFiles.map((filePath) => [filePath, new Set()]));
for (const filePath of contractFiles) {
  const sourceText = await readFile(filePath, 'utf8');
  for (const specifier of importedSpecifiers(sourceText)) {
    const target = resolveLocalModule(filePath, specifier);
    if (target && contractFileSet.has(target)) contractGraph.get(filePath).add(target);
  }
}
for (const component of stronglyConnectedComponents(contractGraph)) {
  const isSelfCycle = component.length === 1 && contractGraph.get(component[0]).has(component[0]);
  if (component.length > 1 || isSelfCycle) {
    const cycle = component.map(repositoryPath).sort().join(' -> ');
    violations.push(`contracts import cycle: ${cycle}`);
  }
}

const buildRoots = [
  path.join(repositoryRoot, 'dist'),
  path.join(repositoryRoot, 'packages/contracts/dist'),
  path.join(repositoryRoot, 'packages/desktop-runtime/dist'),
];
for (const buildRoot of buildRoots) {
  for (const filePath of await collectFiles(buildRoot)) {
    if (compiledTestArtifactPattern.test(path.basename(filePath))) {
      violations.push(`${repositoryPath(filePath)}: compiled test artifact must not be shipped.`);
    }
  }
}

if (violations.length) {
  console.error(`Architecture check failed with ${violations.length} violation(s):`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture check passed: ${productionFiles.length} production files, no layer cycles, source tests, or oversized modules.`,
  );
}
