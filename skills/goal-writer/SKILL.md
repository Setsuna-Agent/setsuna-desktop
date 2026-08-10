---
name: goal-writer
description: Write and create durable, evidence-checkable thread goals when the user explicitly asks to use Goal mode, set a persistent goal, or continue autonomously across multiple turns. Do not use for ordinary one-turn tasks.
---

# Goal Writer

Turn the user's request into one persistent objective that another turn can resume without relying on conversational intent.

## Workflow

1. Confirm that the user explicitly requested Goal mode or a persistent multi-turn goal. Never infer Goal mode from task complexity alone.
2. Preserve every named deliverable, file, command, Skill, approval gate, release step, and success criterion from the request.
3. Write one concise objective containing:
   - the concrete outcome;
   - the authoritative evidence that proves it;
   - constraints and required workflows;
   - permission and scope boundaries;
   - how to iterate after failures or review findings;
   - the condition that genuinely requires stopping for user input.
4. Check that the objective is actionable after context compaction and cannot be satisfied by a plausible but unverified final answer.
5. Call `create_goal` with the objective. Creating a Goal replaces the thread's previous Goal, so do this only for the explicit request currently being handled.

## Writing Rules

- State outcomes and evidence, not a speculative implementation plan.
- Keep user wording where it identifies exact artifacts or workflows.
- Include verification appropriate to the task; do not invent unrelated gates.
- Treat approvals, credentials, destructive actions, and external coordination as boundaries rather than permission to bypass them.
- Define blocked as a real impasse requiring user input or an external state change, not as difficulty or a failed first attempt.
- Do not add a Token budget.
- Do not mark the Goal complete. Completion belongs to the executing turns after a strict evidence audit.

## Objective Shape

Use this shape as a checklist, not a rigid template:

```text
Achieve <outcome>. Preserve <constraints and boundaries>. Use <required workflow or Skill>.
Verify completion with <authoritative evidence>. If verification or review finds an actionable
issue, fix it and repeat the relevant checks. Stop for the user only when <true blocked condition>.
```
