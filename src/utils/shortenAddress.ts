export const shortenAddress = (address: string, countBefore: number = 4, countAfter: number = 4) => {
  if (!address) return '';

  const start = address.slice(0, countBefore + 2); // +2 to include "0x"
  const end = address.slice(-countAfter);
  return `${start}...${end}`;
};
