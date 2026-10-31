# Website TypeScript strict mode

Status of the `strict` family of compiler flags in `website/tsconfig.json`,
measured with `yarn workspace lyf-registration-website typecheck`
(`tsc --noEmit`) on 2026-10-30, and the path to turning the rest on.

To re-measure one flag without changing the config:

```bash
cd website && npx tsc --noEmit --strictNullChecks | grep -c "error TS"
```

## Flags that are on

| Flag                         | Errors before | What it took                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `noFallthroughCasesInSwitch` |             0 | nothing                                                                                                                                                                                                                                                      |
| `strictBindCallApply`        |             0 | nothing                                                                                                                                                                                                                                                      |
| `noImplicitThis`             |             0 | nothing                                                                                                                                                                                                                                                      |
| `alwaysStrict`               |             0 | nothing                                                                                                                                                                                                                                                      |
| `strictFunctionTypes`        |             2 | `CancelStatusDialog` is generic over its row type instead of accepting the base `RowWithStatusAndNotes` and being handed `RegDashboardRow` callbacks                                                                                                         |
| `useUnknownInCatchVariables` |             2 | `e instanceof Error ? e.message : String(e)` in the two small-group catch blocks                                                                                                                                                                             |
| `noImplicitReturns`          |             7 | explicit `return undefined` on the early-exit branch of effects that otherwise return a cleanup                                                                                                                                                              |
| `noUnusedParameters`         |             8 | `_event`-style names for ignored MUI callback arguments; dropped unused `index` parameters                                                                                                                                                                   |
| `noImplicitAny`              |            17 | `src/types/modules.d.ts` declares `file-saver` and `@nodeguy/server-date`; typed accumulators in `SmallGroupAssignments`; `createEmptyRegistrationData` returns `RegistrationData`; `keyof ParentDashboardRow` for the editable-column loop in `profile.tsx` |
| `noUnusedLocals`             |            70 | unused imports and locals removed (an empty `CamperProfile` stub and an unused camp-credit `useDocumentData` subscription in `CampCreditTab` went with them)                                                                                                 |

The same pass replaced every `@ts-ignore` with `@ts-expect-error`. Fourteen
of them were suppressing nothing under the current flags and were deleted
(`CreateTestData` x2, `LinkButton`, `ConfirmationScreen`,
`RegistrationDataContext` x2, `useFamilyData` x2, `useRegistrations` x8). Some
of those sites will error again under `strictNullChecks`, which is fine: the
directive should come back only when it actually suppresses something.

## Flags that are off

| Flag                                 | Errors | Why it is off                                                                                                        |
| ------------------------------------ | -----: | -------------------------------------------------------------------------------------------------------------------- |
| `strictNullChecks`                   |    156 | see below                                                                                                            |
| `strictPropertyInitialization`       |    n/a | TS5052: requires `strictNullChecks`                                                                                  |
| `strict`                             |    174 | the union of the above; everything else in the family is already on                                                  |
| `noPropertyAccessFromIndexSignature` |     31 | outside `strict`; mostly `process.env.X` and record lookups, a style choice rather than a safety one                 |
| `exactOptionalPropertyTypes`         |      1 | outside `strict`; the count is only meaningful once `strictNullChecks` is on, since `undefined` is erased without it |
| `noUncheckedIndexedAccess`           |      0 | same caveat: it adds `undefined` to index results, which this config erases; re-measure after `strictNullChecks`     |

### strictNullChecks: 156 errors in 33 files

By error code:

| Code    | Count | Meaning                                                                                               |
| ------- | ----: | ----------------------------------------------------------------------------------------------------- |
| TS18048 |    65 | `x` is possibly `undefined` (optional fields on the `Partial<...>` schema types read without a guard) |
| TS2322  |    42 | not assignable, almost all `useState<T>(null)` / `createContext<T>(null)` without `\| null`           |
| TS2345  |    24 | possibly-undefined argument passed to a function expecting a value                                    |
| TS18047 |    14 | `x` is possibly `null`                                                                                |
| TS7053  |     5 | implicit `any` from indexing with a possibly-undefined key                                            |
| other   |     6 | TS2538, TS2769, TS2488, TS2339                                                                        |

Top files:

| File                                                                       |   Errors |
| -------------------------------------------------------------------------- | -------: |
| `src/hooks/useRegistrations.tsx`                                           |       34 |
| `src/components/Registration/ReviewStep.tsx`                               |       17 |
| `src/pages/user/profile.tsx`                                               |       16 |
| `src/components/Registration/RegistrationFlow.tsx`                         |       13 |
| `src/components/SmallGroupAndCabinAssignments/SmallGroupContext.ts`        |       10 |
| `src/components/SmallGroupAndCabinAssignments/SmallGroupAssignmentsV2.tsx` |        8 |
| `src/components/Admin/SmallGroupAssignments.tsx`                           |        7 |
| `src/components/Inputs/FormCheckboxGroup.tsx`                              |        5 |
| `src/hooks/useFamilyData.tsx`                                              |        4 |
| `src/components/Registration/RegistrationDataContext.tsx`                  |        4 |
| `src/components/CheckoutFlow/CheckoutFlow.tsx`                             |        4 |
| `src/components/Admin/Waitlist.tsx`                                        |        4 |
| `src/components/Admin/RegistrationDashboard.tsx`                           |        4 |
| `src/components/Registration/ReviewStepOrderSummaryItems.tsx`              |        3 |
| `src/components/Registration/CamperStep.tsx`                               |        3 |
| 18 further files                                                           | 1-2 each |

### Suggested path

1. **Ratchet, don't flip.** Add `website/tsconfig.strict.json` that extends
   `tsconfig.json`, sets `"strictNullChecks": true`, and lists in `include`
   only the files that are already clean (today: everything in `src/utils`,
   `src/types`, `gatsby-*.ts*`, and the 120-odd components with zero errors).
   Run `tsc --noEmit -p tsconfig.strict.json` next to `typecheck` in CI so
   the clean set cannot regress, and move files into the list as they are
   fixed. When the list is the whole of `src`, delete it and set the flag in
   `tsconfig.json`.
2. **Order of work.** The 18 files with one or two errors first (an
   afternoon), then the contexts and small screens (`RegistrationDataContext`,
   `CheckoutFlow`, `FormCheckboxGroup`, `Waitlist`, `RegistrationDashboard`),
   then the three large screens (`profile.tsx`, `ReviewStep`,
   `RegistrationFlow`), then the `SmallGroup*` trio (25 errors, mostly one
   nullable `pairings` state), and `useRegistrations` last and on its own, as
   it is also the subject of the performance work.
3. **Patterns that clear most of it.** `useState<T | null>(null)` instead of
   `useState<T>(null)`; a non-null context pattern (`createContext<T | null>`
   plus a `useX()` hook that throws when missing) for
   `RegistrationDataContext`, `RegistrationDispatchContext` and the
   small-group contexts; `?? ""` / early returns where a `Partial<>` schema
   field is read for display; and in `useRegistrations` an explicit
   `Partial<RegistrationData>` for rows being assembled so the setters stop
   needing `undefined`.

## Lint rules relaxed in `website/eslint.config.mjs`

These are deliberate and each has a one-line reason in the config. The
inventories below are what they currently cover, so they can be worked down.

**`react-hooks/exhaustive-deps` (warn).** Seven effects still omit
dependencies. Two were fixed in the same PR because they were real staleness
bugs (`TimeGated` ignored a later change of `forceHide`; `useBoop` ignored
`timing`). The rest are mount-once by design and need a decision rather than
a mechanical fix:

- `RegistrationFlow.tsx` 227 and 270: load-from-cache and prefill effects
  that must run once per sign-in, not whenever `familyData` re-renders.
  Convert the "already done" checks into refs, then list the deps.
- `useFamilyData.tsx` 286 and 338: listener setup keyed on `familyDocs`;
  the missing deps are stable props. Owned by the performance work.
- `useFirebaseAuth.tsx` 84: the auth observer; adding `isSignedIn` would
  re-register it on every sign-in.
- `profile.tsx` 260: depends on `curRows`, a fresh array every render, so
  it already runs more often than the lint suggests; derive
  `shouldShowOffWaitlistDialog` with `useMemo` instead of an effect.
- `Table.tsx` 73: `setSnackbar` from context, stable in practice.

**`@typescript-eslint/no-explicit-any` (warn).** None left. The edit
actions' `newValue` is `unknown` (the reducer writes it into `Partial<>`
records by string key); legacy camper demographics are typed as
`Demographics`; the grid cell params in `Waitlist.tsx` and `profile.tsx`
name their row types; the `useDrop` drop result in `AssignmentsGroup.tsx`
is `void`.

**`no-console` (warn).** None left: caught errors go to `console.error`,
and the `CreateTestData.tsx` deletion notice to `console.warn`.

**`react/no-unescaped-entities` (off)** and **`react/prop-types` (off)**:
prose apostrophes and TypeScript-typed props; nothing to work down.

**Inline:** `useBoop.tsx` keeps its `{}` return type with a disable comment;
the spring style object is passed to several `animated` elements whose
prop types differ.
