/**
 * The rotation procedures as plain async functions.
 *
 * The engine and the wizard are written against a small interface of methods so
 * they can be driven in tests without HTTP. tRPC's client is a proxy of
 * `procedure.query(input)` / `procedure.mutate(input)` objects, not callables,
 * so something has to name which of the two each procedure is. Doing it once
 * here keeps that knowledge out of both, and keeps the query/mutation split —
 * which decides whether the input travels in the URL or the body, and so which
 * byte budget applies — in one readable list.
 */

import { rotationClient } from './client';
import type { RotationApi } from './engine';
import type { WizardDeps } from './wizard';

export type RotationProcedures = RotationApi & WizardDeps['rotation'];

export function createRotationApi(client: typeof rotationClient = rotationClient): RotationProcedures {
  const rotation = client.rotation;
  return {
    status: (input) => rotation.status.query(input),
    // The router's inferred input is narrower than the interface in two places:
    // it pins `material.version` to the literal current version, and it knows
    // `stage` never carries a file receipt. Both are true, and both are already
    // enforced server-side by Zod, so the cast asserts what the callers cannot
    // express rather than loosening a check.
    begin: (input) => rotation.begin.mutate(input as Parameters<typeof rotation.begin.mutate>[0]),
    inventory: (input) => rotation.inventory.query(input),
    stage: (input) => rotation.stage.mutate(input as Parameters<typeof rotation.stage.mutate>[0]),
    verify: (input) => rotation.verify.mutate(input),
    sourceFile: (input) => rotation.sourceFile.query(input),
    reserveFile: (input) => rotation.reserveFile.mutate(input),
    finalizeFile: (input) => rotation.finalizeFile.mutate(input),
    stagedFile: (input) => rotation.stagedFile.query(input),
    confirmRecovery: (input) => rotation.confirmRecovery.mutate(input),
    commit: (input) => rotation.commit.mutate(input),
    cancel: (input) => rotation.cancel.mutate(input),
    claim: (input) => rotation.claim.mutate(input),
  } as RotationProcedures;
}
