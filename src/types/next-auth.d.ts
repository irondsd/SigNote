import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
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
  }
}
