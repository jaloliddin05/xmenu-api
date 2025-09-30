function formatPhoneNumber(phoneNumber: string): string {
    if (!phoneNumber) return '';
  
    // Faqat raqamlar va "+" belgisini qoldirish
    let cleanedPhoneNumber = phoneNumber.replace(/[^0-9+]/g, '');
  
    // "+" belgisi faqat boshida bo‘lishini tekshirish
    cleanedPhoneNumber = cleanedPhoneNumber.replace(/^([^+])/, '+$1');
    cleanedPhoneNumber = cleanedPhoneNumber.replace(/(?<=^\+.*?)\+/g, ''); // Ortiqcha "+" belgisini olib tashlash
  
    return cleanedPhoneNumber;
}

export default formatPhoneNumber