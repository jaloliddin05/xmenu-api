import * as bcrypt from 'bcrypt';

type GeneratedPassword = {
  password: string;
  hash: string;
};


export async function generatePasswordWithHash(
  base: string,
  saltRounds = 10
): Promise<GeneratedPassword> {
  if (typeof base !== 'string' || base.trim() === '') {
    throw new Error('Base string bo\'sh bo\'lmasligi kerak.');
  }

  const normalized = base.trim().toLowerCase();

  // 0 — 9999 oralig'ida tasodifiy butun va 4 xonaga to'ldirish
  const randNum = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');

  const password = `${normalized}${randNum}`;

  const hash = await bcrypt.hash(password, saltRounds);

  return { password, hash };
}
