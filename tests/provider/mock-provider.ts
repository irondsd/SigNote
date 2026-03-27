import { type Chain, createWalletClient, http } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const RPC_URL = process.env.RPC_URL as string;

const normalizeAddress = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '');

const isHexString = (value: unknown): value is `0x${string}` =>
  typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value);

const chain: Chain = {
  ...mainnet,
  // overwrite RPCs for mainnet with our local anvil fork
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
};

// Generate a random default account
let currentPrivateKey = generatePrivateKey();
let account = privateKeyToAccount(currentPrivateKey);
let walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});

// Tracks whether the site has been granted access to accounts (EIP-1193).
// eth_accounts returns [] until authorized; eth_requestAccounts sets this flag.
let authorized = false;

// Methods that should reject on the next call
const rejectMethods = new Set<string>();

// This is the EIP-1193 provider object we will inject
const mockProvider = {
  // Flags for provider detection
  isE2E: true,

  // Event listeners, required by EIP-1193
  events: new Map<string, Array<(data: unknown) => void>>(),

  // Custom method to change the account.
  // When silent=false (default), emits accountsChanged and marks the site as authorized.
  // When silent=true, only updates the key — no event and no authorization change.
  setPrivateKey(newPrivateKey: `0x${string}`, silent = false) {
    currentPrivateKey = newPrivateKey;
    account = privateKeyToAccount(currentPrivateKey);
    walletClient = createWalletClient({
      account,
      chain,
      transport: http(RPC_URL),
    });
    console.log('E2E Provider: Account changed to:', account.address);
    if (!silent) {
      authorized = true;
      this.emit('accountsChanged', [account.address]);
    }
  },

  // Getter for current account address
  getCurrentAddress: () => account.address,

  // Make the next call to the given method reject with a user-rejected error (EIP-1193 code 4001)
  setRejectNextRequest(method: string) {
    rejectMethods.add(method);
    console.log('E2E Provider: will reject next request for method:', method);
  },

  // The core method that handles all JSON-RPC requests
  // @ts-expect-error any
  async request({ method, params }) {
    console.log('E2E Provider received request:', { method, params });

    if (rejectMethods.has(method)) {
      rejectMethods.delete(method);
      console.log('E2E Provider: rejecting request for method:', method);
      const error = new Error('MetaMask Personal Message Signature: User denied message signature.');
      (error as { code?: number }).code = 4001;
      throw error;
    }

    const requestParams = Array.isArray(params) ? params : [];

    // eth_accounts: returns the authorized address, or [] if not yet authorized (EIP-1193)
    if (method === 'eth_accounts') {
      return authorized ? [walletClient.account.address] : [];
    }

    // eth_requestAccounts: grants access and returns the address
    if (method === 'eth_requestAccounts') {
      authorized = true;
      return [walletClient.account.address];
    }

    // Return chain info locally to avoid RPC calls during auth
    if (method === 'eth_chainId') {
      return '0x1'; // mainnet
    }

    if (method === 'net_version') {
      return '1';
    }

    // Handle wallet permissions (used by injected wallet connector)
    if (method === 'wallet_requestPermissions') {
      return [{ parentCapability: 'eth_accounts' }];
    }

    if (method === 'wallet_getPermissions') {
      return [{ parentCapability: 'eth_accounts' }];
    }

    // Handle 'wallet_switchEthereumChain'
    if (method === 'wallet_switchEthereumChain') {
      const chainId = requestParams[0]?.chainId;
      console.log('Switching to chain:', chainId);
      // Here you can add logic to switch chains if needed
      return { chainId };
    }

    // personal_sign is used by SIWE and many wallet connectors.
    if (method === 'personal_sign') {
      const [first, second] = requestParams;
      const accountAddress = walletClient.account.address;
      const firstIsAddress = normalizeAddress(first) === normalizeAddress(accountAddress);
      const secondIsAddress = normalizeAddress(second) === normalizeAddress(accountAddress);

      // Some clients send [message, address], others [address, message].
      const messageParam = firstIsAddress ? second : secondIsAddress ? first : first;

      if (isHexString(messageParam)) {
        return await walletClient.signMessage({ message: { raw: messageParam } });
      }

      return await walletClient.signMessage({ message: String(messageParam ?? '') });
    }

    // eth_sign follows [address, data] and signs raw bytes.
    if (method === 'eth_sign') {
      const [, data] = requestParams;
      if (!isHexString(data)) {
        throw new Error('eth_sign expects a hex payload (0x-prefixed)');
      }
      return await walletClient.signMessage({ message: { raw: data } });
    }

    if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
      // Most clients send [address, typedData]
      const typedDataParam = requestParams[1] ?? requestParams[0];
      const typedData = typeof typedDataParam === 'string' ? JSON.parse(typedDataParam) : typedDataParam;

      return await walletClient.signTypedData({
        account: walletClient.account,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });
    }

    if (method === 'eth_sendTransaction') {
      const tx = requestParams[0];
      return await walletClient.sendTransaction(tx);
    }

    // Pass all other requests directly to the wallet. This will automatically sign transactions, messages, etc.
    return await walletClient.request({ method: method as never, params: requestParams as never });
  },

  // @ts-expect-error any
  on(event, listener) {
    const listeners = this.events.get(event) || [];
    listeners.push(listener);
    this.events.set(event, listeners);
    console.log('E2E Provider: `on` event registered:', event);
  },

  // @ts-expect-error any
  removeListener(event, listener) {
    const listeners = this.events.get(event) || [];
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
    this.events.set(event, listeners);
    console.log('E2E Provider: `removeListener` called for event:', event);
  },

  // @ts-expect-error any
  emit(event, data) {
    const listeners = this.events.get(event) || [];
    for (const listener of listeners) {
      listener(data);
    }
  },
};

// Attach the mock provider to the window object.
// The wagmi config includes injectedWallet which uses window.ethereum directly,
// making it appear as "Browser Wallet" in the RainbowKit modal.
window.ethereum = mockProvider;
