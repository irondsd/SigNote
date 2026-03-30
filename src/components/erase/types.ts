export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export type EraseStep = {
  key: string;
  label: string;
  endpoint: string;
  status: StepStatus;
};

export type Phase = 'warning' | 'confirming' | 'ready' | 'erasing' | 'done';
