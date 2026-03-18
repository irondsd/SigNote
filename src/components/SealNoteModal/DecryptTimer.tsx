type DecryptTimerProps = {
  timeLeft: number;
  total: number;
  onClick: () => void;
};

export function DecryptTimer({ timeLeft, total, onClick }: DecryptTimerProps) {
  const size = 22;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = timeLeft / total;
  const dashOffset = circumference * (1 - progress);

  return (
    <button
      type="button"
      data-testid="decrypt-timer"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        background: 'none',
        border: 'none',
        padding: 2,
      }}
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
          opacity={0.5}
          transform={`rotate(-90 ${size / 2} ${size / 2}) scale(1, -1) translate(0, -${size})`}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
    </button>
  );
}
