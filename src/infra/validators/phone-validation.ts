import { parsePhoneNumberFromString } from 'libphonenumber-js';

const validatePhoneNumber = (phoneNumber: string): boolean => {
  try {
    const parsedPhoneNumber = parsePhoneNumberFromString(phoneNumber);
    return parsedPhoneNumber?.isValid() || false;
  } catch (error) {
    return false;
  }
};

export default validatePhoneNumber;
