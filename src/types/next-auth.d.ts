import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      address?: string;
    } & DefaultSession['user'];
  }

  interface User {
    address?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    address?: string;
  }
}
