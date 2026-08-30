# Feature 从 0 到 1

本文说明如何新增一个内置纵向 Feature。它适用于 `packages/features/*` 中随应用静态发布的业务 owner；外部可安装能力应走 Plugin，而不是套用 FeatureHost。

示例创建一个最小但完整的 `word-count` Feature：renderer 提交文本，runtime 返回字符数和按空白分隔的词数。它只需要 `contracts + runtime + renderer`，不创建无行为的 main/preload 占位入口。

## 先判断它是否应该是 Feature

开始写代码前先回答三件事：

1. 它是否有一个清晰的业务 owner，并且未来可以整体删除？
2. 它是否拥有自己的 operation、settings、私有事件、工具结果或视图，而不是多个无关业务共同使用的 primitive？
3. 删除它时，Core thread/turn/security/UI 语义是否仍然完整？

如果答案是否定的，应把能力放在 Core 或现有 Feature 中。Feature 不是为了把目录切得更细，也不是插件安装机制。

只创建真实参与的进程入口：

| 需要的行为 | 创建入口 |
| --- | --- |
| DTO、operation、settings、event、Capability identity | `contracts` |
| 本地业务逻辑、route、projection、service | `runtime` |
| typed client、controller、view、messages | `renderer` |
| Electron/OS 能力或原生资源 | `main` |
| 固定且类型化的 renderer bridge | `preload` |

## 目标目录

```text
packages/features/word-count/
  package.json
  tsconfig.build.json
  src/
    contracts/
      definition.ts
      operations.ts
      index.ts
    runtime/
      feature.ts
      index.ts
    renderer/
      client.ts
      feature.tsx
      messages.ts
      WordCountView.tsx
      index.ts
  test/
    contracts/
    runtime/
    renderer/
```

测试只创建本次风险真正需要的文件；不要为了镜像每个生产文件而制造空测试。

## 第一步：创建 package

`package.json` 只导出真实入口，不能提供 `.` root export：

```json
{
  "name": "@setsuna-desktop/feature-word-count",
  "version": "0.1.0",
  "description": "Word count Feature for Setsuna Desktop.",
  "license": "MIT",
  "type": "module",
  "exports": {
    "./contracts": {
      "types": "./dist/contracts/index.d.ts",
      "default": "./dist/contracts/index.js"
    },
    "./runtime": {
      "types": "./dist/runtime/index.d.ts",
      "default": "./dist/runtime/index.js"
    },
    "./renderer": {
      "types": "./dist/renderer/index.d.ts",
      "default": "./dist/renderer/index.js"
    }
  },
  "dependencies": {
    "@setsuna-desktop/feature-core": "workspace:*",
    "@setsuna-desktop/renderer-contracts": "workspace:*",
    "react": "^18.3.1"
  },
  "scripts": {
    "build": "tsc -b tsconfig.build.json",
    "typecheck": "tsc -b --pretty false"
  }
}
```

`tsconfig.build.json` 可以从相同进程组合的 Feature 复制，然后只保留实际依赖：

```json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "types": ["node", "react"],
    "jsx": "react-jsx",
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "references": [
    { "path": "../../feature-core/tsconfig.build.json" },
    { "path": "../../renderer-contracts/tsconfig.build.json" }
  ]
}
```

`pnpm-workspace.yaml` 已覆盖 `packages/features/*`，不需要再维护 Feature 列表。

## 第二步：先写 contracts

Feature identity 只声明一次，放在 `src/contracts/definition.ts`：

```ts
import { defineFeature } from '@setsuna-desktop/feature-core/definition';

export const wordCountFeature = defineFeature('word-count');
```

在 `src/contracts/operations.ts` 定义完整的输入、输出和传输 codec：

```ts
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';

export type WordCountInput = Readonly<{ text: string }>;
export type WordCountResult = Readonly<{
  characters: number;
  words: number;
}>;

const inputCodec = defineRuntimeCodec<WordCountInput>((value) => {
  const record = objectRecord(value, 'Word count input must be an object.');
  if (typeof record.text !== 'string' || record.text.length > 100_000) {
    throw new Error('Word count text must be a string no longer than 100000 characters.');
  }
  return Object.freeze({ text: record.text });
});

const resultCodec = defineRuntimeCodec<WordCountResult>((value) => {
  const record = objectRecord(value, 'Word count result must be an object.');
  return Object.freeze({
    characters: nonNegativeInteger(record.characters, 'characters'),
    words: nonNegativeInteger(record.words, 'words'),
  });
});

export const analyzeWordCount = defineFeatureOperation({
  id: 'word-count.text.analyze',
  method: 'POST',
  path: '/v1/features/word-count/analyze',
  input: inputCodec,
  output: resultCodec,
  errors: Object.freeze({}),
  idempotency: 'idempotent',
});

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Word count ${label} must be a non-negative integer.`);
  }
  return value as number;
}
```

`src/contracts/index.ts` 只导出稳定的公共面：

```ts
export { wordCountFeature } from './definition.js';
export { analyzeWordCount } from './operations.js';
export type { WordCountInput, WordCountResult } from './operations.js';
```

此时不要定义未来可能需要的 settings、event 或 Capability。等出现真实消费者再增加。

## 第三步：实现 runtime

`src/runtime/feature.ts` 依赖宿主提供的窄 route registrar。注册的 handler 自动经过 codec、FeatureScope gate、取消和统一错误映射：

```ts
import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  analyzeWordCount,
  wordCountFeature,
} from '../contracts/index.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
});

export const wordCountRuntimeFeature = defineRuntimeFeature({
  definition: wordCountFeature,
  dependencies,
  setup(context) {
    context.dependencies.routes.register(
      context.scope,
      analyzeWordCount,
      ({ text }) => {
        const normalized = text.trim();
        return Object.freeze({
          characters: Array.from(text).length,
          words: normalized ? normalized.split(/\s+/u).length : 0,
        });
      },
    );
  },
});
```

`src/runtime/index.ts`：

```ts
export { wordCountRuntimeFeature } from './feature.js';
```

不要同时修改通用 REST router。`RuntimeRouteRegistry` 已经是所有 Feature operation 的唯一接缝。

如果 setup 创建订阅、子进程、监听器或可释放 service，立即交给 scope：

```ts
context.scope.add(unsubscribe);
const service = context.scope.track(createService(), (value) => value.dispose());

await context.scope.runOperation(
  (signal) => service.run(input, signal),
  { signal: callerSignal },
);
```

setup 外的宿主 binding 不属于 scope，必须返回幂等 disposer，并由 composition root 通过 `completeFeatureHostActivation` 统一逆序管理。

## 第四步：实现 renderer

renderer 只能使用注入的 typed transport，不能 raw `fetch`，也不能直接读取 `window.setsunaDesktop`。

`src/renderer/client.ts`：

```ts
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  analyzeWordCount,
  type WordCountInput,
  type WordCountResult,
} from '../contracts/index.js';

export type WordCountClient = Readonly<{
  analyze(
    input: WordCountInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<WordCountResult>;
}>;

export function createWordCountClient(
  transport: FeatureOperationTransport,
): WordCountClient {
  return Object.freeze({
    analyze: (input, options) => transport.call(analyzeWordCount, input, options),
  });
}
```

`src/renderer/messages.ts`：

```ts
import { defineRendererMessageBundle } from '@setsuna-desktop/feature-core/renderer';

export const wordCountMessages = defineRendererMessageBundle({
  namespace: 'feature.wordCount',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      'feature.wordCount.title': '字数统计',
      'feature.wordCount.description': '在本机统计文本长度和按空白分隔的词数。',
      'feature.wordCount.input': '文本',
      'feature.wordCount.action': '开始统计',
      'feature.wordCount.result': '{characters} 个字符，{words} 个词',
    },
    'en-US': {
      'feature.wordCount.title': 'Word count',
      'feature.wordCount.description': 'Count text locally by characters and whitespace-separated words.',
      'feature.wordCount.input': 'Text',
      'feature.wordCount.action': 'Count',
      'feature.wordCount.result': '{characters} characters, {words} words',
    },
  },
});
```

`src/renderer/WordCountView.tsx` 使用宿主注入的标准控件；只有业务特有 presentation 才新增 scoped CSS：

```tsx
import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { useState } from 'react';
import type { WordCountResult } from '../contracts/index.js';
import type { WordCountClient } from './client.js';

export function WordCountView({
  client,
  translate,
  ui,
}: Readonly<{
  client: WordCountClient;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { Button, Section, TextArea } = ui;
  const [text, setText] = useState('');
  const [result, setResult] = useState<WordCountResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setPending(true);
    setError(null);
    try {
      setResult(await client.analyze({ text }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <Section featureId="word-count">
      <h3>{translate('feature.wordCount.title')}</h3>
      <p>{translate('feature.wordCount.description')}</p>
      <label>
        <span>{translate('feature.wordCount.input')}</span>
        <TextArea
          maxLength={100_000}
          rows={8}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
      </label>
      <Button disabled={pending} variant="primary" onClick={() => void analyze()}>
        {translate('feature.wordCount.action')}
      </Button>
      <div aria-live="polite">
        {error ? <span role="alert">{error}</span> : null}
        {result ? translate('feature.wordCount.result', {
          characters: result.characters,
          words: result.words,
        }) : null}
      </div>
    </Section>
  );
}
```

`src/renderer/feature.tsx` 把 client 和 scope-bound Slot contribution 组合起来：

```tsx
import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { registerSettingsPage } from '@setsuna-desktop/renderer-contracts/settings';
import { wordCountFeature } from '../contracts/index.js';
import { createWordCountClient } from './client.js';
import { wordCountMessages } from './messages.js';
import { WordCountView } from './WordCountView.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

export const wordCountRendererFeature = defineRendererFeature({
  definition: wordCountFeature,
  dependencies,
  messages: [wordCountMessages],
  setup(context) {
    const client = createWordCountClient(context.dependencies.transport);
    registerSettingsPage(context.ui, {
      entryId: 'word-count.settings-page',
      sectionId: 'word-count',
      location: 'capabilities',
      order: 900,
      titleKey: 'feature.wordCount.title',
      descriptionKey: 'feature.wordCount.description',
      render: ({ translate, ui }) => (
        <WordCountView client={client} translate={translate} ui={ui} />
      ),
    });
  },
});
```

`src/renderer/index.ts`：

```ts
export { wordCountRendererFeature } from './feature.js';
```

完整 Settings View 默认使用宿主根据 `titleKey` / `descriptionKey` 生成的标题。若页面有必须与
Feature 状态同生命周期的标题栏动作，可在 contribution 声明 `pageHeading: 'view'`，并在 view
中用 `ui.PageHeading` 渲染标题和 action；不要通过宿主私有组件导入或 CSS 位移实现。

不要修改通用 runtime client、Settings/Capabilities page switch，也不要在 React component/hook/effect 中注册 Slot。`context.ui` 自动把 disposer 绑定到当前 `FeatureScope`；初始装配由唯一 Renderer composition root 原子 commit。

## 第五步：接入构建图

构建图是显式的，但不是第二套运行时 catalog。按实际入口修改：

| 文件 | `word-count` 需要的改动 |
| --- | --- |
| 根 `package.json` | 因为有 renderer entry，`dependencies` 加 `@setsuna-desktop/feature-word-count: workspace:*`；不用修改 `build:features` |
| 根 `tsconfig.json` | `references` 加 `./packages/features/word-count/tsconfig.build.json` |
| `tsconfig.renderer.json` | 加 build reference 和 `@setsuna-desktop/feature-word-count/* -> packages/features/word-count/src/*` |
| `packages/desktop-runtime/package.json` | `dependencies` 加 `@setsuna-desktop/feature-word-count: workspace:*` |
| `packages/desktop-runtime/tsconfig.build.json` | 因为有 runtime entry，`references` 加 `../features/word-count/tsconfig.build.json` |
| `pnpm-lock.yaml` | 用仓库指定 pnpm 更新 workspace dependency |

如果 Feature 没有 renderer/main/preload 入口，根 package 不能保留它的 workspace dependency；如果没有 runtime 入口，desktop-runtime 也不能保留依赖。architecture check 会双向校验。

`build:features` 使用 pnpm workspace filter 构建 `packages/features/*`；Vite 与 Vitest 通过 `scripts/feature-package-aliases.ts` 共享 source alias。新增 package 不需要再修改这三份 inventory。它们只服务 build/test，运行时加载清单仍由各进程 composition root 显式决定。

更新 lockfile：

```bash
corepack pnpm@7.33.7 install --lockfile-only
```

## 第六步：只在 composition root 登记一次

Runtime root `packages/desktop-runtime/src/composition/runtime-feature-composition.ts`：

```ts
import { wordCountRuntimeFeature } from '@setsuna-desktop/feature-word-count/runtime';

const runtimeFeatures = defineRuntimeFeatureHost({
  required: [browserRuntimeFeature],
  optional: [
    // existing Features
    wordCountRuntimeFeature,
  ],
});
```

Renderer root `apps/desktop/renderer/src/composition/renderer-feature-composition.ts`：

```ts
import { wordCountRendererFeature } from '@setsuna-desktop/feature-word-count/renderer';

const rendererFeatures = defineRendererFeatureHost({
  required: [browserRendererFeature, terminalRendererFeature],
  optional: [
    // existing Features
    wordCountRendererFeature,
  ],
});
```

默认把可降级的业务能力放在 `optional`。只有该 Feature 失败时整个进程都不能 ready，才放入 `required`；criticality 是宿主策略，不能由 Feature 自己声明。

到这里，renderer view → typed transport → runtime route → typed result 的最小闭环已经完成。

## 第七步：只补高收益测试

示例至少覆盖以下真实风险：

1. operation codec 拒绝非字符串和超过上限的输入，并验证输出 codec fail closed；
2. runtime Feature 通过真实 FeatureHost 激活，route handler 返回确定结果，dispose 后注册被撤销；
3. renderer 有异步交互时，验证输入、调用 injected client、成功和失败状态；不要测试 React 或 DTO 的机械镜像；
4. composition smoke test 证明 builtin root 能激活该 Feature，防止 package 已创建但忘记登记。

测试放在 `packages/features/word-count/test/{contracts,runtime,renderer}`，不要把 `*.test.*` 放进 `src/`。

可以参考：

- runtime Feature 与 settings：[Memory Feature](../../packages/features/memory/test/runtime/memory-feature.test.ts)
- renderer controller 与事件刷新：[Goal renderer controller](../../packages/features/goal/test/renderer/goal-renderer-controller.test.ts)
- main/preload 生命周期：[Terminal Feature](../../packages/features/terminal/test)
- builtin host binding 回滚：[runtime factory](../../packages/desktop-runtime/test/runtime/runtime-factory.test.ts)

## 按需增加持久化或原生能力

不要在第一版预留这些入口。出现真实需求时按下表扩展：

| 需求 | 正确接缝 | 关键责任 |
| --- | --- | --- |
| Feature settings | contracts 定义 settings bundle；runtime Feature 声明 `settings` 并注入 settings registry | schema、defaults、revision、migration、public/secret projection；`syncPolicy: 'portable'` 自动参与 WebDAV，secret backup 名称必须显式 opt in |
| 私有持久事件 | contracts 定义 `feature.event` contract；runtime owner 建 projection | 每个历史 schema version 有 codec；未知 owner 不阻塞 Core，已知 owner 未知版本 fail closed |
| 工具结果专属 UI | contracts 定义稳定 `resultKind + major + payload codec`；renderer 调用 `registerChatToolResult(context.ui, ...)` | 仍属于 Chat typed chain resolver；未注册或解码失败时保留通用 fallback |
| Feature 间调用 | provider 暴露窄 Capability，consumer 只导入 provider `/contracts` | 不导入实现，不使用全局 service locator |
| Electron/OS 能力 | 新增真实 `main` entry，资源和 IPC handler 交给 FeatureScope | sender 校验、路径安全、取消、逆序清理 |
| renderer 固定 bridge | contracts 定义 bridge，`preload` entry 用 `definePreloadFeature` 贡献固定 key | 不暴露 raw `ipcRenderer` 或任意 dispatch |

现成参考：

- settings、secret、migration：[Image Generation settings](../../packages/features/image-generation/src/contracts/settings.ts)
- Feature event replay：[Goal event registry](../../packages/features/goal/src/runtime/goal-event-registry.ts)
- tool-result contribution：[Collaboration renderer Feature](../../packages/features/collaboration/src/renderer/feature.tsx)
- main/preload 固定桥接：[Review Feature](../../packages/features/review/src)
- main + renderer + runtime 的完整组合：[Browser Feature](../../packages/features/browser/src)

## 最终验证

先跑最相关测试，再跑完整门禁：

```bash
corepack pnpm@7.33.7 test:unit packages/features/word-count/test
corepack pnpm@7.33.7 docs:tree
corepack pnpm@7.33.7 check:architecture
corepack pnpm@7.33.7 typecheck
corepack pnpm@7.33.7 test
corepack pnpm@7.33.7 lint
corepack pnpm@7.33.7 build
git diff --check
```

完成时应能从源码回答：Feature identity 在哪里、哪些进程加载它、失败是否阻塞 ready、资源由谁清理、持久 identity 如何兼容，以及删除 package 后哪些数据仍需保留。

删除流程和完整失败语义见 [Feature Composition 落地基线](../architecture/feature-composition.md)。
