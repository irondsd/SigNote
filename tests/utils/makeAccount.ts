import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export const makeAccount = () => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  return { privateKey, account };
};
