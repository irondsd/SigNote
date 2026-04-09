import { useState, useRef, useEffect } from 'react';

const useCopy = (text: string) => {
  const [isCopied, setIsCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setIsCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsCopied(false), 2000);
  };

  return { isCopied, copy };
};

export default useCopy;
