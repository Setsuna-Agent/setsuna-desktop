import { builtinModules } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const defaultRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const featurePackagePattern = /^@setsuna-desktop\/feature-([^/]+)(?:\/(contracts|runtime|renderer|main|preload))?$/u;
const featureIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export async function checkFeatureBoundaries(repositoryRoot = defaultRepositoryRoot) {
  const violations = [];
  const featureCoreRoot = path.join(repositoryRoot, 'packages/feature-core');
  const featuresRoot = path.join(repositoryRoot, 'packages/features');
  const reserved = await readReservedManifest(featureCoreRoot, violations);
  const featureDirectories = await childDirectories(featuresRoot);
  const featurePackages = new Map();
  const featureIdsByDirectory = new Map();

  for (const directory of featureDirectories) {
    const packagePath = path.join(directory, 'package.json');
    if (!existsSync(packagePath)) {
      violations.push(`${repositoryPath(repositoryRoot, directory)}: Feature directory is missing package.json.`);
      continue;
    }
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
    const packageName = String(manifest.name ?? '');
    featurePackages.set(packageName, directory);
    if (Object.hasOwn(manifest.exports ?? {}, '.')) {
      violations.push(`${repositoryPath(repositoryRoot, packagePath)}: Feature packages must not provide a root "." export.`);
    }
    const metadata = manifest.setsunaFeature;
    const featureId = typeof metadata?.id === 'string' && featureIdPattern.test(metadata.id)
      ? metadata.id
      : null;
    featureIdsByDirectory.set(directory, featureId);
    if (!metadata || typeof metadata.id !== 'string' || !featureIdPattern.test(metadata.id)) {
      violations.push(`${repositoryPath(repositoryRoot, packagePath)}: setsunaFeature.id must be a stable lowercase kebab FeatureId.`);
    } else if (!reserved.features.has(metadata.id)) {
      violations.push(`${repositoryPath(repositoryRoot, packagePath)}: FeatureId "${metadata.id}" is missing from reserved-identifiers.json.`);
    }
    await checkGeneratedVersion(repositoryRoot, directory, manifest, violations);
  }

  for (const [packageName, directory] of featurePackages) {
    const featureId = featureIdsByDirectory.get(directory) ?? null;
    const sourceRoot = path.join(directory, 'src');
    for (const filePath of await collectFiles(sourceRoot)) {
      if (!sourceExtensions.has(path.extname(filePath))) continue;
      const relative = path.relative(sourceRoot, filePath).replaceAll(path.sep, '/');
      const entry = relative.split('/')[0];
      if (!['contracts', 'runtime', 'renderer', 'main', 'preload', 'generated'].includes(entry)) {
        violations.push(`${repositoryPath(repositoryRoot, filePath)}: Feature source must live under an explicit process entry.`);
        continue;
      }
      const sourceText = await readFile(filePath, 'utf8');
      checkReservedDeclarations(
        repositoryRoot,
        filePath,
        sourceText,
        featureId,
        reserved,
        violations,
      );
      if (entry === 'renderer') checkRendererTransportBoundary(repositoryRoot, filePath, sourceText, violations);
      if ((entry === 'runtime' || entry === 'renderer' || entry === 'main') && /FeatureModule\s*</u.test(sourceText)) {
        violations.push(`${repositoryPath(repositoryRoot, filePath)}: heterogeneous Feature modules must use the erased module type returned by define*Feature().`);
      }
      for (const specifier of importedSpecifiers(sourceText)) {
        checkProcessImport(repositoryRoot, filePath, entry, specifier, violations);
        const featureImport = featurePackagePattern.exec(specifier);
        if (!featureImport || specifier.startsWith('@setsuna-desktop/feature-core/')) continue;
        const importedPackage = `@setsuna-desktop/feature-${featureImport[1]}`;
        const importedEntry = featureImport[2];
        if (importedPackage !== packageName && importedEntry !== 'contracts') {
          violations.push(`${repositoryPath(repositoryRoot, filePath)}: Features may import another Feature only through its /contracts entry, not "${specifier}".`);
        }
        if (!importedEntry) {
          violations.push(`${repositoryPath(repositoryRoot, filePath)}: Feature package root import "${specifier}" is forbidden.`);
        }
      }
    }
  }

  for (const filePath of await collectFiles(path.join(featureCoreRoot, 'src'))) {
    if (!sourceExtensions.has(path.extname(filePath))) continue;
    const sourceText = await readFile(filePath, 'utf8');
    checkReservedDeclarations(repositoryRoot, filePath, sourceText, null, reserved, violations);
    for (const specifier of importedSpecifiers(sourceText)) {
      const match = featurePackagePattern.exec(specifier);
      if (match && !specifier.startsWith('@setsuna-desktop/feature-core/')) {
        violations.push(`${repositoryPath(repositoryRoot, filePath)}: feature-core cannot import concrete Feature "${specifier}".`);
      }
    }
  }

  await checkHostProcessImports(repositoryRoot, violations);
  await checkFrozenCentralSurfaces(repositoryRoot, reserved.features, violations);
  return violations;
}

async function readReservedManifest(featureCoreRoot, violations) {
  const filePath = path.join(featureCoreRoot, 'reserved-identifiers.json');
  if (!existsSync(filePath)) {
    violations.push('packages/feature-core/reserved-identifiers.json: stable identifier manifest is required.');
    return { features: new Set() };
  }
  const manifest = JSON.parse(await readFile(filePath, 'utf8'));
  if (manifest.schemaVersion !== 1) {
    violations.push('packages/feature-core/reserved-identifiers.json: unsupported schemaVersion.');
  }
  const categories = ['features', 'capabilities', 'settingsDocuments', 'featureEvents', 'toolResults', 'operations'];
  const reserved = {};
  for (const category of categories) {
    if (!Array.isArray(manifest[category]) || manifest[category].some((value) => typeof value !== 'string')) {
      violations.push(`packages/feature-core/reserved-identifiers.json: ${category} must be a string array.`);
    } else if (new Set(manifest[category]).size !== manifest[category].length) {
      violations.push(`packages/feature-core/reserved-identifiers.json: ${category} contains duplicate identities.`);
    }
    reserved[category] = new Set(Array.isArray(manifest[category]) ? manifest[category] : []);
  }
  return reserved;
}

async function checkGeneratedVersion(repositoryRoot, directory, manifest, violations) {
  const versionFile = path.join(directory, 'src/generated/package-version.ts');
  if (!existsSync(versionFile)) {
    violations.push(`${repositoryPath(repositoryRoot, versionFile)}: generated package version constant is required.`);
    return;
  }
  const sourceText = await readFile(versionFile, 'utf8');
  const expected = `export const FEATURE_PACKAGE_VERSION = ${JSON.stringify(manifest.version)} as const;`;
  if (sourceText.trim() !== expected) {
    violations.push(`${repositoryPath(repositoryRoot, versionFile)}: generated version must equal package.json version ${manifest.version}.`);
  }
}

function checkProcessImport(repositoryRoot, filePath, entry, specifier, violations) {
  const fail = (message) => violations.push(`${repositoryPath(repositoryRoot, filePath)}: ${message}`);
  if (entry === 'contracts') {
    if (nodeBuiltins.has(specifier) || specifier === 'electron' || specifier === 'react' || specifier.startsWith('react/')) {
      fail(`contracts entry cannot import process library "${specifier}".`);
    }
    if (/\/(runtime|renderer|main|preload)$/u.test(specifier)) {
      fail(`contracts entry cannot import process implementation "${specifier}".`);
    }
  }
  if (entry === 'runtime') {
    if (specifier === 'react' || specifier.startsWith('react/') || specifier === 'electron') {
      fail(`runtime entry cannot import "${specifier}".`);
    }
    if (/\/(renderer|main|preload)$/u.test(specifier)) {
      fail(`runtime entry cannot import process implementation "${specifier}".`);
    }
  }
  if (entry === 'renderer') {
    if (nodeBuiltins.has(specifier) || specifier === 'electron') {
      fail(`renderer entry cannot import Node/Electron module "${specifier}".`);
    }
    if (/\/(runtime|main|preload)$/u.test(specifier)) {
      fail(`renderer entry cannot import process implementation "${specifier}".`);
    }
  }
  if (entry === 'preload') {
    if (specifier === 'react' || specifier.startsWith('react/') || /\/(runtime|renderer|main)$/u.test(specifier)) {
      fail(`preload entry cannot import "${specifier}".`);
    }
  }
}

async function checkHostProcessImports(repositoryRoot, violations) {
  const roots = [
    ['runtime', path.join(repositoryRoot, 'packages/desktop-runtime/src')],
    ['renderer', path.join(repositoryRoot, 'apps/desktop/renderer/src')],
  ];
  for (const [processName, root] of roots) {
    for (const filePath of await collectFiles(root)) {
      if (!sourceExtensions.has(path.extname(filePath))) continue;
      const sourceText = await readFile(filePath, 'utf8');
      for (const specifier of importedSpecifiers(sourceText)) {
        const match = featurePackagePattern.exec(specifier);
        if (!match || specifier.startsWith('@setsuna-desktop/feature-core/')) continue;
        const entry = match[2];
        if (processName === 'runtime' && ['renderer', 'main', 'preload'].includes(entry)) {
          violations.push(`${repositoryPath(repositoryRoot, filePath)}: runtime host cannot import "${specifier}".`);
        }
        if (processName === 'renderer' && ['runtime', 'main', 'preload'].includes(entry)) {
          violations.push(`${repositoryPath(repositoryRoot, filePath)}: renderer host cannot import "${specifier}".`);
        }
      }
    }
  }
}

function checkReservedDeclarations(
  repositoryRoot,
  filePath,
  sourceText,
  featureId,
  reserved,
  violations,
) {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const reportMissing = (category, identity, node) => {
    if (reserved[category]?.has(identity)) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    violations.push(
      `${repositoryPath(repositoryRoot, filePath)}:${line}: published ${category} identity "${identity}" is missing from reserved-identifiers.json.`,
    );
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      const input = node.arguments[0];
      if (input && ts.isObjectLiteralExpression(input)) {
        if (name === 'defineCapability') {
          const id = stringProperty(input, 'id');
          const major = numberProperty(input, 'major');
          if (id && major !== null) reportMissing('capabilities', `${id}@${major}`, node);
        } else if (name === 'defineFeatureOperation') {
          const id = stringProperty(input, 'id');
          if (id) reportMissing('operations', id, node);
        } else if (name === 'defineFeatureEventContract' && featureId) {
          const eventType = stringProperty(input, 'eventType');
          const version = numberProperty(input, 'currentVersion');
          if (eventType && version !== null) {
            reportMissing('featureEvents', `${featureId}/${eventType}@${version}`, node);
          }
        } else if (name === 'defineFeatureSettingsBundle' && featureId) {
          const documents = objectProperty(input, 'documents');
          if (documents) {
            for (const property of documents.properties) {
              const documentId = propertyNameText(property.name);
              if (documentId) reportMissing('settingsDocuments', `${featureId}/${documentId}`, property);
            }
          }
        }
      }
    }
    if (featureId && ts.isObjectLiteralExpression(node)) {
      const resultKind = stringProperty(node, 'resultKind');
      const major = numberProperty(node, 'major');
      if (resultKind && major !== null) {
        reportMissing('toolResults', `${resultKind}@${major}`, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function checkRendererTransportBoundary(repositoryRoot, filePath, sourceText, violations) {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  let reportedFetch = false;
  let reportedDesktop = false;
  const visit = (node) => {
    if (
      !reportedFetch
      && ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'fetch'
    ) {
      reportedFetch = true;
      violations.push(`${repositoryPath(repositoryRoot, filePath)}: renderer Feature must use its injected typed transport instead of raw fetch().`);
    }
    if (
      !reportedDesktop
      && ts.isPropertyAccessExpression(node)
      && node.name.text === 'setsunaDesktop'
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'window'
    ) {
      reportedDesktop = true;
      violations.push(`${repositoryPath(repositoryRoot, filePath)}: renderer Feature cannot access window.setsunaDesktop directly.`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

async function checkFrozenCentralSurfaces(repositoryRoot, featureIds, violations) {
  const files = [
    'packages/contracts/src/config.ts',
    'packages/contracts/src/http.ts',
    'apps/desktop/renderer/src/services/runtime-client/client.ts',
    'apps/desktop/renderer/src/services/runtime-client/useRuntimeConfigState.ts',
    'apps/desktop/renderer/src/features/settings/SettingsPage.tsx',
    'apps/desktop/renderer/src/features/capabilities/CapabilitiesPage.tsx',
    'apps/desktop/renderer/src/features/chat/tool-runs/RuntimeToolRuns.tsx',
  ];
  for (const relativePath of files) {
    const filePath = path.join(repositoryRoot, ...relativePath.split('/'));
    if (!existsSync(filePath)) continue;
    const sourceText = await readFile(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    let match = null;
    const visit = (node) => {
      if (match) return;
      if (
        (ts.isIdentifier(node) || ts.isStringLiteralLike(node))
        && (match = referencedFeature(node.text, featureIds))
      ) return;
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (match) {
      violations.push(
        `${relativePath}: migrated Feature "${match}" cannot re-enter this frozen central surface; use its Feature package and composition contribution.`,
      );
    }
  }
}

function referencedFeature(value, featureIds) {
  const lower = value.toLowerCase();
  const segments = lower.split(/[^a-z0-9]+/gu).filter(Boolean);
  for (const featureId of featureIds) {
    const featureLower = featureId.toLowerCase();
    const featureCompact = featureLower.replaceAll('-', '');
    if (
      (featureLower.includes('-') && lower.includes(featureLower))
      || segments.some((segment) => segment.startsWith(featureCompact))
    ) return featureId;
  }
  return null;
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function objectProperty(object, name) {
  const property = object.properties.find((candidate) => propertyNameText(candidate.name) === name);
  return property && ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)
    ? property.initializer
    : null;
}

function stringProperty(object, name) {
  const property = object.properties.find((candidate) => propertyNameText(candidate.name) === name);
  return property && ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)
    ? property.initializer.text
    : null;
}

function numberProperty(object, name) {
  const property = object.properties.find((candidate) => propertyNameText(candidate.name) === name);
  if (!property || !ts.isPropertyAssignment(property) || !ts.isNumericLiteral(property.initializer)) return null;
  const value = Number(property.initializer.text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function propertyNameText(name) {
  if (!name) return null;
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : null;
}

function importedSpecifiers(sourceText) {
  return ts.preProcessFile(sourceText, true, true).importedFiles.map((entry) => entry.fileName);
}

async function childDirectories(directory) {
  if (!existsSync(directory)) return [];
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name));
}

async function collectFiles(directory, files = []) {
  if (!existsSync(directory)) return files;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(fullPath, files);
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function repositoryPath(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll(path.sep, '/');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const violations = await checkFeatureBoundaries();
  if (violations.length) {
    console.error(`Feature boundary check failed with ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log('Feature boundary check passed.');
  }
}
