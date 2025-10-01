import bcrypt from 'bcrypt';

interface GeneratedPassword {
  password: string;
  hash: string;
}

function generateRandomLetters(length: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    const randIndex = Math.floor(Math.random() * letters.length);
    result += letters[randIndex];
  }
  return result;
}

export async function generatePasswordWithHash(
  base: string,
  saltRounds = 10
): Promise<GeneratedPassword> {
  if (typeof base !== 'string' || base.trim() === '') {
    throw new Error("Base string bo'sh bo'lmasligi kerak.");
  }

  // Faqat harflarni qoldirish (Unicode bo‘yicha)
  let normalized = base
    .toLowerCase()
    .replace(/[^\p{L}]/gu, ''); // faqat harflar qoladi

  // Agar harf topilmasa → tasodifiy 4 ta harf
  if (normalized === '') {
    normalized = generateRandomLetters(4);
  }

  const randNum = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');

  const password = `${normalized}${randNum}`;
  const hash = await bcrypt.hash(password, saltRounds);

  return { password, hash };
}
