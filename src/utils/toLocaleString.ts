type Opts = {
  prefix?: string;
  postfix?: string;
  currency?: string;
  numTail?: number;
  maxDigits?: number;
  stripDigits?: boolean;
};

function toPlainString(num: string | number) {
  return String(num).replace(/(-?)(\d*)\.?(\d*)e([+-]\d+)/, function (a, b, c, d, e) {
    return e < 0 ? b + '0.' + Array(1 - e - c.length).join('0') + c + d : b + c + d + Array(e - d.length + 1).join('0');
  });
}

export const toLocaleString = (value: string | number | null | undefined, opts?: Opts): string => {
  let { currency = '' } = opts || {};
  const { prefix = '', postfix = '', numTail = 2, maxDigits = 7, stripDigits } = opts || {};

  if (typeof value === 'number') {
    value = String(value);
  }

  if (currency) {
    currency = ' ' + currency;
  }

  if (value?.includes('e')) {
    value = toPlainString(value);
  }

  if (!Number.isFinite(parseFloat(value as string))) {
    return '0';
  }

  let num: string;

  // if number doesn't have digits
  if (!/\./.test(value as string) || stripDigits) {
    num = parseInt(value as string).toLocaleString('en');
  } else if (parseFloat(value as string) > 1_000) {
    num = parseFloat(parseFloat(value as string).toFixed(numTail)).toLocaleString('en');
  } else {
    const [int, tail] = (value as string).split('.');

    num = parseInt(int).toLocaleString('en');

    if (numTail !== 0) {
      num += '.';

      let numCount = 0;
      let digitCount = 0;

      for (let i = 0; i < tail.length; i++) {
        const digit = tail[i];

        if (digit === '0' && !numCount) {
          digitCount += 1;
        } else {
          numCount += 1;
          digitCount += 1;
        }

        num += digit;

        if (digitCount === maxDigits || numCount === numTail) {
          break;
        }
      }
    }
  }

  if (/\./.test(num)) {
    num = num.replace(/\.?0+$/, '');
  }

  return `${prefix}${num}${postfix}${currency}`;
};
