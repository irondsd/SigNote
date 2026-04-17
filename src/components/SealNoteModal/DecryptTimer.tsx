import { Button } from '../ui/button';

type DecryptTimerProps = {
  timeLeft: number;
  total: number;
  onClick: () => void;
};

export function DecryptTimer({ timeLeft, total, onClick }: DecryptTimerProps) {
  const size = 16;
  const strokeWidth = 1.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = timeLeft / total;
  const dashOffset = circumference * (1 - progress);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      data-testid="decrypt-timer"
      onClick={onClick}
      className="inline-flex items-center justify-center cursor-pointer bg-transparent border-none p-2"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          opacity={0.15}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          opacity={0.7}
          transform={`rotate(-90 ${size / 2} ${size / 2}) scale(1, -1) translate(0, -${size})`}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
    </Button>
  );
}
