# WorkoutApp enhancement plan

Source review: 2026-09-16, including substantial pre-existing uncommitted UI/import/deployment work. Findings describe that worktree, not a verified release. Recheck files after the concurrent work settles. This task creates the previously missing guidance pair; the work below remains proposed.

## Findings and recommended sequence

| Priority | Observed gap | Enhancement | Completion evidence |
| --- | --- | --- | --- |
| 1 | Feature buttons bypass `ui/Button.tsx` in `Exercises.tsx` (search clear/catalog rows) and `Import.tsx` (draft-day disclosure). The shared UI directory has Button/Modal/Motion/Skeleton but no shared field/error wrapper. | Extend Button for the actual action semantics, migrate those callers, and extract repeated field/error presentation using the existing `lib/validation.ts` contract. Do not duplicate Nutrition's entire UI library or replace valid native inputs wholesale. | Keyboard/disclosure semantics, first-invalid focus, accessible errors, and 44 px controls pass the existing browser/theme matrix. |
| 1 | `ImportService.cs` is 919 lines, `WorkoutService.cs` 777, and `ProgramService.cs` 559. Multiple orchestration and calculation responsibilities are concentrated in large services. | After current import changes settle, extract import lifecycle/upload/review responsibilities; separate workout suggestion/context calculations from session persistence, and phase scheduling from program mutations. Keep existing service entry points and transactions stable. | Regression coverage preserves tenancy, revisions, import retry/cleanup, unknown loads, bodyweight snapshots, progression, and phase completion; API suite passes. |
| 2 | `ui/Button.tsx` and much of `index.css` use compressed one-line formatting. CSS defines motion tokens while `ui/Motion.tsx` separately embeds durations/easing. | Add a consistent formatter in a separate change, then centralize shared motion timing/easing and divide CSS along existing responsibilities without changing cascade order. Small line counts must not hide complexity. | Formatting check passes; build and visual/responsive tests confirm unchanged themes, focus, layout, and reduced-motion behavior. |
| 2 | Package scripts have no lint/format/design-system/dead-code gates and no documentation-equality check. There is no repository `.github/workflows` directory. | Add guidance equality and scoped reuse/readability checks; inspect existing Cloud Build gates before choosing CI placement. Add frontend/API/browser checks in the appropriate pipeline rather than assuming deployment builds cover them. | Deliberate guidance mismatch/new feature raw button fails; legitimate primitive internals pass; isolated API and both browser suites run successfully. |

## Delivery approach

1. Rebase the inventory on settled concurrent work; do not overwrite or stage another task's edits. Capture missing focused regressions before moving logic.
2. Deliver action/field standardization, service decomposition, formatting/motion cleanup, and automated gates separately. Introduce reusable pieces only when current callers justify them.
3. Run the checks in `CLAUDE.md`, including `test:visual` and `test:responsive` for shared UI changes. Keep test databases disposable and AI mocked. This plan does not implement, commit, or deploy those changes.

The app already has semantic theme tokens, shared modal/motion/skeleton components, application validation, reduced-motion handling, and a broad responsive suite. Preserve these foundations. No browser, live provider, production, or import-dispatch verification was performed for this documentation review.
