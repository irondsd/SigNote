import ky from 'ky';

import { handleUnauthorized } from './authRedirect';
import { getSessionClientHeaders } from './sessionClient';

export const api = ky.create({
  hooks: {
    beforeRequest: [
      (request) => {
        for (const [name, value] of Object.entries(getSessionClientHeaders())) {
          request.headers.set(name, value);
        }
      },
    ],
    afterResponse: [
      async (_request, _options, response) => {
        if (response.status === 401) {
          // Fire-and-forget so the original caller still receives the 401 response
          // and can resolve/reject naturally. The page-level redirect happens
          // asynchronously and supersedes any subsequent UI state.
          void handleUnauthorized();
        }
        return response;
      },
    ],
  },
});
