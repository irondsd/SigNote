import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    client?: 'web' | 'desktop';
  }

  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
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
    sid?: string;
    provider?: 'google' | 'siwe';
    client?: 'web' | 'desktop';
  }
}
