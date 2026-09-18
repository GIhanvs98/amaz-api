import axios from 'axios';

export class SMSService {
  private static API_URL = 'https://app.send.lk/api/v3/sms/send';
  private static API_KEY = process.env.SENDLK_API_KEY || '';
  private static SENDER_ID = process.env.SENDLK_SENDER_ID || '';

  /**
   * Sends an SMS via Send.lk
   * @param to Phone number starting with 94
   * @param message Message body
   */
  public static async sendSMS(to: string, message: string): Promise<boolean> {
    if (!this.API_KEY) {
      console.warn('SMS skipped: SENDLK_API_KEY is not defined in environment variables.');
      return false;
    }

    try {
      // Clean phone number: replace leading 0 with 94 if needed
      let formattedPhone = to.trim();
      if (formattedPhone.startsWith('0')) {
        formattedPhone = '94' + formattedPhone.slice(1);
      }

      const response = await axios.post(
        this.API_URL,
        {
          recipient: formattedPhone,
          sender_id: this.SENDER_ID,
          message: message,
        },
        {
          headers: {
            Authorization: `Bearer ${this.API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('SMS sent successfully:', response.data);
      return true;
    } catch (error) {
      console.error('Error sending SMS:', error);
      return false;
    }
  }

  /**
   * Sends the queue token SMS based on the provided template
   */
  public static async sendTokenSMS(
    phone: string,
    refNo: string,
    doctorName: string,
    queueNumber: string,
    hospitalName: string
  ): Promise<boolean> {
    const date = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
    const time = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).toLowerCase(); // 6:18 pm

    const message = `Ref No: ${refNo}
Prof. ${doctorName}
No: ${queueNumber}
Hospital: ${hospitalName}
Date: ${date}
Time: ${time}`;

    return this.sendSMS(phone, message);
  }
}
