import { existsSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { checkFeatureBoundaries } from './check-feature-boundaries.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const layerRoots = new Map([
  ['contracts', path.join(repositoryRoot, 'packages/contracts/src')],
  ['feature-core', path.join(repositoryRoot, 'packages/feature-core/src')],
  ['runtime', path.join(repositoryRoot, 'packages/desktop-runtime/src')],
  ['main', path.join(repositoryRoot, 'apps/desktop/main/src')],
  ['preload', path.join(repositoryRoot, 'apps/desktop/preload/src')],
  ['renderer', path.join(repositoryRoot, 'apps/desktop/renderer/src')],
]);
const testRoots = [
  path.join(repositoryRoot, 'packages/contracts/test'),
  path.join(repositoryRoot, 'packages/desktop-runtime/test'),
  path.join(repositoryRoot, 'apps/desktop/main/test'),
  path.join(repositoryRoot, 'apps/desktop/preload/test'),
  path.join(repositoryRoot, 'apps/desktop/renderer/test'),
  path.join(repositoryRoot, 'scripts/test'),
];
const allowedLayerDependencies = new Map([
  ['contracts', new Set()],
  ['feature-core', new Set()],
  ['runtime', new Set(['contracts', 'feature-core'])],
  ['main', new Set(['contracts', 'feature-core', 'runtime'])],
  ['preload', new Set(['contracts', 'feature-core'])],
  ['renderer', new Set(['contracts', 'feature-core'])],
]);
const sourceExtensions = new Set(['.cjs', '.css', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const codeExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const testFilePattern = /\.(?:spec|test)\.[cm]?[jt]sx?$/u;
const compiledTestArtifactPattern = /\.(?:spec|test)(?:\.d)?\.[cm]?[jt]sx?(?:\.map)?$/u;
const maxCodeLines = 1_200;
const maxUnreviewedCodeLines = 900;
const maxTestCodeLines = 1_200;
const maxUnreviewedTestCodeLines = 900;
const maxStyleLines = 1_600;
const maxDirectSourceFiles = 35;
const rendererRoot = layerRoots.get('renderer');
const rendererAppServerPath = '/v1/swe/app-server';
const productionEntrypoints = new Set([
  path.join(repositoryRoot, 'packages/contracts/src/index.ts'),
  path.join(repositoryRoot, 'packages/desktop-runtime/src/cli.ts'),
  path.join(repositoryRoot, 'packages/desktop-runtime/src/index.ts'),
  path.join(repositoryRoot, 'apps/desktop/main/src/index.ts'),
  path.join(repositoryRoot, 'apps/desktop/preload/src/index.ts'),
  path.join(repositoryRoot, 'apps/desktop/renderer/src/main.tsx'),
]);
// Existing hotspots may be reduced in place, but cannot grow without first
// extracting a responsibility and updating this deliberately reviewed budget.
const legacyHotspotLineBudgets = new Map([
  ['apps/desktop/main/src/data-root/coordinator.ts', 965],
  ['apps/desktop/renderer/src/features/chat/conversation/ChatMessageItem.tsx', 1_005],
  ['apps/desktop/renderer/src/features/settings/providers/ProviderSettings.tsx', 926],
  ['apps/desktop/renderer/src/shared/i18n/messages.ts', 1_172],
  ['packages/desktop-runtime/src/adapters/mcp/sdk-mcp-connection-manager.ts', 993],
  ['packages/desktop-runtime/src/adapters/store/sqlite-thread-store.ts', 974],
  ['packages/desktop-runtime/src/adapters/tool/pc-local/pc-local-tool-shell-policy.ts', 1_009],
  ['packages/desktop-runtime/src/adapters/tool/pc-local/pc-local-tool-shell-process.ts', 1_070],
  ['packages/desktop-runtime/src/loop/tools/tool-orchestrator-policy.ts', 939],
]);
const legacyTestHotspotLineBudgets = new Map([
  ['packages/desktop-runtime/test/support/agent-loop/shared.ts', 901],
]);

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
  if (specifier === '@setsuna-desktop/feature-core' || specifier.startsWith('@setsuna-desktop/feature-core/')) {
    return 'feature-core';
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
violations.push(...await checkFeatureBoundaries(repositoryRoot));
const productionFiles = [];
let reviewHotspotCount = 0;
for (const root of layerRoots.values()) {
  productionFiles.push(...await collectFiles(root));
}

const testCodeFiles = [];
for (const root of testRoots) {
  testCodeFiles.push(...(await collectFiles(root)).filter((filePath) => codeExtensions.has(path.extname(filePath))));
}
let testReviewHotspotCount = 0;
for (const filePath of testCodeFiles) {
  const sourceText = await readFile(filePath, 'utf8');
  const lineCount = countLines(sourceText);
  const fileName = repositoryPath(filePath);
  const reviewedBudget = legacyTestHotspotLineBudgets.get(fileName);
  if (lineCount > maxTestCodeLines) {
    violations.push(
      `${repositoryPath(filePath)}: ${lineCount} lines exceeds the ${maxTestCodeLines}-line test-module limit.`,
    );
  } else if (lineCount > maxUnreviewedTestCodeLines && reviewedBudget === undefined) {
    violations.push(
      `${repositoryPath(filePath)}: ${lineCount} lines exceeds the ${maxUnreviewedTestCodeLines}-line unreviewed test-module limit.`,
    );
  } else if (reviewedBudget !== undefined && lineCount > reviewedBudget) {
    violations.push(
      `${fileName}: ${lineCount} lines exceeds its reviewed test non-growth budget of ${reviewedBudget}.`,
    );
  }
  if (lineCount >= 700) {
    testReviewHotspotCount += 1;
  }
}

const productionCodeFiles = productionFiles.filter((filePath) => codeExtensions.has(path.extname(filePath)));
const productionCodeFileSet = new Set(productionCodeFiles);
const productionImportTargets = new Set();
for (const filePath of productionCodeFiles) {
  const sourceText = await readFile(filePath, 'utf8');
  for (const specifier of importedSpecifiers(sourceText)) {
    const target = resolveLocalModule(filePath, specifier);
    if (target && productionCodeFileSet.has(target)) productionImportTargets.add(target);
  }
}
const testImportTargets = new Set();
for (const filePath of testCodeFiles) {
  const sourceText = await readFile(filePath, 'utf8');
  for (const specifier of importedSpecifiers(sourceText)) {
    const target = resolveLocalModule(filePath, specifier);
    if (target && productionCodeFileSet.has(target)) testImportTargets.add(target);
  }
}
for (const filePath of testImportTargets) {
  if (productionImportTargets.has(filePath) || productionEntrypoints.has(filePath)) continue;
  violations.push(
    `${repositoryPath(filePath)}: source module is imported by tests but not by production; move test support under test/ or wire the module into a production entrypoint.`,
  );
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
  if (
    isWithin(filePath, rendererRoot)
    && codeExtensions.has(extension)
    && sourceText.includes(rendererAppServerPath)
  ) {
    violations.push(
      `${repositoryPath(filePath)}: renderer must use first-party runtime APIs, not the SWE app-server transport.`,
    );
  }
  const lineCount = countLines(sourceText);
  const lineLimit = extension === '.css' ? maxStyleLines : codeExtensions.has(extension) ? maxCodeLines : null;
  if (lineLimit && lineCount > lineLimit) {
    violations.push(`${repositoryPath(filePath)}: ${lineCount} lines exceeds the ${lineLimit}-line limit.`);
  } else if (codeExtensions.has(extension) && lineCount >= 700) {
    reviewHotspotCount += 1;
    const fileName = repositoryPath(filePath);
    const reviewedBudget = legacyHotspotLineBudgets.get(fileName);
    if (lineCount > maxUnreviewedCodeLines && reviewedBudget === undefined) {
      violations.push(
        `${fileName}: ${lineCount} lines exceeds the ${maxUnreviewedCodeLines}-line unreviewed-module limit.`,
      );
    } else if (reviewedBudget !== undefined && lineCount > reviewedBudget) {
      violations.push(
        `${fileName}: ${lineCount} lines exceeds its reviewed non-growth budget of ${reviewedBudget}.`,
      );
    }
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
  path.join(repositoryRoot, 'packages/feature-core/dist'),
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
    `Architecture check passed: ${productionFiles.length} production files; ${reviewHotspotCount} production and ${testReviewHotspotCount} test modules are at least 700 lines, with 900-line unreviewed-module limits.`,
  );
}
