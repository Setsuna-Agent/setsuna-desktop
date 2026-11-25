---
name: "画布设计"
description: "在 Setsuna 画布里搭建和修改可编辑设计稿，维护共享主题、生成参数化图形，或将可操作的网页服务挂入浏览器图层。"
---

# 画布设计

## 先判断用户在做什么

- **协同设计。** 用 `spawn_agent` 分派可独立完成的区块时，以简短的 `name` 标记光标，在 `prompt` 中给出目标画板或图层 ID。先约定共用组件和变量，再分工。各 Agent 自行选择目标；收到 `REVISION_CONFLICT` 后重读稿件，根据最新状态调整尚未提交的修改。子任务结束后统一预览。
- **选区词槽。** 消息里的 `design-selection://canvas` 引用记录了用户点选或框选的图层。取解码后的各个 `layer` 值作为目标 ID，`board` 值用于确认所在画板。处理排队反馈也按该条消息的引用定位。当前选区不同时先用 `design_view({action:"select",ids})` 切换。
- **改选区。** 「把间距调到 16」通常只需修改选中的自动布局画框。取得当前版本后，提交 `{action:"layout",revision,fields:{gap:16}}`。用户明确指向其他位置时，按名称查找，或用 `design_inspect({mode:"index",scope:"document"})` 浏览本稿。用 `design_view({action:"select",ids:[targetId]})` 自行切换到目标，再继续编辑。同名图层可结合父层、边界或局部预览核对。只修改用户指向的部分，保留周边图层、实例关系和主题绑定。
- **同稿新增画板。** 给桌面稿加移动版时，先看已有画板的位置，选一块空白区域，用 `design_edit({action:"insert",revision,ids:[],fields:{kind:"frame",name:"board.mobile",x,y,width,height,children}})` 新建同级画板。任何选区下都可用同一参数加 `dryRun:true` 试排。如果移动版已经嵌在桌面稿内，用 `design_view` 选中已有移动画框，再执行 `design_edit({action:"reparent",revision,ids:[mobileId],fields:{parentId:null}})`，保留画布位置和子层。
- **从头设计。** 先在思路里明确谁用这页、进来要做什么、第一眼需要看到什么。用这些答案决定内容的顺序和面积。从需求、当前画板或相关项目 README 确认业务语境和用词，再选指标。例如游戏中心的总览可以看玩家、会话和游戏启动次数。已有信息足够就直接搭稿，只有受众选择会实质改变内容时才询问。
- **参考图或局部反馈。** 判断用户要沿用的是构图、视觉风格，还是箭头指向的具体关系。例如「头和下面对齐」先比较两者左右边界，再决定改宽度还是外边距。参考截图里的文案、激活态和窗口边框只有属于目标界面时才绘制。复刻时把文字、容器和控件建成可编辑图层，照片和纹理可以作为图片使用。
- **评审或问用法。** 按问题给出位置、影响和改法。只问用法时可直接回答。请求评审时按需要读稿或看预览，等用户要求修改再写入。

## 工具清单

| 工具 | 什么时候用 |
| --- | --- |
| `design_inspect` | 按名称找层、取版本、读属性或检查排版。只查目标范围。 |
| `design_edit` | 对画布用编辑器命令建层、调整布局、绑定变量、修改组件和原型交互。每条写命令传当前 `revision`，可撤销。 |
| `design_resources` | 按 `kind` 查样式、集合、组件、库、图片、字体、画板、稿件、图标、笔刷、脚本和着色器预设、设备。 |
| `design_asset` | 把图片、画布脚本或着色器存进项目，返回可引用的路径。整稿任务还可管理导入字体。 |
| `design_preview` | 获取指定图层的渲染 PNG 和边界，需要能看图的模型。 |
| `design_prototype` | 从画板开始、点击热点、返回或重新开始，验证画板跳转和浮层。 |
| `design_view` | 选择图层、适应选区、平移、缩放或调整吸附。 |
| `design_export` | PNG 或 HTML（含 Tailwind）可复制或保存，SVG 可保存，`layers` 可复制后继续编辑。 |
| `design_document` | 整稿任务中新建、查询移动目标、移动或删除设计稿。 |
| `run_code` | 从 `ALL_TOOLS` 取准确工具名。用 `await tools.工具名(参数)` 串联本轮可用工具，`text(...)` 输出结果。通过 `result.data` 读取结构化回执或素材路径。 |
| 工作区本地工具 | `list_directory`、`read_file` 读项目，`apply_patch`、`write_file` 写实现，`exec_command` 运行命令，`read_shell_process`、`list_shell_processes`、`terminate_shell_process` 管理开发服务。沿用本轮权限。 |

用户只要求设计稿时直接使用画布命令。用户需要能输入、计算、筛选或提交的页面时，按下文「内置浏览器与交互服务」交付。

## 把内容组织成画面

- **阅读顺序。** 给首要任务一个清楚的入口。经营看板可以让人先读到经营结果，再看趋势解释变化，最后在订单中找明细。预约表单则让日期、时段、确认操作依次出现。根据任务选择主次，避免让每块内容获得一样的面积和强调色。
- **栅格与留白。** 先定内容左右边线和列宽，让标题、图表和列表沿共同的边线对齐。同一行中图标与文字的距离应小于两组信息之间的距离。遇到大片空白，先判断它在分组、给内容留增长空间，还是因为某个固定宽度截断了布局。只添加用户任务需要的控件和文字。
- **文字与数据。** 标题、正文、次级信息先用字号和字重拉开层级，辅助文字仍需可读。金额使用一致的小数位和右边线，名称列承担剩余宽度。趋势图用单位、时间范围和必要的刻度说明量级。用颜色表示状态时，保留可辨识的文字或符号。缺少真实数值或统计口径时，把示例数据与真实数据区分开。
- **视觉风格。** 参考图里最值得提取的是成组的关系，例如窄栏配大图、短标题配长留白、低彩度底面配一处高彩度动作。作品展示页可把空间给图片和标题，密集后台则把空间留给比较数据。深色主题里阴影容易融入背景，选中项可用表面明度或轮廓区分，切换前后保持图标和控件的尺寸。
- **可变内容。** 用实际的长名称、大金额或多行标签来决定哪些内容换行、哪些列固定、哪个容器随内容增高。用户要做状态设计时，空订单保留列表入口和下一步，加载态沿用已知列宽，错误态把重试放在失败区块内。按需求绘制对应状态。

## 把画面建成可维护的图层

**主题变量。** 先用 `design_resources({kind:"styles"})` 找已有角色，返回的 `items` 是 `[id, 定义]` 对。整稿里一次补齐反复使用的品牌色、表面色、文本色、状态色和间距。建变量时就指定实际使用它的图层和字段。把间距绑到对应的 `layout.gap` 或 `layout.paddingX`，卡片圆角绑到 `cornerRadius`。承诺全稿跟随主题前，先看代表性主组件上实际保存的绑定。主按钮可以引用品牌色。成功状态需要独立调色时单建变量。

下面的 `run_code` 片段适用于缺少这三项变量的整稿。取当前稿件的 `revision`，用查层或建层回执给 `buttonIds`（按钮底层）和 `rowIds`（自动布局画框）赋值。新建层可直接写 `fills:[{color:"#4F7CFF",styleId:"action"}]`。已有层可以一次补齐绑定。

```js
const styles = {
  brand: {kind:"color", name:"Brand", color:"#4F7CFF"},
  action: {kind:"color", name:"Action / primary", aliasId:"brand", color:"#4F7CFF"},
  "space-row": {kind:"number", name:"Space / row", value:12}
};
const palette = (await tools.design_edit({action:"setStyle", revision, fields:{styles}})).data;
const bound = await tools.design_edit({action:"bindTokens", revision:palette.revision, fields:{bindings:[
  {ids:buttonIds, field:"fills.0.color", tokenId:"action"},
  {ids:rowIds, field:"layout.gap", tokenId:"space-row"}
]}});
text(bound.data);
```

可绑定的还有 `strokes.0.color`、`shadow.color`、`fontSize` 和整套文字样式 `textStyleId`。数字、字符串、布尔变量用 `value` 存值，颜色变量用 `color`。换全稿品牌色时用 `setStyle` 写回原本地 `brand` 定义并只替换 `color`，保留集合、别名及其他模式。需要深浅色版本时可用 `setVariableCollection` 定义模式，在变量的 `modeValues` 指定各模式的值。选区任务可以绑定已有变量，创建或修改共享定义需要整稿范围。实现网页时，可以把这些角色映射到 CSS 自定义属性（如 `--color-action`），让控件引用它。网页 CSS 与画布变量分别保存。

**容器。** 用画板 → 区块 → 卡片或行 → 内容表达归属。卡底、圆角和内边距直接放在画框上。行列用自动布局，`gap` 控制子项间距，`padding` 控制内容离边缘的距离。固定宽父框里的可伸缩列用 `widthMode:"fill"`，随文字伸缩的标签用 `hug`。插入自动布局时写全 `direction`、`align`、`gap`、`padding`，指定横纵内边距时也要给出基础 `padding`。已知行高时，行内卡片用 `heightMode:"fill"` 等高铺满。行高由内容决定时，让自动布局卡片按内容增高。父框某一轴为 `hug`、子项在同轴设 `fill` 时，子项会使用已存尺寸。图表数据点、角标等有叠放关系的元素才适合在父框内定位。

下面是订单卡内一行的 `insert.fields` 示例。父卡片使用定宽的纵向自动布局，稿件已有颜色变量 `ink`。左列吸收剩余宽度，金额列固定宽度并右对齐。在订单卡里重复使用这行时，可将首行画框设为 `component:true`，再按下节插入实例。

```json
{
  "kind": "frame", "name": "orders.row", "width": 320, "widthMode": "fill", "heightMode": "hug",
  "layout": {"direction": "horizontal", "align": "center", "gap": 12, "padding": 12},
  "children": [
    {"kind": "text", "name": "orders.customer", "text": "南城书店", "widthMode": "fill", "fontSize": 14, "fills": [{"color": "#344054", "styleId": "ink"}]},
    {"kind": "text", "name": "orders.amount", "text": "¥2,190.00", "width": 96, "textAlign": "right", "fontSize": 14, "fontWeight": 600, "fills": [{"color": "#344054", "styleId": "ink"}]}
  ]
}
```

文字高度随内容排版，支持的字重为 100 到 900 的整百档。徽章文字居中可用定尺寸画框搭配横向布局的 `align:"center",justify:"center"`。

**素材。** 知道 Lucide 图标名就用 `insertSvg` 的 `fields.icons` 批量放置，每项可带位置、尺寸和描边。查指定图标可用 `design_resources({kind:"icons",query:"user",exact:true})`。静态 SVG 给整层起业务名，给图形写有含义的 SVG ID。拆成独立层的图形沿用这些 ID 作名称。需跟随主题的纯色填充或描边，用导入回执的 `inserted` 找到对应层并绑定变量。相同色值本身没有建立绑定。面积图的填充可引用同份 SVG 中的 `linearGradient`。需要后续编辑的图例、坐标轴标签和标题保留为原生文字。

## 把重复模块做成组件

看到一排同构的指标卡、订单行或导航项，先确定哪些布局和样式以后应一起改。用 `design_resources({kind:"components",query:"kpi"})` 按模块名称查当前稿和已连接的共享库，合适就沿用返回的组件 ID。没有合适的定义时，把第一项放在页面实际需要的位置，做成主组件，其余位置放实例。只有配色或间距相同时共享变量，同一张图片可以直接复用 `assetPath`。

- **创建。** 从零搭稿时，在第一次 `insert` 的画框上写 `component:true`，用 `children` 定义布局、变量绑定和内容。已有普通画框可以用 `action:"component",ids:[frameId]` 原位转为主组件。同一父框下可成组的图层也能用这条命令包成主组件。回执的 `ids[0]` 是主组件 ID。
- **放置。** 单个实例用 `design_edit({action:"insertInstance",revision,ids:[parentId],mode:sourceId})`。放多个时，可用一次 `insert` 提交多个带 `instanceOf:sourceId` 的画框，实例继承主组件的子树。源组件里的文字和图片层用稳定名称，例如 `kpi.title`、`kpi.value`。

下面的 `run_code` 把一张已有指标卡转成主组件，在同一个横向自动布局画框里补两张实例卡。`rowId` 和 `firstCardId` 是父框与首卡的 ID，`titleId`、`valueId` 是首卡内两个直属文本层的 ID，可取自建层回执的 `inserted`。传入当前 `revision`。如果首卡已是主组件，直接使用它的 ID 和当前版本执行批量插入即可。

```js
const source = (await tools.design_edit({action:"component", revision, ids:[firstCardId]})).data;
const metrics = [["kpi.orders", "订单量", "128"], ["kpi.customers", "客户数", "96"]];
const layers = metrics.map(([name, title, value]) => ({
  kind:"frame", name, instanceOf:source.ids[0], widthMode:"fill",
  contentOverrides:{[titleId]:{kind:"text", text:title}, [valueId]:{kind:"text", text:value}}
}));
const batch = (await tools.design_edit({action:"insert", revision:source.revision, ids:[rowId], fields:{layers}})).data;
text({sourceId:source.ids[0], instanceIds:batch.ids, revision:batch.revision});
```

- **改一处内容。** 用 `design_inspect({mode:"index",ids:[instanceId],name:"kpi.value"})` 找到实例里的文本。将返回的图层 ID 去掉开头的 `instanceId + "/"` 就是 `path`，嵌套实例保留余下的完整路径。对实例本身调用 `design_edit({action:"override",revision,ids:[instanceId],fields:{path,text:"136"}})`。换图片用 `{path,assetPath}`，恢复继承用 `{path,value:null}`。
- **改共性或状态。** 所有卡片一起调间距、字重或底色时，编辑任务范围内的主组件或它绑定的变量。重复指标卡的涨跌标签可把文字和语义色一起做成变体，再按指标含义选择，例如退款率上升和营收上升应使用不同状态。制作可复用状态时，在本稿主组件上用 `createVariant` 和 `fields:{name:"Loading"}`，编辑返回的变体，再对实例用 `action:"variant",mode:variantId` 切换。
- **改造已链接的组件。** 需要调整继承的配色、排版或结构时，对实例根层调用 `design_edit({action:"detach",revision,ids:[instanceId]})`。用回执的版本和 `inserted` 中的可编辑子层 ID 继续修改，更多子层可从同一个根层 ID 往下查。分离后仍可能绑定库变量，改色时可用 `bindTokens` 绑定本稿变量，或替换填充、描边并省略共享 `styleId`。需要重复使用时，把改好的画框转成本稿主组件。需求与现有稿件已确定方向时，直接复用合适的库组件，只分离需要改造的实例。

## 参数化画布脚本

图表、点阵等需要随图层尺寸或参数重新生成的内容，适合放进 `script` 图层。已知预设可直接调用 `design_asset({action:"script",name:"bar-chart.js"})`，需要挑选时才查 `design_resources({kind:"scripts"})`。下面两个完整的 `run_code` 示例都假定发起任务时选中了一个可编辑画框；整稿中可在 `insert` 顶层显式传入 `ids:[frameId]`。

```js
const source = `/**
 * @input bars: number = 6
 * @input ink: color = #4F7CFF
 */
const count = Math.max(1, Math.min(40, Math.round(canvas.input.bars)));
const slot = canvas.width / count;
return Array.from({length:count}, (_, i) => {
  const height = canvas.height * (i + 1) / count;
  return {kind:"rectangle", name:"bar." + (i + 1), x:i * slot, y:canvas.height - height,
    width:slot * 0.75, height, cornerRadius:0, fills:[{color:canvas.input.ink}]};
});`;
const asset = await tools.design_asset({action:"script", name:"bars.js", source});
const {revision} = (await tools.design_inspect({ids:[], mode:"index"})).data;
text((await tools.design_edit({action:"insert", revision, fields:{
  kind:"script", name:"chart.bars", width:240, height:80,
  scriptPath:asset.data, scriptInputs:{bars:8}
}})).data);
```

布局试运行测量脚本图层的外框。需要判断图表内部绘制结果时，在图表生成后看预览。内层 `.js` 在画布沙箱运行，读取 `canvas.width/height/input`，返回画框、矩形、椭圆、文字或矢量数组，嵌套画框用 `children`。开头注释支持 number、color、boolean、string（字符串默认值用双引号）。颜色输入接收十六进制色值，把当前品牌色写进 `scriptInputs.ink` 只会复制当时的值。需要自动跟随主题的图形可用原生图层绑定填充或描边。图表需按尺寸或数据重新生成时保留脚本，换主题时显式更新对应颜色输入。脚本直接返回矩形时要给出 `cornerRadius`，直角填 0。单次最多 512 层、2 秒。调整参数时对脚本层 `update`，把已有 `scriptInputs` 与改动合并提交。用户需要逐个编辑生成物时，等脚本生成后对该层用 `convertScript`。

## 着色器填充

需要动态光泽、纹理或扭曲时，把 GLSL 片段着色器作为填充。普通品牌底色直接绑定颜色变量。可直接导入 `nebula.glsl` 等已知预设，或按下面方式自定义并暴露速度、颜色控件。

```js
const source = `precision mediump float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/** @label Tint @color @default #4F7CFF */
uniform vec3 u_tint;
/** @label Speed @default 0.5 @range 0, 2 @step 0.1 */
uniform float u_speed;
void main() {
  float x = gl_FragCoord.x / max(u_resolution.x, 1.0);
  float wave = 0.5 + 0.5 * sin(6.28318 * x + u_time * u_speed);
  gl_FragColor = vec4(mix(0.4 * u_tint, u_tint, wave), 1.0);
}`;
const asset = await tools.design_asset({action:"shader", name:"wave.glsl", source});
const {revision} = (await tools.design_inspect({ids:[], mode:"index"})).data;
text((await tools.design_edit({action:"insert", revision, fields:{
  kind:"rectangle", name:"cover.wave", width:320, height:120,
  fills:[{color:"#4F7CFF", shader:{assetPath:asset.data, uniforms:{u_speed:0.8}}}]
}})).data);
```

支持 GLSL ES 1.00 和 3.00，上例为 1.00。编辑器传入分辨率和时间，按注释生成控件。调参时沿用同一 `assetPath`，合并原填充的 `shader.uniforms`，保留其余绘制项。`sampler2D` 可取项目图片 `{kind:"image",assetPath}`、背景 `{kind:"background"}` 或本层 `{kind:"object"}`。导出保留静态效果。

## 内置浏览器与交互服务

- **画板间跳转、返回、浮层**用原型热点。**用户给了可访问的网址**时直接把它挂到网页层。**用户要能输入数量、实时算价、提交表单或读取数据**时，在本轮完成实际实现、启动和挂载。按需求接入存储或接口。
- 先定位当前稿件所属的项目目录。多目录项目用绑定信息里的 `root` 设置工作目录，读取相关的项目入口、依赖和启动脚本。用 `apply_patch` 修改现有实现或在合适的子目录创建页面。只需客户端交互时可交付 HTML/CSS/JS。有现成服务时优先复用。
- 以前台命令启动服务，交给运行时跨轮次管理。例如已配置 Vite 的 pnpm 项目可调用 `exec_command({cmd:"pnpm dev --host 127.0.0.1",cwd:appDir,persist:true,yield_time_ms:500})`。其他项目沿用其实际命令。读取启动输出，必要时凭返回的进程 ID 用 `read_shell_process` 继续读取。从实际输出取得地址、端口和页面路由，向该路由发一次请求，确认返回本次页面。若端口已被占用，使用该服务实际取得的端口。
- 选定一个可编辑画框后，用 `design_edit({action:"insert",ids:[frameId],revision,fields:{kind:"web",name:"quote.live",url:liveUrl,width:960,height:640,zoom:1}})` 挂载。空稿先建画板。已有网页层时对原 ID 执行 `update`，保留其位置和尺寸。需要模拟设备时从 `design_resources({kind:"devices"})` 选 `deviceId`。用户点图层上沿的播放键就能操作，按 Esc 回到画布。
- 交付时说明页面挂在哪个画框、可以操作什么。服务要留给用户继续用。续改时复用同一进程和图层，用户要求停止时用 `terminate_shell_process`。运行中心也可停止服务。重新打开稿件会加载保存的网址，服务已停止时需重新启动并在地址变化时更新图层。HTTP 检查证明路由可用，报告交互效果时说明实际验证过哪一步。

## 少往返地修改和交接

- **读目标。** 只缺版本时，`design_inspect({ids:[],mode:"index"})` 即可取得 `revision`。查层用 `{mode:"index",name:"orders.amount",ids:[cardId]}`，同名时结合 `parentId` 区分。需要看绑定或原始属性时再读目标层详情。检查回报的是画布边界，写入的 `x/y` 使用父框坐标。
- **批量写。** 一个可一起撤销的区块用一次 `insert` 提交嵌套 `children`，多棵同级树用 `fields.layers`。对多层做同一修改，用一次 `update` 显式列出目标 ID。建层回执的 `inserted` 提供子层 ID 和解算边界。在 `run_code` 中依次 `await` 写入，下一次使用上次 `result.data.revision`。普通批次可直接提交。尺寸取决于新布局时，选一个有代表性的区块，放进实际父框，按真实约束试运行。收到 `INVALID_LAYERS` 后，按 `issues[].path` 一次修完各层，缺失的布局字段可采用 `suggestedValue`。大批次可在 `run_code` 中先 `store("draft",fields)`，下一次 `load("draft")` 后只改报错字段，再交给 `design_edit`，省去重新生成整棵树。重复卡片需要先定视觉时，先看第一张主组件的层级，再批量放置实例。
- **读试运行结果。** 给准备提交的 `design_edit` 加 `dryRun:true`。在 `run_code` 中可用 `const {layout} = (await tools.design_edit({...command, dryRun:true})).data`。用 `layout.layers` 看目标层及受重排影响图层的实际尺寸，用 `layout.issues` 看试算后任务范围内的几何问题，其中可能有原稿已有的问题。`fillInHug` 给出发生回退的轴和尺寸。`validated:true` 表示命令可以提交，布局仍可能有警告。新层的正式 ID 从提交回执获取。大批次明细有上限，总数覆盖整个检查范围。
- **按疑问检查。** 改名、改间距等属性任务以成功回执收尾。需要判断整页层级、参考图相似度，或用户要求预览时，等区块成形后用 `design_preview` 看相应范围。若发现一排金额错位，改行模板或金额列的宽度和对齐，再看受影响的订单卡。整板验稿用 `design_inspect({ids:[boardId],mode:"audit"})`，一次读取整板统计和带路径的问题。同一边界造成的裁切合成一项，`id` 可定位，`affectedCount` 是受影响层数，`examples` 给出样例层 ID。先改对应容器，需要逐层细节时在该分支用 `mode:"layout"`。文字自身溢出和独立的内层裁切分别保留。`outsideParent` 表示仍可见，可保留有意越界的图形。复杂背景上的 `unverifiedContrast` 需要看预览才能下结论。
- **原型。** 用户要验证跳转时，给入口绑定目标画板，用 `design_prototype` 的 `start` 取得热点，再用 `click` 查看实际到达的画板或浮层。只调整静态外观时，属性回执或画面就能回答问题。
- **续做已有稿件。** 空选区收到「继续」时用 `design_inspect({ids:[],mode:"index"})` 取 `rootCount`、`boards` 和 `lastSaved`。回到与任务相符的画板和区块，按 ID 读取后接着改。旧稿可能没有保存位置；用画板名称或已有层名找回目标。画板超过 64 个时用 `design_resources({kind:"boards",offset:64})` 继续查。
- **恢复与接手。** `REVISION_CONFLICT` 且 `applied:false` 时读目标层，结合用户刚做的修改重新计算。`applied:true,refreshed:false` 表示已保存，需要继续时重读目标层即可。脚本中途失败，先区分哪些写入已落盘，再续做剩余部分。用户接手时停在最近一次保存，简要说清改了哪个区块，以及仍需判断的具体问题。只有实际看过渲染或操作过原型，才报告相应结果。
