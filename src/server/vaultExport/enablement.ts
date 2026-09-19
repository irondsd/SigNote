/** Emergency gate for starting new exports. Existing operations remain
 * readable/cancellable so switching it off never strands a download midway. */
export const vaultExportStartEnabled = () => process.env.VAULT_EXPORT_DISABLED !== '1';
