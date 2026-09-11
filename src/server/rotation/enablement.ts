/**
 * The one switch that stops *new* rotations without a redeploy.
 *
 * Set `ROTATION_DISABLED=1` and the profile page stops offering the entry point
 * and `rotation.begin` refuses. Everything else — status, inventory, stage,
 * claim, pause, cancel and commit — keeps working, because an operation already
 * under way must always be finishable or cancellable; the fence holds the
 * account's writes until it is one or the other.
 *
 * Read per call rather than captured at module load, so flipping the variable
 * takes effect on the next invocation.
 */
export const rotationStartEnabled = () => process.env.ROTATION_DISABLED !== '1';
