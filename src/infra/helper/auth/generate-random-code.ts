const generateRandomCode = (length: number): number => {
  const randomNumbers: number[] = []; // 👉 massiv tipini aniqladik
  for (let i = 0; i < length; i++) {
    const randomNumber = Math.floor(Math.random() * 9) + 1; // 1–9 oralig‘ida son
    randomNumbers.push(randomNumber);
  }
  return Number(randomNumbers.join(''));
};

export default generateRandomCode;
