export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

// Discriminator for both the erase procedure (trpc.erase[key]) and display.
export type EraseKey = 'notes' | 'seals' | 'secrets' | 'encryption' | 'account';

export type EraseStep = {
  key: EraseKey;
  label: string;
  status: StepStatus;
};

export type Phase = 'warning' | 'confirming' | 'ready' | 'erasing' | 'done';
