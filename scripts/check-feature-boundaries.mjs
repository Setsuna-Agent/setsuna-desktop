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
const processEntries = ['contracts', 'runtime', 'renderer', 'main', 'preload'];
const featurePackagePattern = /^@setsuna-desktop\/feature-([^/]+)(?:\/(contracts|runtime|renderer|main|preload)(?:\/[^/]+)*)?$/u;
const featureBuildScript = 'pnpm --recursive --filter "./packages/features/*" run build';

export async function checkFeatureBoundaries(repositoryRoot = defaultRepositoryRoot) {
  const violations = [];
  const featureCoreRoot = path.join(repositoryRoot, 'packages/feature-core');
  const featuresRoot = path.join(repositoryRoot, 'packages/features');
  const featureDirectories = await childDirectories(featuresRoot);
  const featurePackages = [];
  const packageNames = new Map();
  const sourceEntriesByDirectory = new Map();

  for (const directory of featureDirectories) {
    const packagePath = path.join(directory, 'package.json');
    if (!existsSync(packagePath)) {
      violations.push(`${repositoryPath(repositoryRoot, directory)}: Feature directory is missing package.json.`);
      continue;
    }
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
    const packageName = String(manifest.name ?? '');
    if (!featurePackagePattern.test(packageName)) {
      violations.push(`${repositoryPath(repositoryRoot, packagePath)}: Feature package name must use @setsuna-desktop/feature-<name>.`);
    }
    const expectedPackageName = `@setsuna-desktop/feature-${path.basename(directory)}`;
    if (packageName !== expectedPackageName) {
      violations.push(`${repositoryPath(repositoryRoot, packagePath)}: Feature package name must match its directory as "${expectedPackageName}".`);
    }
    const existingPackageDirectory = packageNames.get(packageName);
    if (existingPackageDirectory) {
      violations.push(
        `${repositoryPath(repositoryRoot, packagePath)}: Feature package name "${packageName}" is also used by ${repositoryPath(repositoryRoot, existingPackageDirectory)}.`,
      );
    } else {
      packageNames.set(packageName, directory);
    }
    featurePackages.push({ directory, manifest, packageName, packagePath });
    if (Object.hasOwn(manifest.exports ?? {}, '.')) {
      violations.push(`${repositoryPath(repositoryRoot, packagePath)}: Feature packages must not provide a root "." export.`);
    }
  }

  const identityOwners = new Map();
  for (const { packageName, directory, manifest, packagePath } of featurePackages) {
    const sourceRoot = path.join(directory, 'src');
    const sourceEntries = new Set();
    const identityDeclarations = [];
    for (const filePath of await collectFiles(sourceRoot)) {
      if (!sourceExtensions.has(path.extname(filePath))) continue;
      const relative = path.relative(sourceRoot, filePath).replaceAll(path.sep, '/');
      const entry = relative.split('/')[0];
      if (!processEntries.includes(entry)) {
        violations.push(`${repositoryPath(repositoryRoot, filePath)}: Feature source must live under an explicit process entry.`);
        continue;
      }
      sourceEntries.add(entry);
      const sourceText = await readFile(filePath, 'utf8');
      for (const declaration of featureIdentityDeclarations(filePath, sourceText)) {
        identityDeclarations.push(declaration);
        if (entry !== 'contracts') {
          violations.push(`${repositoryPath(repositoryRoot, filePath)}: Feature identity must be declared in the contracts entry.`);
        }
        if (!declaration.featureId) {
          violations.push(`${repositoryPath(repositoryRoot, filePath)}: defineFeature() identity must be a string literal.`);
        }
      }
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

    checkProcessExportSymmetry(
      repositoryRoot,
      packagePath,
      manifest.exports,
      sourceEntries,
      violations,
    );
    sourceEntriesByDirectory.set(directory, sourceEntries);
    if (identityDeclarations.length !== 1) {
      violations.push(
        `${repositoryPath(repositoryRoot, packagePath)}: Feature package must contain exactly one contracts defineFeature() identity declaration; found ${identityDeclarations.length}.`,
      );
    } else if (identityDeclarations[0].featureId) {
      const declaration = identityDeclarations[0];
      const existingOwner = identityOwners.get(declaration.featureId);
      if (existingOwner) {
        violations.push(
          `${repositoryPath(repositoryRoot, declaration.filePath)}: Feature identity "${declaration.featureId}" is already declared by ${repositoryPath(repositoryRoot, existingOwner)}.`,
        );
      } else {
        identityOwners.set(declaration.featureId, declaration.filePath);
      }
    }
  }

  await checkFeatureBuildGraph(
    repositoryRoot,
    featurePackages,
    sourceEntriesByDirectory,
    violations,
  );

  for (const filePath of await collectFiles(path.join(featureCoreRoot, 'src'))) {
    if (!sourceExtensions.has(path.extname(filePath))) continue;
    const sourceText = await readFile(filePath, 'utf8');
    for (const specifier of importedSpecifiers(sourceText)) {
      const match = featurePackagePattern.exec(specifier);
      if (match && !specifier.startsWith('@setsuna-desktop/feature-core/')) {
        violations.push(`${repositoryPath(repositoryRoot, filePath)}: feature-core cannot import concrete Feature "${specifier}".`);
      }
    }
  }

  await checkHostProcessImports(repositoryRoot, violations);
  await checkCompositionRoots(repositoryRoot, violations);
  await checkCentralFeatureImports(repositoryRoot, violations);
  return violations;
}

async function checkFeatureBuildGraph(
  repositoryRoot,
  featurePackages,
  sourceEntriesByDirectory,
  violations,
) {
  const rootPackagePath = path.join(repositoryRoot, 'package.json');
  const rootTsconfigPath = path.join(repositoryRoot, 'tsconfig.json');
  const rendererTsconfigPath = path.join(repositoryRoot, 'tsconfig.renderer.json');
  const runtimePackagePath = path.join(repositoryRoot, 'packages/desktop-runtime/package.json');
  const runtimeTsconfigPath = path.join(repositoryRoot, 'packages/desktop-runtime/tsconfig.build.json');
  if (
    !existsSync(rootPackagePath)
    || !existsSync(rootTsconfigPath)
    || !existsSync(rendererTsconfigPath)
    || !existsSync(runtimePackagePath)
    || !existsSync(runtimeTsconfigPath)
  ) return;

  const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8'));
  const rootTsconfig = JSON.parse(await readFile(rootTsconfigPath, 'utf8'));
  const rendererTsconfig = JSON.parse(await readFile(rendererTsconfigPath, 'utf8'));
  const runtimePackage = JSON.parse(await readFile(runtimePackagePath, 'utf8'));
  const runtimeTsconfig = JSON.parse(await readFile(runtimeTsconfigPath, 'utf8'));
  const rootReferences = referenceRepositoryPaths(repositoryRoot, rootTsconfigPath, rootTsconfig);
  const rendererReferences = referenceRepositoryPaths(repositoryRoot, rendererTsconfigPath, rendererTsconfig);
  const runtimeReferences = referenceRepositoryPaths(repositoryRoot, runtimeTsconfigPath, runtimeTsconfig);
  const rendererPaths = rendererTsconfig.compilerOptions?.paths ?? {};
  const knownBuildPaths = new Set(featurePackages.map(({ directory }) => (
    `${repositoryPath(repositoryRoot, directory)}/tsconfig.build.json`
  )));
  const knownPackageNames = new Set(featurePackages.map(({ packageName }) => packageName));

  if (rootPackage.scripts?.['build:features'] !== featureBuildScript) {
    violations.push(
      `${repositoryPath(repositoryRoot, rootPackagePath)}: build:features must use the workspace Feature build command "${featureBuildScript}".`,
    );
  }
  checkStaleFeatureBuildPaths(
    repositoryRoot,
    rootTsconfigPath,
    'references',
    rootReferences,
    knownBuildPaths,
    violations,
  );
  checkStaleFeatureBuildPaths(
    repositoryRoot,
    runtimeTsconfigPath,
    'runtime references',
    runtimeReferences,
    knownBuildPaths,
    violations,
  );
  checkStaleFeatureBuildPaths(
    repositoryRoot,
    rendererTsconfigPath,
    'renderer references',
    rendererReferences,
    knownBuildPaths,
    violations,
  );
  for (const alias of Object.keys(rendererPaths)) {
    const packageName = rendererAliasPackageName(alias);
    if (isConcreteFeaturePackageName(packageName) && !knownPackageNames.has(packageName)) {
      violations.push(`${repositoryPath(repositoryRoot, rendererTsconfigPath)}: stale renderer Feature alias "${alias}" has no package.`);
    }
  }
  for (const [manifestPath, dependencies] of [
    [rootPackagePath, rootPackage.dependencies],
    [runtimePackagePath, runtimePackage.dependencies],
  ]) {
    for (const packageName of Object.keys(dependencies ?? {})) {
      if (isConcreteFeaturePackageName(packageName) && !knownPackageNames.has(packageName)) {
        violations.push(`${repositoryPath(repositoryRoot, manifestPath)}: stale Feature dependency "${packageName}" has no package.`);
      }
    }
  }

  for (const { directory, manifest, packageName, packagePath } of featurePackages) {
    const relativeDirectory = repositoryPath(repositoryRoot, directory);
    const buildPath = `${relativeDirectory}/tsconfig.build.json`;
    if (!existsSync(path.join(directory, 'tsconfig.build.json'))) {
      violations.push(`${buildPath}: Feature package build config is required.`);
    }
    if (manifest.scripts?.build !== 'tsc -b tsconfig.build.json') {
      violations.push(`${repositoryPath(repositoryRoot, packagePath)}: Feature package build script must be "tsc -b tsconfig.build.json".`);
    }
    if (rootReferences.filter((entry) => entry === buildPath).length !== 1) {
      violations.push(`${repositoryPath(repositoryRoot, rootTsconfigPath)}: references must contain "./${buildPath}" exactly once.`);
    }

    const sourceEntries = sourceEntriesByDirectory.get(directory) ?? new Set();
    const rendererReferenceCount = rendererReferences.filter((entry) => entry === buildPath).length;
    const runtimeReferenceCount = runtimeReferences.filter((entry) => entry === buildPath).length;
    if (sourceEntries.has('renderer')) {
      if (rendererReferenceCount !== 1) {
        violations.push(`${repositoryPath(repositoryRoot, rendererTsconfigPath)}: renderer Feature "${packageName}" must have one build reference.`);
      }
      const alias = `${packageName}/*`;
      const expectedTarget = [`${relativeDirectory}/src/*`];
      if (JSON.stringify(rendererPaths[alias]) !== JSON.stringify(expectedTarget)) {
        violations.push(`${repositoryPath(repositoryRoot, rendererTsconfigPath)}: renderer Feature alias "${alias}" must target "${expectedTarget[0]}".`);
      }
    } else {
      if (rendererReferenceCount) {
        violations.push(`${repositoryPath(repositoryRoot, rendererTsconfigPath)}: renderer Feature "${packageName}" must not retain a build reference without a renderer source entry.`);
      }
      for (const alias of Object.keys(rendererPaths)) {
        if (rendererAliasPackageName(alias) === packageName) {
          violations.push(`${repositoryPath(repositoryRoot, rendererTsconfigPath)}: renderer Feature alias "${alias}" must not exist without a renderer source entry.`);
        }
      }
    }
    if (sourceEntries.has('runtime')) {
      if (runtimeReferenceCount !== 1) {
        violations.push(`${repositoryPath(repositoryRoot, runtimeTsconfigPath)}: runtime Feature "${packageName}" must have one build reference.`);
      }
    } else if (runtimeReferenceCount) {
      violations.push(`${repositoryPath(repositoryRoot, runtimeTsconfigPath)}: runtime Feature "${packageName}" must not retain a build reference without a runtime source entry.`);
    }

    const rootOwnsEntry = ['renderer', 'main', 'preload'].some((entry) => sourceEntries.has(entry));
    if (rootOwnsEntry && rootPackage.dependencies?.[packageName] !== 'workspace:*') {
      violations.push(`${repositoryPath(repositoryRoot, rootPackagePath)}: desktop host must depend on "${packageName}" as workspace:*.`);
    } else if (!rootOwnsEntry && rootPackage.dependencies?.[packageName] !== undefined) {
      violations.push(`${repositoryPath(repositoryRoot, rootPackagePath)}: desktop host must not depend on "${packageName}" without a renderer, main, or preload source entry.`);
    }
    if (sourceEntries.has('runtime') && runtimePackage.dependencies?.[packageName] !== 'workspace:*') {
      violations.push(`${repositoryPath(repositoryRoot, runtimePackagePath)}: runtime host must depend on "${packageName}" as workspace:*.`);
    } else if (!sourceEntries.has('runtime') && runtimePackage.dependencies?.[packageName] !== undefined) {
      violations.push(`${repositoryPath(repositoryRoot, runtimePackagePath)}: runtime host must not depend on "${packageName}" without a runtime source entry.`);
    }

    if (!packageName) {
      violations.push(`${repositoryPath(repositoryRoot, packagePath)}: Feature package name is required for build graph validation.`);
    }
  }
}

function checkStaleFeatureBuildPaths(
  repositoryRoot,
  filePath,
  field,
  entries,
  knownBuildPaths,
  violations,
) {
  for (const entry of new Set(entries)) {
    if (!/^packages\/features\/[^/]+\/tsconfig\.build\.json$/u.test(entry)) continue;
    if (!knownBuildPaths.has(entry)) {
      violations.push(`${repositoryPath(repositoryRoot, filePath)}: stale ${field} entry "${entry}" has no Feature package.`);
    }
  }
}

function isConcreteFeaturePackageName(packageName) {
  return packageName.startsWith('@setsuna-desktop/feature-')
    && packageName !== '@setsuna-desktop/feature-core';
}

function rendererAliasPackageName(alias) {
  return alias.endsWith('/*') ? alias.slice(0, -2) : alias;
}

function referenceRepositoryPaths(repositoryRoot, tsconfigPath, tsconfig) {
  return (tsconfig.references ?? [])
    .map((reference) => repositoryPath(
      repositoryRoot,
      path.resolve(path.dirname(tsconfigPath), String(reference?.path ?? '')),
    ));
}

function checkProcessExportSymmetry(
  repositoryRoot,
  packagePath,
  exportsField,
  sourceEntries,
  violations,
) {
  const packageExports = exportsField && typeof exportsField === 'object' ? exportsField : {};
  for (const entry of processEntries) {
    const hasSource = sourceEntries.has(entry);
    const hasExport = Object.hasOwn(packageExports, `./${entry}`);
    if (hasSource && !hasExport) {
      violations.push(
        `${repositoryPath(repositoryRoot, packagePath)}: Feature source entry "${entry}" must have a matching "./${entry}" package export.`,
      );
    }
    if (hasExport && !hasSource) {
      violations.push(
        `${repositoryPath(repositoryRoot, packagePath)}: Feature export "./${entry}" has no matching source entry.`,
      );
    }
  }
}

function checkProcessImport(repositoryRoot, filePath, entry, specifier, violations) {
  const fail = (message) => violations.push(`${repositoryPath(repositoryRoot, filePath)}: ${message}`);
  if (entry === 'contracts') {
    if (nodeBuiltins.has(specifier) || specifier === 'electron' || specifier === 'react' || specifier.startsWith('react/')) {
      fail(`contracts entry cannot import process library "${specifier}".`);
    }
    if (/\/(runtime|renderer|main|preload)(?:\/|$)/u.test(specifier)) {
      fail(`contracts entry cannot import process implementation "${specifier}".`);
    }
  }
  if (entry === 'runtime') {
    if (specifier === 'react' || specifier.startsWith('react/') || specifier === 'electron') {
      fail(`runtime entry cannot import "${specifier}".`);
    }
    if (/\/(renderer|main|preload)(?:\/|$)/u.test(specifier)) {
      fail(`runtime entry cannot import process implementation "${specifier}".`);
    }
  }
  if (entry === 'renderer') {
    if (nodeBuiltins.has(specifier) || specifier === 'electron') {
      fail(`renderer entry cannot import Node/Electron module "${specifier}".`);
    }
    if (/\/(runtime|main|preload)(?:\/|$)/u.test(specifier)) {
      fail(`renderer entry cannot import process implementation "${specifier}".`);
    }
  }
  if (entry === 'preload') {
    if (specifier === 'react' || specifier.startsWith('react/') || /\/(runtime|renderer|main)(?:\/|$)/u.test(specifier)) {
      fail(`preload entry cannot import "${specifier}".`);
    }
  }
}

async function checkHostProcessImports(repositoryRoot, violations) {
  const roots = [
    ['runtime', path.join(repositoryRoot, 'packages/desktop-runtime/src')],
    ['renderer', path.join(repositoryRoot, 'apps/desktop/renderer/src')],
    ['main', path.join(repositoryRoot, 'apps/desktop/main/src')],
    ['preload', path.join(repositoryRoot, 'apps/desktop/preload/src')],
  ];
  for (const [processName, root] of roots) {
    for (const filePath of await collectFiles(root)) {
      if (!sourceExtensions.has(path.extname(filePath))) continue;
      const sourceText = await readFile(filePath, 'utf8');
      for (const specifier of importedSpecifiers(sourceText)) {
        const match = featurePackagePattern.exec(specifier);
        if (!match || specifier.startsWith('@setsuna-desktop/feature-core/')) continue;
        const entry = match[2];
        const relativeHostPath = path.relative(root, filePath).replaceAll(path.sep, '/');
        if (entry !== 'contracts' && !relativeHostPath.startsWith('composition/')) {
          violations.push(
            `${repositoryPath(repositoryRoot, filePath)}: concrete Feature implementation import "${specifier}" must be isolated under the ${processName} composition directory.`,
          );
        }
        if (processName === 'runtime' && ['renderer', 'main', 'preload'].includes(entry)) {
          violations.push(`${repositoryPath(repositoryRoot, filePath)}: runtime host cannot import "${specifier}".`);
        }
        if (processName === 'renderer' && ['runtime', 'main', 'preload'].includes(entry)) {
          violations.push(`${repositoryPath(repositoryRoot, filePath)}: renderer host cannot import "${specifier}".`);
        }
        if (processName === 'main' && ['runtime', 'renderer', 'preload'].includes(entry)) {
          violations.push(`${repositoryPath(repositoryRoot, filePath)}: main host cannot import "${specifier}".`);
        }
        if (processName === 'preload' && ['runtime', 'renderer', 'main'].includes(entry)) {
          violations.push(`${repositoryPath(repositoryRoot, filePath)}: preload host cannot import "${specifier}".`);
        }
      }
    }
  }
}

async function checkCompositionRoots(repositoryRoot, violations) {
  const roots = [
    {
      processName: 'runtime',
      root: path.join(repositoryRoot, 'packages/desktop-runtime/src'),
      moduleName: '@setsuna-desktop/feature-core/runtime',
      factoryName: 'defineRuntimeFeatureHost',
    },
    {
      processName: 'renderer',
      root: path.join(repositoryRoot, 'apps/desktop/renderer/src'),
      moduleName: '@setsuna-desktop/feature-core/renderer',
      factoryName: 'defineRendererFeatureHost',
    },
    {
      processName: 'main',
      root: path.join(repositoryRoot, 'apps/desktop/main/src'),
      moduleName: '@setsuna-desktop/feature-core/main',
      factoryName: 'defineMainFeatureHost',
    },
    {
      processName: 'preload',
      root: path.join(repositoryRoot, 'apps/desktop/preload/src'),
      moduleName: '@setsuna-desktop/feature-core/preload',
      factoryName: 'definePreloadFeatureHost',
    },
  ];
  for (const root of roots) {
    const declarations = [];
    for (const filePath of await collectFiles(root.root)) {
      if (!sourceExtensions.has(path.extname(filePath))) continue;
      const sourceText = await readFile(filePath, 'utf8');
      const callCount = countImportedBindingCalls(filePath, sourceText, root.moduleName, root.factoryName);
      for (let index = 0; index < callCount; index += 1) {
        declarations.push(filePath);
      }
    }
    if (declarations.length !== 1) {
      const locations = declarations.length
        ? ` Found: ${declarations.map((filePath) => repositoryPath(repositoryRoot, filePath)).join(', ')}.`
        : '';
      violations.push(
        `${repositoryPath(repositoryRoot, root.root)}: ${root.processName} host must contain exactly one ${root.factoryName}() composition root; found ${declarations.length}.${locations}`,
      );
    }
  }
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

async function checkCentralFeatureImports(repositoryRoot, violations) {
  const directories = [
    'apps/desktop/renderer/src/services/runtime-client',
    'apps/desktop/renderer/src/features/settings',
    'apps/desktop/renderer/src/features/capabilities',
    'apps/desktop/renderer/src/features/chat/tool-runs',
  ];
  for (const relativeDirectory of directories) {
    const directory = path.join(repositoryRoot, ...relativeDirectory.split('/'));
    for (const filePath of await collectFiles(directory)) {
      if (!sourceExtensions.has(path.extname(filePath))) continue;
      const sourceText = await readFile(filePath, 'utf8');
      for (const specifier of importedSpecifiers(sourceText)) {
        const match = featurePackagePattern.exec(specifier);
        if (!match || specifier.startsWith('@setsuna-desktop/feature-core/')) continue;
        violations.push(
          `${repositoryPath(repositoryRoot, filePath)}: central host code cannot import concrete Feature "${specifier}"; register it in the renderer composition root instead.`,
        );
      }
    }
  }
}

function importedSpecifiers(sourceText) {
  return ts.preProcessFile(sourceText, true, true).importedFiles.map((entry) => entry.fileName);
}

function featureIdentityDeclarations(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const localNames = importedBindingNames(
    sourceFile,
    '@setsuna-desktop/feature-core/definition',
    'defineFeature',
  );
  const declarations = [];
  visitImportedCalls(sourceFile, localNames, (call) => {
    const argument = call.arguments[0];
    declarations.push({
      featureId: argument && ts.isStringLiteralLike(argument) ? argument.text : null,
      filePath,
    });
  });
  return declarations;
}

function countImportedBindingCalls(filePath, sourceText, moduleName, exportedName) {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const localNames = importedBindingNames(sourceFile, moduleName, exportedName);
  let calls = 0;
  visitImportedCalls(sourceFile, localNames, () => {
    calls += 1;
  });
  return calls;
}

function importedBindingNames(sourceFile, moduleName, exportedName) {
  const localNames = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== moduleName
    ) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === exportedName) {
        localNames.add(element.name.text);
      }
    }
  }
  return localNames;
}

function visitImportedCalls(sourceFile, localNames, onCall) {
  if (!localNames.size) return;
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && localNames.has(node.expression.text)
    ) onCall(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
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
