import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    client?: 'web' | 'desktop';
  }

  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
    authProvider?: 'google' | 'siwe' | 'email' | 'passkey';
  }
}

declare module 'next-auth/adapters' {
  // intentionally empty — keeps module augmentation scoped
}

declare module 'next-auth' {
  interface Account {
    userId?: string;
    displayName?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    // Optional because a decoded JWT is untrusted input that may not carry the
    // claim, not because a session without one is allowed: the `jwt` callback
    // always stamps it and `authenticateRequest` 401s any token missing it.
    sid?: string;
    provider?: 'google' | 'siwe' | 'email' | 'passkey';
    client?: 'web' | 'desktop';
  }
}
