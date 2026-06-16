import { metaInput, resolveMetaUpdate } from '../_meta';

// Pin/expiry/burn mutex contract — ported from the old E2E api-patch-contract
// spec when the polymorphic PATCH became the discrete `setMeta` procedure.
describe('resolveMetaUpdate (pin/expiry/burn mutex)', () => {
  it('burnAfterReading=true clears any existing expiresAt', () => {
    expect(resolveMetaUpdate({ burnAfterReading: true })).toEqual({
      burnAfterReading: true,
      expiresAt: null,
    });
  });

  it('burnAfterReading=false alone does not touch expiresAt', () => {
    expect(resolveMetaUpdate({ burnAfterReading: false })).toEqual({ burnAfterReading: false });
  });

  it('setting expiresAt clears burnAfterReading', () => {
    const future = new Date(Date.now() + 3_600_000);
    expect(resolveMetaUpdate({ expiresAt: future })).toEqual({
      expiresAt: future,
      burnAfterReading: false,
    });
  });

  it('clearing expiresAt (null) alone does not touch burnAfterReading', () => {
    expect(resolveMetaUpdate({ expiresAt: null })).toEqual({ expiresAt: null });
  });

  it('when both fields are sent explicitly, the caller wins (arming path)', () => {
    const future = new Date(Date.now() + 3_600_000);
    expect(resolveMetaUpdate({ burnAfterReading: true, expiresAt: future })).toEqual({
      burnAfterReading: true,
      expiresAt: future,
    });
  });

  it('pin and expiry can be updated together in one call', () => {
    const future = new Date(Date.now() + 3_600_000);
    expect(resolveMetaUpdate({ pinned: true, expiresAt: future })).toEqual({
      pinned: true,
      expiresAt: future,
      burnAfterReading: false,
    });
  });

  it('pin alone leaves expiry/burn untouched', () => {
    expect(resolveMetaUpdate({ pinned: true })).toEqual({ pinned: true });
  });
});

describe('metaInput validation', () => {
  const id = '507f1f77bcf86cd799439011';

  it('rejects a non-boolean pinned', () => {
    expect(metaInput.safeParse({ id, pinned: 'yes' }).success).toBe(false);
  });

  it('rejects a non-boolean burnAfterReading', () => {
    expect(metaInput.safeParse({ id, burnAfterReading: 'true' }).success).toBe(false);
  });

  it('rejects an invalid expiresAt', () => {
    expect(metaInput.safeParse({ id, expiresAt: 'not-a-date' }).success).toBe(false);
  });

  it('rejects an empty update (nothing to change)', () => {
    expect(metaInput.safeParse({ id }).success).toBe(false);
  });

  it('coerces an ISO expiresAt string to a Date', () => {
    const iso = new Date(Date.now() + 3_600_000).toISOString();
    const parsed = metaInput.parse({ id, expiresAt: iso });
    expect(parsed.expiresAt).toBeInstanceOf(Date);
    expect((parsed.expiresAt as Date).toISOString()).toBe(iso);
  });

  it('keeps null expiresAt as null (does NOT coerce to epoch)', () => {
    const parsed = metaInput.parse({ id, expiresAt: null });
    // Regression: z.coerce.date() would turn null into new Date(null) = epoch,
    // arming a past expiry and self-destructing the note on "turn off".
    expect(parsed.expiresAt).toBeNull();
  });
});
