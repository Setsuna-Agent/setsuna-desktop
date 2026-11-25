---
name: design-canvas
description: Build and revise editable designs in the Setsuna canvas, including shared themes, parameterized graphics and working web experiences in embedded browser layers.
---

# Design canvas

## Identify the job

- **Shared canvas.** When delegating independent work with `spawn_agent`, set a short `name` for the cursor and include the target board or layer IDs in `prompt`. Agree on shared components and tokens before splitting work. Each agent selects its own targets. On `REVISION_CONFLICT`, inspect the latest state and replan the outstanding edit. Preview the combined result after the agents finish.
- **Canvas references.** A `design-selection://canvas` mention records the user’s picked layers. Use its decoded `layer` values as target IDs, including in queued feedback. A `board` value gives context. If the current scope differs, switch with `design_view({action:"select",ids})` before editing.
- **Edit the selection.** “Set the gap to 16” usually needs one edit to the selected auto-layout frame. With the current revision, submit `{action:"layout",revision,fields:{gap:16}}`. When a request points elsewhere, find the named layer or browse the draft with `design_inspect({mode:"index",scope:"document"})`. Select the intended target yourself with `design_view({action:"select",ids:[targetId]})` and continue editing. Disambiguate similar layers by parent, bounds or a local preview. Preserve the surrounding layers, component relationships and theme bindings.
- **Add a board to an existing draft.** For a mobile version of a desktop board, inspect the existing board bounds, choose open canvas space, and create a peer with `design_edit({action:"insert",revision,ids:[],fields:{kind:"frame",name:"board.mobile",x,y,width,height,children}})`. This also works with `dryRun:true` from any selection. If the mobile frame already exists inside the desktop board, select it with `design_view` and call `design_edit({action:"reparent",revision,ids:[mobileId],fields:{parentId:null}})` to keep its canvas position and children.
- **Create a page.** Decide who uses the page, what they came to do and what they need to see first. Allocate space and reading order accordingly. Use the brief, current boards or relevant project README to identify the business and its vocabulary before inventing metrics. A game-center overview might track players, sessions and game launches. Ask for the audience only when the available context leaves a choice that would materially change the page.
- **Work from a reference or annotation.** Identify whether the user wants the composition, visual style or a particular relationship. For “align the header with the panel below,” compare their left and right edges before deciding whether to change width or margin. Include screenshot copy, active states and window chrome only when they belong to the requested interface. Recreate editable text, containers and controls as layers. Use images for photography and textures.
- **Review or explain.** Describe the location, impact and concrete fix for a finding. Answer usage questions directly when the answer is known. For a review, inspect or preview the relevant area and wait for an edit request before writing.

## Tool directory

| Tool | When to use it |
| --- | --- |
| `design_inspect` | Find a named layer, get the revision, read properties or check layout in the relevant scope. |
| `design_edit` | Use editor commands for layers, layout, variables, components and prototype interactions. Each write takes the current `revision` and participates in undo. |
| `design_resources` | Look up styles, collections, components, libraries, images, fonts, boards, documents, icons, brushes, script and shader presets, or devices by `kind`. |
| `design_asset` | Import an image, canvas script or shader into the project and get its path. Whole-document tasks can also manage imported fonts. |
| `design_preview` | Get the rendered PNG and bounds for specific layers when an image-capable model needs to see them. |
| `design_prototype` | Start on a board, click a hotspot, go back or restart to exercise navigation and overlays. |
| `design_view` | Select layers, fit, pan, zoom or adjust snapping. |
| `design_export` | Copy or save PNG or HTML (including Tailwind), save SVG, or copy editable `layers`. |
| `design_document` | Create a draft, list move destinations, move or delete a draft in whole-document scope. |
| `run_code` | Choose the exact name from `ALL_TOOLS`, compose calls with `await tools.NAME(args)` and print with `text(...)`. Read structured receipts and imported asset paths from `result.data`. |
| Local workspace tools | Use `list_directory` and `read_file` to inspect the project, `apply_patch` or `write_file` to implement it, `exec_command` to run commands, and `read_shell_process`, `list_shell_processes` and `terminate_shell_process` to manage a development service under the current permissions. |

Use canvas commands for a design draft. For a request that needs live input, calculations, filtering or submission, follow “Embedded browser and interactive services” below.

## Compose the page around its content

- **Reading order.** Give the primary task a clear starting point. An operations dashboard might lead with the business result, use a trend to explain the change, and let people find the underlying orders below. A booking form might lead with date, time slot and confirmation in sequence. Use area and emphasis to express those priorities.
- **Grid and space.** Set the content edges and column widths first. Align headings, charts and lists to those edges. Keep the gap between an icon and its label smaller than the gap to the next group. When a region looks empty, determine whether it separates groups, leaves room for variable content or comes from an undersized fixed column. Add controls and copy only when they serve the task.
- **Type and data.** Separate headings, body and secondary information with size and weight while keeping secondary text readable. Give amounts consistent precision and a common right edge. Let the name column absorb the remaining width. Give a trend the units, time range and ticks needed to read its magnitude. Pair state colors with a recognizable label or symbol. Distinguish illustrative data from supplied facts when amounts or metric definitions are missing.
- **Visual direction.** Extract relationships from a reference, such as a narrow column beside a large image, a short headline with generous space, or muted surfaces and one bright action. A portfolio can give most of its space to the image and title. A dense admin view needs room to compare values. In dark themes, a shadow can disappear into the background. Distinguish selected controls with surface lightness or an outline and keep their dimensions stable between states.
- **Variable content.** Use representative long names, large amounts or multiline labels to decide which columns stay fixed, which text wraps and which containers grow. When the brief calls for states, keep the list entry point and next action in an empty orders view, preserve column widths during loading and put retry within the failed section. Draw the states relevant to the request.

## Build an editable layer tree

**Theme variables.** Look up existing roles with `design_resources({kind:"styles"})`. Its `items` are `[id, definition]` pairs. In whole-document scope, create the missing reusable brand, surface, text, status and spacing roles together. Create each role for a concrete consumer. Bind spacing to the intended layout field (e.g. `layout.gap` or `layout.paddingX`) and card radius to `cornerRadius`. Check the authored bindings on a representative main component before promising a theme-wide change. A primary action can follow the brand while success keeps an independently editable color.

This `run_code` fragment assumes those three variables are missing. Supply the current `revision` and set `buttonIds` (button backgrounds) and `rowIds` (auto-layout frames) from an inspection or insertion receipt. New layers can bind immediately with `fills:[{color:"#4F7CFF",styleId:"action"}]`. Existing layers can receive all bindings in one edit.

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

Other binding targets include `strokes.0.color`, `shadow.color`, `fontSize` and a whole text style via `textStyleId`. Number, string and boolean variables use `value`. Colors use `color`. To change the brand across a document, pass the existing local `brand` definition back to `setStyle` with only `color` replaced, retaining collection, alias and mode metadata. For light and dark versions, define modes with `setVariableCollection` and assign their values in each variable's `modeValues`. A selection can bind existing variables. Creating or editing shared definitions requires whole-document scope. When implementing a web page, map these roles to CSS custom properties such as `--color-action` and reference them from the controls. Web CSS and canvas variables are stored separately.

**Containers.** Nest content under its board, section and card or row. Put the card background, corner radius and padding on the frame. Use auto-layout for rows and columns, `gap` between children and `padding` at the edges. A flexible column inside a fixed-width frame can use `widthMode:"fill"`. A label that should size to its text can use `hug`. On insert supply `direction`, `align`, `gap` and `padding`, including `padding` when overriding the axes. For equal-height cards in a row of known height, use `heightMode:"fill"` on each in-flow card. For a content-driven row, let auto-layout cards hug their contents. A child asking to fill a hug axis falls back to its stored size. Reserve parent-local positioning for elements with a meaningful coordinate or overlay, such as chart points and corner badges.

This order row is an example of `insert.fields` inside a fixed-width card with vertical auto-layout. The document already has an `ink` color variable. The name takes the available width and the amount keeps a fixed right-aligned column. For repeated orders, set `component:true` on the first row's frame and insert instances as described below.

```json
{
  "kind": "frame", "name": "orders.row", "width": 320, "widthMode": "fill", "heightMode": "hug",
  "layout": {"direction": "horizontal", "align": "center", "gap": 12, "padding": 12},
  "children": [
    {"kind": "text", "name": "orders.customer", "text": "Southside Books", "widthMode": "fill", "fontSize": 14, "fills": [{"color": "#344054", "styleId": "ink"}]},
    {"kind": "text", "name": "orders.amount", "text": "¥2,190.00", "width": 96, "textAlign": "right", "fontSize": 14, "fontWeight": 600, "fills": [{"color": "#344054", "styleId": "ink"}]}
  ]
}
```

Text height follows its content. Font weights run from 100 to 900 in increments of 100. For a centered badge label, use a fixed-size frame with horizontal layout and `align:"center",justify:"center"`.

**Assets.** Insert known Lucide icons together with `insertSvg` and `fields.icons`, including each icon's placement, size and stroke. To find an exact icon, use `design_resources({kind:"icons",query:"user",exact:true})`. For static SVGs give the layer a meaningful name and the shapes descriptive SVG IDs. Parts kept as separate layers inherit their IDs as names. After import use the `inserted` receipt to bind editable solid fills or strokes that follow the theme. A matching hex alone establishes no link. An area chart can use a `linearGradient` defined in the same SVG. Keep legends, axis labels and titles as native text when they need to remain editable.

## Reuse repeated modules as components

For a set of metric cards, order rows or navigation items, identify the structure and styles that should change together. Search the current draft and its linked libraries by module name with `design_resources({kind:"components",query:"kpi"})`. Reuse a suitable component ID. If none fits, make the first item a main component in its intended place on the page and use instances for the rest. Elements that only share a color or spacing can share a variable. Repeated images can share an `assetPath`.

- **Create the source.** For new work, put `component:true` on the first frame in `insert` and define its layout, token bindings and content with `children`. Convert an existing editable frame in place with `action:"component",ids:[frameId]`. The same command can wrap groupable siblings under one parent. The returned `ids[0]` identifies the main component.
- **Place instances.** Place one with `design_edit({action:"insertInstance",revision,ids:[parentId],mode:sourceId})`. Place several in one `insert` by supplying frames with `instanceOf:sourceId`. Each inherits the source subtree. Give text and image layers stable names such as `kpi.title` and `kpi.value`.

This `run_code` fragment converts an existing metric card and adds two instances to the same horizontal auto-layout row. Supply the current `revision`, the parent `rowId`, the `firstCardId`, and its two direct text child IDs `titleId` and `valueId` from the insertion receipt's `inserted` list. If the first card is already a component, use its ID and the current revision directly for the batch.

```js
const source = (await tools.design_edit({action:"component", revision, ids:[firstCardId]})).data;
const metrics = [["kpi.orders", "Orders", "128"], ["kpi.customers", "Customers", "96"]];
const layers = metrics.map(([name, title, value]) => ({
  kind:"frame", name, instanceOf:source.ids[0], widthMode:"fill",
  contentOverrides:{[titleId]:{kind:"text", text:title}, [valueId]:{kind:"text", text:value}}
}));
const batch = (await tools.design_edit({action:"insert", revision:source.revision, ids:[rowId], fields:{layers}})).data;
text({sourceId:source.ids[0], instanceIds:batch.ids, revision:batch.revision});
```

- **Change one instance's content.** Locate its text with `design_inspect({mode:"index",ids:[instanceId],name:"kpi.value"})`. Remove the leading `instanceId + "/"` from the returned ID to get `path`. Keep the rest of the path intact for nested instances. Call `design_edit({action:"override",revision,ids:[instanceId],fields:{path,text:"136"}})`. Use `{path,assetPath}` to replace an image or `{path,value:null}` to restore the inherited content.
- **Change shared design or state.** For a change to every card's spacing, type weight or surface, edit the in-scope main component or its bound variable. For a repeated KPI, keep the status label and its semantic color together in a variant. Map direction to business meaning (rising refunds and rising revenue have opposite meanings). For reusable states, use `createVariant` on the local main component with `fields:{name:"Loading"}`, edit the returned variant, then switch an instance with `action:"variant",mode:variantId`.
- **Adapt a linked component.** Use `design_edit({action:"detach",revision,ids:[instanceId]})` on the instance root when the design calls for different inherited colors, typography or structure. Continue with the returned revision and the editable child IDs in `inserted`. Inspect beneath the same root ID if more child IDs are needed. Shared token bindings can survive detachment. Use `bindTokens` to apply a local token, or replace the paint without its shared `styleId` to apply a literal color. Promote a repeated adaptation with `component` and reuse it. When the brief and existing draft establish the design direction, choose suitable linked components and adapt the ones that need it.

## Parameterized canvas scripts

Use a `script` layer for content that regenerates from its size or inputs, such as a chart or dot grid. Import a known preset directly with `design_asset({action:"script",name:"bar-chart.js"})`. Use `design_resources({kind:"scripts"})` when choosing one. Both complete `run_code` examples below assume the task was sent with one editable frame selected. In whole-document scope pass `ids:[frameId]` on the insert command.

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

Layout trials measure the script layer’s outer box. Preview the rendered chart to judge its generated marks. The inner `.js` runs in the canvas sandbox. It reads `canvas.width/height/input` and returns an array of frames, rectangles, ellipses, text or vectors. Nest frame contents in `children`. Header inputs support number, color, boolean and string (double-quote string defaults). A color input takes a hex value. Copying the current brand color into `scriptInputs.ink` captures that value. To follow later theme changes automatically, use editable native shapes with bound paints. When a chart must regenerate from dimensions or data, keep the script and update its color input explicitly on a theme change. A returned rectangle requires `cornerRadius`, with 0 for square corners. Each evaluation has a 2-second limit and may return up to 512 layers. To adjust parameters, merge changes into the layer's existing `scriptInputs` with `update`. Use `convertScript` on a rendered script layer when the user wants to edit its generated shapes individually.

## Shader fills

Use a GLSL fragment shader for an animated sheen, texture or distortion. Ordinary brand surfaces can bind a color variable. Import a known preset such as `nebula.glsl` directly, or author a fill with editable speed and tint as below.

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

The renderer supports GLSL ES 1.00 and 3.00. This example uses 1.00. Resolution and time come from the renderer, and annotations define the inspector controls. To tune the material, retain its `assetPath` and merge `shader.uniforms` into the existing paint stack. A `sampler2D` uniform can take a project image via `{kind:"image",assetPath}`, the background via `{kind:"background"}`, or the layer via `{kind:"object"}`. Exports capture the static result.

## Embedded browser and interactive services

- Use prototype hotspots for navigation, back and overlays. Embed an existing reachable URL directly. When the user wants working quantity input, live pricing, form submission or data access, implement, start and mount the actual page in this turn. Add persistence or an API when the request calls for it.
- Work in the bound design project's directory. In a multi-root project use the binding's `root` to set the working directory. Read the relevant entry point, dependencies and start script. Use `apply_patch` to edit the existing implementation or create the page in a dedicated directory. Client-only interaction can use HTML/CSS/JS. Reuse an existing service where appropriate.
- Start the foreground command as a runtime-managed process that persists across turns. For example, in a pnpm project already configured for Vite, use `exec_command({cmd:"pnpm dev --host 127.0.0.1",cwd:appDir,persist:true,yield_time_ms:500})`. Follow the actual project command for other stacks. Read startup output, using the returned process ID with `read_shell_process` if needed. Use the actual listening address, port and page route. Request that route once and check that the response belongs to this page. If the port was busy, use the port the service obtained.
- With an editable frame, mount `design_edit({action:"insert",ids:[frameId],revision,fields:{kind:"web",name:"quote.live",url:liveUrl,width:960,height:640,zoom:1}})`. Create a board first in an empty draft. For an existing web layer, use `update` on its ID and preserve its size and position. Choose an optional `deviceId` from `design_resources({kind:"devices"})`. The user can press Play above the layer to interact and Esc to return to editing.
- Hand off the frame location and the working interaction. Leave its service running for the user. Reuse the same process and layer for follow-up edits. On a stop request use `terminate_shell_process`. The user can also stop it in the Run Center. Reopening the draft loads the saved URL. Restart a stopped service and update the layer if its address changed. An HTTP response verifies the route. Report which interactions were actually exercised.

## Edit, verify and hand back control

- **Read the target.** When only the revision is missing, `design_inspect({ids:[],mode:"index"})` returns it. Find a layer with `{mode:"index",name:"orders.amount",ids:[cardId]}` and use `parentId` to disambiguate names. Read a full layer when you need its bindings or authored properties. Inspection bounds are in canvas coordinates. Write `x/y` relative to the parent.
- **Batch the change.** Insert a section the user would undo together with nested `children`, or use `fields.layers` for sibling trees. For the same property change on several layers, list all target IDs in one `update`. The `inserted` receipt provides child IDs and solved bounds. In `run_code`, await each write and use its `result.data.revision` for the next. Submit familiar batches directly. When sizing depends on a new layout, trial one representative section in its intended parent with the real constraints. On `INVALID_LAYERS`, fix the listed `issues[].path` entries together. Missing layout fields include a `suggestedValue`. In `run_code`, save a large payload with `store("draft",fields)` before the call. Use `load("draft")` on the next call to correct the affected fields and resubmit the tree. When repeated cards need a visual decision, review the first main component before placing its instances.
- **Read a trial.** Send the intended `design_edit` with `dryRun:true`. For example, in `run_code` use `const {layout} = (await tools.design_edit({...command, dryRun:true})).data`. Read `layout.layers` for solved target and reflowed sizes, and `layout.issues` for geometry warnings across the resulting task scope, including earlier issues. `fillInHug` identifies the axis and actual fallback size. `validated:true` means the command can be applied even when it has warnings. Use the commit receipt to obtain permanent IDs for new layers. Large trials return bounded details and full counts.
- **Choose evidence for the question.** A successful write is sufficient for an explicit property change such as renaming or setting a gap. To judge hierarchy, fidelity to a reference, or a requested preview, use `design_preview` once the relevant composition is in place. If amounts are misaligned, fix the row structure or column width and alignment, then review the orders card. For a board review, call `design_inspect({ids:[boardId],mode:"audit"})`. The reply includes whole-board counts and issue paths. Clips from the same boundary form one issue with a focus `id`, `affectedCount` and sample layer IDs in `examples`. Inspect the named container first. Use `mode:"layout"` on that branch for individual findings. Intrinsic text overflow and independent nested clips remain separate. Intentional `outsideParent` layers can remain visible. Use a preview to judge `unverifiedContrast` on complex backgrounds.
- **Prototype.** When asked to verify navigation, link the entry control to its destination board. Use `design_prototype` with `start` to obtain the hotspot, then `click` to observe the destination board or overlay. For a static appearance change, a write receipt or preview can answer the question.
- **Resume a draft.** With no selection, use `design_inspect({ids:[],mode:"index"})` to read `rootCount`, `boards` and `lastSaved`. Inspect the board or section that matches the conversation before continuing. For older drafts without a saved location, look up an existing board or layer by name. For more than 64 boards, continue with `design_resources({kind:"boards",offset:64})`.
- **Recover and hand off.** On `REVISION_CONFLICT` with `applied:false`, reread the target and account for any human edits before retrying. With `applied:true,refreshed:false`, the write is already saved. Read the affected layer if more work depends on it. If a script stops between writes, identify which edits landed before continuing. When the user takes over, stop at the last saved edit and identify the changed section and any specific open question. Report a rendered or prototype result only after observing it.
