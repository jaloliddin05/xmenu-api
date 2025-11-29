// import { BadRequestException, Injectable } from '@nestjs/common';
// import { HttpService } from '@nestjs/axios';
// import { ConfigService } from '@nestjs/config';
// import { lastValueFrom } from 'rxjs';

// @Injectable()
// export class SmsService {
//   constructor(
//     private readonly httpService: HttpService,
//     private readonly configService: ConfigService,
//   ) {}


//   async sendSMS(phoneNumber: string, messages: string): Promise<any> {
//     this.checkPhoneNumber(phoneNumber);

//     const url = 'https://notify.eskiz.uz/api/message/sms/send';

//     const headers = {
//       Authorization: `Bearer ${this.configService.get('eskizToken')}`,
//     };

//     const formData = {
//       mobile_phone: phoneNumber,
//       message: messages,
//       from: 4546,
//       callback_url:this.configService.get('smsCallback')
//     };

//     try {
//       const response = await lastValueFrom(
//         this.httpService.post(url, formData, { headers }),
//       );
      
//       return response.data;
//     } catch (error) {
//       console.log('Error sending SMS:', error.response?.data || error.message);
//     }
//   }

//   checkPhoneNumber(phoneNumber) {
//     const isValid = validatePhoneNumber(phoneNumber);

//     if (!isValid) {
//       throw new BadRequestException('Invalid phone number');
//     }
//   }

// }
